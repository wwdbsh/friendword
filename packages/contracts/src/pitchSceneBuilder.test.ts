import { describe, expect, it } from 'vitest';

import type { PitchSceneSegment } from './pitchScene';
import { buildPitchSceneV2, usableTextSources } from './pitchSceneBuilder';
import {
  MAX_SCENE_ASSETS,
  MAX_SHOT_DURATION_MS,
  MAX_STATIC_SHOT_MS,
  MAX_WORD_POP_MS,
  MIN_FLASH_INTERVAL_MS,
  MIN_LADDER_REPEAT_GAP_SHOTS,
  MIN_SHOT_DURATION_MS,
  MIN_WORD_POP_MS,
  pitchSceneV2Schema,
  type PitchSceneTemplate,
  type PitchSceneV2,
  type PitchShotV2,
} from './pitchSceneV2';
import type { PitchStructure } from './pitchStructure';
import type { TranscriptWordTiming } from './transcriptWords';

const assetId = (index: number): string =>
  `40000000-0000-0000-0000-${String(index).padStart(12, '0')}`;

const photoIds = (count: number): readonly string[] =>
  Array.from({ length: count }, (_value, index) => assetId(index + 1));

const TEMPLATES: readonly PitchSceneTemplate[] = ['warm', 'hype'];

const structure: PitchStructure = {
  hook: 'She will out-argue you about bread',
  relationship_context: 'my roommate of six years',
  three_specific_qualities: ['relentlessly curious', 'unreasonably good at bread', 'texts back'],
  evidence_or_anecdote: 'She drove four hours for a sourdough starter.',
  good_match_for: 'someone who likes being asked questions',
  hard_claims_requiring_confirmation: [],
};

type Speech = {
  readonly segments: readonly PitchSceneSegment[];
  readonly words: readonly TranscriptWordTiming[];
};

/**
 * A recording of exactly `durationMs`: `sentences` spans separated by `pauseMs` of
 * silence, each holding `wordsPerSentence` evenly spaced words. Word timings and
 * segment timings come from the same grid, which is what a real transcript gives us.
 */
function speech(
  durationMs: number,
  sentences: number,
  wordsPerSentence: number,
  pauseMs: number,
): Speech {
  const spoken = durationMs - pauseMs * (sentences - 1);
  const span = Math.floor(spoken / sentences);
  const segments: PitchSceneSegment[] = [];
  const words: TranscriptWordTiming[] = [];
  let cursor = 0;
  for (let sentence = 0; sentence < sentences; sentence += 1) {
    const start = cursor;
    const slot = Math.floor(span / wordsPerSentence);
    for (let word = 0; word < wordsPerSentence; word += 1) {
      const wordStart = start + word * slot;
      words.push({
        segmentIndex: sentence,
        wordIndex: word,
        startMs: wordStart,
        endMs: wordStart + Math.round(slot * 0.8),
      });
    }
    const end = sentence === sentences - 1 ? durationMs : start + span;
    segments.push({ startMs: start, endMs: end });
    cursor = end + pauseMs;
  }
  return { segments, words };
}

function photoShots(scene: PitchSceneV2): readonly Extract<PitchShotV2, { assetId: string }>[] {
  const shots: Extract<PitchShotV2, { assetId: string }>[] = [];
  for (const shot of scene.shots) {
    if (shot.level !== 'typographic') {
      shots.push(shot);
    }
  }
  return shots;
}

/**
 * The flash timeline, reimplemented from the rule rather than imported from the
 * schema: punch onsets, every expanded lightLeak pulse peak over the half-open
 * [startMs, endMs), wordPop appearances and countBadge appearances. Written out here
 * on purpose — a test that called the parser's own helper would agree with it about
 * a wrong peak list.
 */
function flashEvents(scene: PitchSceneV2): readonly number[] {
  const events: number[] = [];
  for (const shot of scene.shots) {
    if (shot.level === 'typographic') {
      continue;
    }
    for (const effect of shot.effects) {
      if (effect.type === 'punch') {
        events.push(effect.atMs);
      }
      if (effect.type === 'wordPop') {
        events.push(effect.startMs);
      }
    }
  }
  for (const overlay of scene.overlays) {
    if (overlay.type !== 'lightLeak') {
      events.push(overlay.startMs);
      continue;
    }
    if (overlay.pulseHz === 0) {
      events.push(overlay.startMs);
      continue;
    }
    for (let k = 0; ; k += 1) {
      const atMs = overlay.startMs + Math.floor((k * 1000) / overlay.pulseHz);
      if (atMs >= overlay.endMs) {
        break;
      }
      events.push(atMs);
    }
  }
  return [...events].sort((left, right) => left - right);
}

function minFlashGap(scene: PitchSceneV2): number {
  const events = flashEvents(scene);
  let smallest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < events.length; index += 1) {
    smallest = Math.min(smallest, (events[index] as number) - (events[index - 1] as number));
  }
  return smallest;
}

function wordPopRefs(scene: PitchSceneV2): readonly string[] {
  const refs: string[] = [];
  for (const shot of scene.shots) {
    if (shot.level === 'typographic') {
      continue;
    }
    for (const effect of shot.effects) {
      if (effect.type === 'wordPop') {
        refs.push(`${effect.word.segmentIndex}:${effect.word.wordIndex}`);
      }
    }
  }
  return refs;
}

/** Every property the builder promises beyond what the schema already enforces. */
function expectHealthyScene(scene: PitchSceneV2 | null, assetIds: readonly string[]): PitchSceneV2 {
  expect(scene).not.toBeNull();
  const value = scene as PitchSceneV2;
  // The builder self-validates, so this only catches a schema/builder divergence.
  expect(pitchSceneV2Schema.safeParse(value).success).toBe(true);
  expect(value.assetIds).toEqual([...assetIds]);

  // Every included photo gets a turn, and the ladder never repeats a framing early.
  const used = new Set(photoShots(value).map((shot) => shot.assetId));
  expect([...used].sort()).toEqual([...assetIds].sort());
  const lastSeen = new Map<string, number>();
  for (const [index, shot] of value.shots.entries()) {
    if (shot.level === 'typographic') {
      continue;
    }
    const key = `${shot.assetId}:${shot.level}`;
    const previous = lastSeen.get(key);
    if (previous !== undefined) {
      expect(index - previous).toBeGreaterThanOrEqual(MIN_LADDER_REPEAT_GAP_SHOTS);
    }
    lastSeen.set(key, index);
  }

  // Shot lengths, including the tighter ceiling a text card lives under.
  for (const shot of value.shots) {
    const duration = shot.endMs - shot.startMs;
    expect(duration).toBeGreaterThanOrEqual(MIN_SHOT_DURATION_MS);
    expect(duration).toBeLessThanOrEqual(
      shot.level === 'typographic' ? MAX_STATIC_SHOT_MS : MAX_SHOT_DURATION_MS,
    );
  }

  // The photosensitivity budget, as a spacing claim on the union of every momentary
  // luminance or appearance event: punch onsets, expanded leak pulse peaks, wordPop
  // and countBadge appearances.
  const events = flashEvents(value);
  for (let index = 1; index < events.length; index += 1) {
    expect((events[index] as number) - (events[index - 1] as number)).toBeGreaterThanOrEqual(
      MIN_FLASH_INTERVAL_MS,
    );
  }

  // Phase 2 product decisions: no baked envelope we do not have, no blur with
  // nothing to separate.
  expect(value.chrome.waveViz).toBeUndefined();
  expect(value.chrome.progressBar).toBeDefined();
  for (const shot of photoShots(value)) {
    expect(shot.effects.some((effect) => effect.type === 'backdropBlur')).toBe(false);
    expect(shot.effects.filter((effect) => effect.type === 'kenBurns')).toHaveLength(1);
  }
  return value;
}

describe('buildPitchSceneV2 — the whole grid parses and is stable', () => {
  for (const template of TEMPLATES) {
    for (const durationMs of [15_000, 30_000, 60_000]) {
      for (const photos of [1, 2, 4, 8]) {
        for (const withWords of [true, false]) {
          const label = `${template} ${durationMs / 1000}s ${photos} photo(s) ${
            withWords ? 'with words' : 'segments only'
          }`;
          it(`builds ${label}`, () => {
            const recording = speech(
              durationMs,
              Math.max(2, Math.round(durationMs / 4_000)),
              7,
              620,
            );
            const ids = photoIds(photos);
            const input = {
              template,
              photoAssetIds: ids,
              segments: recording.segments,
              ...(withWords ? { words: recording.words } : {}),
              structure,
            };
            const scene = expectHealthyScene(buildPitchSceneV2(input), ids);
            expect(scene.durationMs).toBe(durationMs);
            expect(scene.template).toBe(template);

            // Word effects exist only where word timings do (the database rejects a
            // wordPop on a transcript that has no words).
            const refs = wordPopRefs(scene);
            if (withWords) {
              expect(refs.length).toBeGreaterThan(0);
              const known = new Set(
                recording.words.map((word) => `${word.segmentIndex}:${word.wordIndex}`),
              );
              for (const ref of refs) {
                expect(known.has(ref)).toBe(true);
              }
              expect(new Set(refs).size).toBe(refs.length);
            } else {
              expect(refs).toEqual([]);
            }

            // Determinism: same input, same scene, down to the bytes.
            const again = buildPitchSceneV2(input);
            expect(again).toEqual(scene);
            expect(JSON.stringify(again)).toBe(JSON.stringify(scene));
          });
        }
      }
    }
  }
});

describe('buildPitchSceneV2 — cuts land on the friend’s pauses', () => {
  // Six sentences, 900ms of silence between them: the section beats are the
  // milliseconds where speech resumes.
  const recording = speech(30_000, 6, 8, 900);
  const resumes = new Set(recording.segments.slice(1).map((segment) => segment.startMs));
  const wordOnsets = new Set(recording.words.map((word) => word.startMs));

  for (const template of TEMPLATES) {
    it(`${template}: every internal cut is a word onset, never mid-word`, () => {
      const scene = expectHealthyScene(
        buildPitchSceneV2({
          template,
          photoAssetIds: photoIds(4),
          segments: recording.segments,
          words: recording.words,
          structure,
        }),
        photoIds(4),
      );
      const cuts = scene.shots.slice(1).map((shot) => shot.startMs);
      expect(cuts.length).toBeGreaterThan(4);
      for (const cut of cuts) {
        expect(wordOnsets.has(cut)).toBe(true);
      }
      // And the long pauses are actually used, not merely available.
      expect(cuts.some((cut) => resumes.has(cut))).toBe(true);
    });
  }

  it('hype burns a light leak through the hard cuts and nowhere else', () => {
    const scene = expectHealthyScene(
      buildPitchSceneV2({
        template: 'hype',
        photoAssetIds: photoIds(4),
        segments: recording.segments,
        words: recording.words,
        structure,
      }),
      photoIds(4),
    );
    const leaks = scene.overlays.filter((overlay) => overlay.type === 'lightLeak');
    expect(leaks.length).toBeGreaterThan(0);
    const cuts = new Set(scene.shots.map((shot) => shot.startMs));
    for (const leak of leaks) {
      // A leak straddles the cut it belongs to rather than flashing inside a shot.
      const straddled = [...cuts].some((cut) => cut > leak.startMs && cut < leak.endMs);
      expect(straddled).toBe(true);
      expect(
        resumes.has([...cuts].find((cut) => cut > leak.startMs && cut < leak.endMs) ?? -1),
      ).toBe(true);
    }
  });

  it('warm never uses a light leak', () => {
    const scene = expectHealthyScene(
      buildPitchSceneV2({
        template: 'warm',
        photoAssetIds: photoIds(4),
        segments: recording.segments,
        words: recording.words,
        structure,
      }),
      photoIds(4),
    );
    expect(scene.overlays.some((overlay) => overlay.type === 'lightLeak')).toBe(false);
  });

  it('with no word timings the segment boundaries carry the grid alone', () => {
    const scene = expectHealthyScene(
      buildPitchSceneV2({
        template: 'warm',
        photoAssetIds: photoIds(3),
        segments: recording.segments,
        structure,
      }),
      photoIds(3),
    );
    const boundaries = new Set(recording.segments.slice(1).map((segment) => segment.startMs));
    const cuts = scene.shots.slice(1).map((shot) => shot.startMs);
    expect(cuts.some((cut) => boundaries.has(cut))).toBe(true);
  });
});

describe('buildPitchSceneV2 — the crop ladder', () => {
  it('revisits one photo at four framings rather than repeating it', () => {
    const recording = speech(30_000, 8, 6, 500);
    const scene = expectHealthyScene(
      buildPitchSceneV2({
        template: 'warm',
        photoAssetIds: photoIds(1),
        segments: recording.segments,
        words: recording.words,
        structure,
      }),
      photoIds(1),
    );
    const levels = new Set(photoShots(scene).map((shot) => shot.level));
    expect([...levels].sort()).toEqual(['detail', 'punchIn', 'wide', 'wideAlt']);
  });

  it('every move actually travels and stays inside the reviewed frame', () => {
    const recording = speech(45_000, 10, 6, 500);
    for (const template of TEMPLATES) {
      const scene = expectHealthyScene(
        buildPitchSceneV2({
          template,
          photoAssetIds: photoIds(2),
          segments: recording.segments,
          words: recording.words,
          structure,
        }),
        photoIds(2),
      );
      for (const shot of photoShots(scene)) {
        expect(shot.crop.width).toBe(shot.crop.height);
        expect(shot.crop.x + shot.crop.width).toBeLessThanOrEqual(1);
        expect(shot.crop.y + shot.crop.height).toBeLessThanOrEqual(1);
        const move = shot.effects.find((effect) => effect.type === 'kenBurns');
        expect(move).toBeDefined();
        if (move?.type !== 'kenBurns') {
          throw new Error('unreachable');
        }
        const travel = Math.max(
          Math.abs(move.to.width - shot.crop.width),
          Math.abs(move.to.x - shot.crop.x),
          Math.abs(move.to.y - shot.crop.y),
        );
        expect(travel).toBeGreaterThanOrEqual(0.02);
        expect(move.to.x + move.to.width).toBeLessThanOrEqual(1);
        expect(move.to.y + move.to.height).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never punches a wide shot, which has no zoom headroom left', () => {
    const recording = speech(60_000, 14, 6, 500);
    for (const template of TEMPLATES) {
      const scene = expectHealthyScene(
        buildPitchSceneV2({
          template,
          photoAssetIds: photoIds(4),
          segments: recording.segments,
          words: recording.words,
          structure,
        }),
        photoIds(4),
      );
      for (const shot of photoShots(scene)) {
        if (shot.level === 'wide') {
          expect(shot.effects.some((effect) => effect.type === 'punch')).toBe(false);
        }
      }
      expect(
        photoShots(scene).some((shot) => shot.effects.some((effect) => effect.type === 'punch')),
      ).toBe(true);
    }
  });
});

describe('buildPitchSceneV2 — text is a reference or it is absent', () => {
  const recording = speech(60_000, 14, 6, 500);

  it('opens on the hook and never ends on a card', () => {
    const scene = expectHealthyScene(
      buildPitchSceneV2({
        template: 'warm',
        photoAssetIds: photoIds(4),
        segments: recording.segments,
        words: recording.words,
        structure,
      }),
      photoIds(4),
    );
    const first = scene.shots[0];
    expect(first?.level).toBe('typographic');
    if (first?.level === 'typographic') {
      expect(first.text.source).toBe('hook');
    }
    expect(scene.shots.at(-1)?.level).not.toBe('typographic');
  });

  it('shows the quality trio whole, each with its own badge', () => {
    const scene = expectHealthyScene(
      buildPitchSceneV2({
        template: 'hype',
        photoAssetIds: photoIds(4),
        segments: recording.segments,
        words: recording.words,
        structure,
      }),
      photoIds(4),
    );
    const cards = scene.shots.flatMap((shot) =>
      shot.level === 'typographic' ? [shot.text.source] : [],
    );
    expect(cards).toEqual(['hook', 'quality:0', 'quality:1', 'quality:2']);
    const badges = scene.overlays.flatMap((overlay) =>
      overlay.type === 'countBadge' ? [overlay.source] : [],
    );
    expect(badges).toEqual(['quality:0', 'quality:1', 'quality:2']);
    // A badge belongs to the card naming the same sentence.
    for (const overlay of scene.overlays) {
      if (overlay.type !== 'countBadge') {
        continue;
      }
      const owner = scene.shots.find(
        (shot) => shot.startMs <= overlay.startMs && shot.endMs >= overlay.endMs,
      );
      expect(owner?.level).toBe('typographic');
      if (owner?.level === 'typographic') {
        expect(owner.text.source).toBe(overlay.source);
      }
    }
  });

  it('never shows a partial trio', () => {
    // 30s carries fewer cards than the trio needs, so the grammar reaches for
    // standalone sentences instead of a "1/3" nobody will see the rest of.
    const short = speech(30_000, 8, 6, 500);
    const scene = expectHealthyScene(
      buildPitchSceneV2({
        template: 'warm',
        photoAssetIds: photoIds(4),
        segments: short.segments,
        words: short.words,
        structure,
      }),
      photoIds(4),
    );
    const cards = scene.shots.flatMap((shot) =>
      shot.level === 'typographic' ? [shot.text.source] : [],
    );
    expect(cards.filter((source) => source.startsWith('quality:'))).toEqual([]);
    expect(cards[0]).toBe('hook');
    expect(scene.overlays.filter((overlay) => overlay.type === 'countBadge')).toEqual([]);
  });

  it('carries no text at all when the revision has no reviewed structure', () => {
    for (const template of TEMPLATES) {
      const scene = expectHealthyScene(
        buildPitchSceneV2({
          template,
          photoAssetIds: photoIds(4),
          segments: recording.segments,
          words: recording.words,
        }),
        photoIds(4),
      );
      expect(scene.shots.every((shot) => shot.level !== 'typographic')).toBe(true);
      expect(scene.overlays.every((overlay) => overlay.type !== 'countBadge')).toBe(true);
    }
  });

  it('usableTextSources mirrors the published-structure predicate', () => {
    expect(usableTextSources(null)).toEqual([]);
    expect(usableTextSources(undefined)).toEqual([]);
    expect(usableTextSources(structure)).toEqual([
      'hook',
      'quality:0',
      'quality:1',
      'quality:2',
      'good_match_for',
      'evidence_or_anecdote',
      'relationship_context',
    ]);
    expect(usableTextSources({ ...structure, hook: '  ' })).not.toContain('hook');
    expect(
      usableTextSources({
        ...structure,
        three_specific_qualities: ['curious', '', 'texts back'],
      }),
    ).toEqual(['hook', 'good_match_for', 'evidence_or_anecdote', 'relationship_context']);
    expect(usableTextSources({ ...structure, three_specific_qualities: ['only', 'two'] })).toEqual(
      [],
    );
  });
});

describe('buildPitchSceneV2 — the flash budget is load-bearing', () => {
  /**
   * Real recordings that collide. Each row was found by bypassing `applyFlashBudget`
   * and measuring the resulting timeline, and `collision` is what that bypass
   * actually produced — not a prediction. With the budget in place every one of these
   * builds; with it bypassed every one of them throws at the builder's own
   * self-validating parse, which is the only thing that stops a scene the database
   * will refuse from reaching a Dater's approval screen.
   *
   * F1 was a comment on that function claiming today's numbers could never make it
   * fire. Four of the seven event PAIRS it reasoned about did not exist yet
   * (wordPops and countBadges were not on the budget), and the pair it did reason
   * about it got wrong.
   */
  const reproductions = [
    {
      label: 'a punch and a wordPop on the same word onset',
      collision: '1 pair: punch@7700 and pop@7700, 0ms apart',
      template: 'warm' as PitchSceneTemplate,
      photos: 1,
      structure: false,
      recording: speech(15_000, 2, 3, 400),
    },
    {
      label: 'a countBadge inset into the card a light leak straddles',
      collision: '9 pairs, among them leak peak@8800 -> badge@9020 at 220ms',
      template: 'hype' as PitchSceneTemplate,
      photos: 1,
      structure: true,
      recording: speech(45_000, 2, 5, 400),
    },
    {
      label: 'a wordPop on the first word after a hard cut',
      collision: '1 pair: leak peak@7580 -> pop@7700, 120ms apart',
      template: 'hype' as PitchSceneTemplate,
      photos: 8,
      structure: true,
      recording: speech(15_000, 2, 3, 400),
    },
    {
      label: 'two wordPops in one shot and a leak beside them',
      collision: '13 pairs, alternating leak->pop at 120ms and pop->pop at 240ms',
      template: 'hype' as PitchSceneTemplate,
      photos: 8,
      structure: true,
      recording: speech(15_000, 10, 7, 1_200),
    },
  ] as const;

  for (const entry of reproductions) {
    it(`spaces ${entry.label} (bypassed: ${entry.collision})`, () => {
      const ids = photoIds(entry.photos);
      const scene = expectHealthyScene(
        buildPitchSceneV2({
          template: entry.template,
          photoAssetIds: ids,
          segments: entry.recording.segments,
          words: entry.recording.words,
          ...(entry.structure ? { structure } : {}),
        }),
        ids,
      );
      expect(minFlashGap(scene)).toBeGreaterThanOrEqual(MIN_FLASH_INTERVAL_MS);
    });
  }

  it('drops the pop rather than the punch when they land on the same onset', () => {
    // The first reproduction, as a claim about WHICH of the two survived: a punch is
    // an accent the template asked for on this framing, a pop is decoration on a word
    // the viewer is already hearing.
    const recording = speech(15_000, 2, 3, 400);
    const ids = photoIds(1);
    const scene = expectHealthyScene(
      buildPitchSceneV2({
        template: 'warm',
        photoAssetIds: ids,
        segments: recording.segments,
        words: recording.words,
      }),
      ids,
    );
    const contested = photoShots(scene).find((shot) => shot.startMs <= 7_700 && shot.endMs > 7_700);
    expect(contested).toBeDefined();
    expect(
      contested?.effects.some((effect) => effect.type === 'punch' && effect.atMs === 7_700),
    ).toBe(true);
    expect(contested?.effects.some((effect) => effect.type === 'wordPop')).toBe(false);
    // And the word was poppable: a later shot pops one of the same length.
    expect(wordPopRefs(scene).length).toBeGreaterThan(0);
  });

  it('keeps every light leak: they mark the cuts, and they are offered first', () => {
    const recording = speech(45_000, 2, 5, 400);
    const ids = photoIds(1);
    const scene = expectHealthyScene(
      buildPitchSceneV2({
        template: 'hype',
        photoAssetIds: ids,
        segments: recording.segments,
        words: recording.words,
        structure,
      }),
      ids,
    );
    expect(scene.overlays.filter((overlay) => overlay.type === 'lightLeak').length).toBeGreaterThan(
      0,
    );
  });
});

describe('buildPitchSceneV2 — null is a real answer', () => {
  const recording = speech(30_000, 8, 6, 500);

  it('no photos', () => {
    expect(
      buildPitchSceneV2({ template: 'warm', photoAssetIds: [], segments: recording.segments }),
    ).toBeNull();
  });

  it('no transcript', () => {
    expect(
      buildPitchSceneV2({ template: 'warm', photoAssetIds: photoIds(2), segments: [] }),
    ).toBeNull();
  });

  it('a transcript of nothing but zero-length segments', () => {
    expect(
      buildPitchSceneV2({
        template: 'warm',
        photoAssetIds: photoIds(2),
        segments: [
          { startMs: 0, endMs: 0 },
          { startMs: 400, endMs: 200 },
        ],
      }),
    ).toBeNull();
  });

  it('a recording too short for one legal shot', () => {
    expect(
      buildPitchSceneV2({
        template: 'warm',
        photoAssetIds: photoIds(1),
        segments: [{ startMs: 0, endMs: MIN_SHOT_DURATION_MS - 1 }],
      }),
    ).toBeNull();
  });

  it('more photos than the recording can give a legal turn', () => {
    expect(
      buildPitchSceneV2({
        template: 'warm',
        photoAssetIds: photoIds(5),
        segments: [{ startMs: 0, endMs: 4_800 }],
      }),
    ).toBeNull();
  });

  it('more photos than a scene may reference', () => {
    expect(
      buildPitchSceneV2({
        template: 'warm',
        photoAssetIds: photoIds(MAX_SCENE_ASSETS + 1),
        segments: recording.segments,
      }),
    ).toBeNull();
  });

  it('an asset id that is not a uuid', () => {
    expect(
      buildPitchSceneV2({
        template: 'warm',
        photoAssetIds: ['not-a-uuid'],
        segments: recording.segments,
      }),
    ).toBeNull();
  });

  it('a non-finite segment time', () => {
    expect(
      buildPitchSceneV2({
        template: 'warm',
        photoAssetIds: photoIds(1),
        segments: [{ startMs: 0, endMs: Number.POSITIVE_INFINITY }],
      }),
    ).toBeNull();
  });
});

describe('buildPitchSceneV2 — edges', () => {
  it('a single segment still yields a shot list', () => {
    for (const template of TEMPLATES) {
      const scene = expectHealthyScene(
        buildPitchSceneV2({
          template,
          photoAssetIds: photoIds(2),
          segments: [{ startMs: 0, endMs: 20_000 }],
          structure,
        }),
        photoIds(2),
      );
      expect(scene.durationMs).toBe(20_000);
      expect(scene.shots.length).toBeGreaterThan(4);
    }
  });

  it('the asset ceiling: twelve photos each get a turn', () => {
    const recording = speech(45_000, 10, 6, 500);
    for (const template of TEMPLATES) {
      expectHealthyScene(
        buildPitchSceneV2({
          template,
          photoAssetIds: photoIds(MAX_SCENE_ASSETS),
          segments: recording.segments,
          words: recording.words,
          structure,
        }),
        photoIds(MAX_SCENE_ASSETS),
      );
    }
  });

  it('twelve photos in a 15s recording drop the cards, never a photo', () => {
    const recording = speech(15_000, 4, 6, 400);
    const scene = expectHealthyScene(
      buildPitchSceneV2({
        template: 'warm',
        photoAssetIds: photoIds(MAX_SCENE_ASSETS),
        segments: recording.segments,
        words: recording.words,
        structure,
      }),
      photoIds(MAX_SCENE_ASSETS),
    );
    expect(scene.shots).toHaveLength(MAX_SCENE_ASSETS);
    expect(scene.shots.every((shot) => shot.level !== 'typographic')).toBe(true);
  });

  it('very dense words never produce more than the per-shot pop budget', () => {
    const words: TranscriptWordTiming[] = Array.from({ length: 600 }, (_value, index) => ({
      segmentIndex: Math.floor(index / 60),
      wordIndex: index % 60,
      startMs: index * 50,
      endMs: index * 50 + 45,
    }));
    for (const template of TEMPLATES) {
      const scene = expectHealthyScene(
        buildPitchSceneV2({
          template,
          photoAssetIds: photoIds(4),
          segments: [{ startMs: 0, endMs: 30_000 }],
          words,
          structure,
        }),
        photoIds(4),
      );
      for (const shot of photoShots(scene)) {
        expect(
          shot.effects.filter((effect) => effect.type === 'wordPop').length,
        ).toBeLessThanOrEqual(2);
      }
      const refs = wordPopRefs(scene);
      expect(new Set(refs).size).toBe(refs.length);
    }
  });

  it('a slow speaker with very long words still pops inside the schema window', () => {
    // A drawn-out word can outlast what a wordPop may hold, so the hold is clamped
    // rather than following the word.
    const words: TranscriptWordTiming[] = Array.from({ length: 16 }, (_value, index) => ({
      segmentIndex: Math.floor(index / 8),
      wordIndex: index % 8,
      startMs: index * 1_800,
      endMs: index * 1_800 + 1_700,
    }));
    for (const template of TEMPLATES) {
      const scene = expectHealthyScene(
        buildPitchSceneV2({
          template,
          photoAssetIds: photoIds(3),
          segments: [
            { startMs: 0, endMs: 14_300 },
            { startMs: 14_400, endMs: 28_800 },
          ],
          words,
          structure,
        }),
        photoIds(3),
      );
      let pops = 0;
      for (const shot of photoShots(scene)) {
        for (const effect of shot.effects) {
          if (effect.type !== 'wordPop') {
            continue;
          }
          pops += 1;
          const duration = effect.endMs - effect.startMs;
          expect(duration).toBeGreaterThanOrEqual(MIN_WORD_POP_MS);
          expect(duration).toBeLessThanOrEqual(MAX_WORD_POP_MS);
        }
      }
      expect(pops).toBeGreaterThan(0);
    }
  });

  it('a word beyond the referenceable index range is never referenced', () => {
    const recording = speech(30_000, 6, 6, 500);
    const scene = expectHealthyScene(
      buildPitchSceneV2({
        template: 'hype',
        photoAssetIds: photoIds(2),
        segments: recording.segments,
        words: [
          ...recording.words,
          { segmentIndex: 1_200, wordIndex: 0, startMs: 1_000, endMs: 1_900 },
          { segmentIndex: 0, wordIndex: 5_000, startMs: 2_000, endMs: 2_900 },
        ],
        structure,
      }),
      photoIds(2),
    );
    for (const ref of wordPopRefs(scene)) {
      const [segmentIndex, wordIndex] = ref.split(':').map(Number);
      expect(segmentIndex).toBeLessThanOrEqual(999);
      expect(wordIndex).toBeLessThanOrEqual(999);
    }
  });

  it('takes its duration from the raw last segment, exactly as the database does', () => {
    // The DB reads `ORDER BY ordinality DESC LIMIT 1` and then requires the scene's
    // durationMs to equal it, so a provider that returned segments out of order gets
    // a SHORTER scene here rather than a submission the database rejects. Taking the
    // maximum end would look nicer and would block the whole submit.
    const recording = speech(30_000, 7, 6, 900);
    const build = (segments: readonly PitchSceneSegment[]): PitchSceneV2 | null =>
      buildPitchSceneV2({ template: 'warm', photoAssetIds: photoIds(2), segments, structure });
    const ordered = build(recording.segments);
    expect(ordered?.durationMs).toBe(30_000);

    const reversedTail = [
      ...recording.segments.slice(4),
      ...recording.segments.slice(0, 4).reverse(),
    ];
    const rawLastEnd = (reversedTail.at(-1) as PitchSceneSegment).endMs;
    expect(rawLastEnd).toBeLessThan(30_000);
    const shuffled = expectHealthyScene(build(reversedTail), photoIds(2));
    expect(shuffled.durationMs).toBe(rawLastEnd);
    // And the shots still cover exactly that timeline, floor included — the clamp is
    // a pre-filter on the beat grid, not a cut applied to a finished shot list.
    expect(shuffled.shots[0]?.startMs).toBe(0);
    expect(shuffled.shots.at(-1)?.endMs).toBe(rawLastEnd);
  });

  it('an overlapping segment cannot push the timeline past the recording', () => {
    const scene = expectHealthyScene(
      buildPitchSceneV2({
        template: 'warm',
        photoAssetIds: photoIds(2),
        segments: [
          { startMs: 0, endMs: 12_000 },
          { startMs: 6_000, endMs: 9_000 },
          { startMs: 12_400, endMs: 20_000 },
        ],
        structure,
      }),
      photoIds(2),
    );
    expect(scene.durationMs).toBe(20_000);
  });

  it('a duplicated photo id is one photo, not two turns', () => {
    const recording = speech(20_000, 5, 6, 500);
    const scene = expectHealthyScene(
      buildPitchSceneV2({
        template: 'warm',
        photoAssetIds: [assetId(1), assetId(2), assetId(1)],
        segments: recording.segments,
        words: recording.words,
        structure,
      }),
      [assetId(1), assetId(2)],
    );
    expect(scene.assetIds).toHaveLength(2);
  });

  it('the grain seed is a hash of the input, not a clock', () => {
    const recording = speech(30_000, 8, 6, 500);
    const base = {
      template: 'warm' as const,
      segments: recording.segments,
      words: recording.words,
      structure,
    };
    const first = buildPitchSceneV2({ ...base, photoAssetIds: photoIds(2) });
    const same = buildPitchSceneV2({ ...base, photoAssetIds: photoIds(2) });
    const other = buildPitchSceneV2({ ...base, photoAssetIds: photoIds(3) });
    expect(first?.look.grain.seed).toBe(same?.look.grain.seed);
    expect(first?.look.grain.seed).not.toBe(other?.look.grain.seed);
    expect(first?.look.grain.seed).toBeGreaterThanOrEqual(0);
    expect(first?.look.grain.seed).toBeLessThanOrEqual(2_147_483_647);
  });

  it('the two templates disagree about pace and look, not about vocabulary', () => {
    const recording = speech(30_000, 8, 6, 500);
    const build = (template: PitchSceneTemplate): PitchSceneV2 =>
      expectHealthyScene(
        buildPitchSceneV2({
          template,
          photoAssetIds: photoIds(4),
          segments: recording.segments,
          words: recording.words,
          structure,
        }),
        photoIds(4),
      );
    const warm = build('warm');
    const hype = build('hype');
    expect(hype.shots.length).toBeGreaterThan(warm.shots.length);
    expect(hype.look.grain.intensity).toBeGreaterThan(warm.look.grain.intensity);
    expect(wordPopRefs(hype).length).toBeGreaterThan(wordPopRefs(warm).length);
  });
});
