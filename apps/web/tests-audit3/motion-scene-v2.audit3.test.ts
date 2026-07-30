// MOTION PHASE 2 — the v2 interpreter.
//
// A v2 scene is the approval boundary: the Dater watched a shot list and said
// yes to it. That only means something if the same JSON keeps producing the same
// picture, so this suite pins the interpretation itself — crop → transform, ken
// burns travel, punch, grade, seeded grain, light leak, and the reference
// resolution for wordPop / kineticText / countBadge.
//
// Three of these are safety properties rather than aesthetics, and each is a way
// the feature can quietly become a lie:
//   1. an unresolvable reference SKIPS its effect. A wordPop on a pre-A7
//      recording, or a card naming a structure field this revision does not
//      carry, must draw nothing — never a placeholder, which would be text
//      nobody approved.
//   2. prefers-reduced-motion drops travel, punch, flash and grain animation.
//      Same switch, two reasons: accessibility and photosensitivity.
//   3. waveViz is never drawn. Phase 2 has no real audio envelope, so drawing
//      one would claim an analysis the code did not do (CLAUDE.md §12).
//   4. no layer appears or disappears as a step. Phase 2 verification found the
//      wordPop and countBadge scrims popping in and out at full opacity (F3), so
//      every text layer now rides an opacity ramp of at least MIN_TEXT_RAMP_MS,
//      in BOTH motion modes, and reduced motion suppresses every periodic
//      luminance layer. The enumeration below is deliberately exhaustive over
//      SceneV2Frame: a new layer that carries no reduced-motion rule fails.
/* global describe, expect, it */

import { readFileSync } from 'node:fs';

import {
  buildPitchSceneV2,
  examplePitchSceneV2,
  parsePitchScene,
  type PitchSceneOverlayV2,
  type PitchSceneV2,
  type PitchShotEffectV2,
} from '@friendword/contracts';

import { sceneMotionWindows } from '../src/pitch/motion';
import {
  activeShotIndex,
  asPitchSceneV2,
  cropTransform,
  grainTileUri,
  MIN_TEXT_RAMP_MS,
  sceneV2ActivePhotoIndex,
  sceneV2Frame,
  sceneV2PhotoIndexes,
  sceneV2ShotSignature,
  type SceneTextFields,
  type SceneV2Frame,
  type SceneV2FrameOptions,
  type SceneWord,
} from '../src/pitch/sceneV2';

function photoId(index: number): string {
  return `40000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
}

const PHOTOS = [photoId(1), photoId(2), photoId(3), photoId(4)];

const TEXT: SceneTextFields = {
  hook: 'Blair turns ordinary Tuesdays into stories.',
  relationship_context: 'We shared a wall for four years.',
  three_specific_qualities: ['Remembers every birthday', 'Cooks for a crowd', 'Never gossips'],
  evidence_or_anecdote: 'Blair drove three hours after my surgery.',
  good_match_for: 'Someone kind.',
};

// The two words the canonical scene's wordPops point at.
const WORDS: readonly SceneWord[] = [
  { segmentIndex: 0, wordIndex: 3, text: 'Tuesdays' },
  { segmentIndex: 1, wordIndex: 0, text: 'Blair' },
];

/** The canonical fixture, round-tripped through JSON like a jsonb read. */
function scene(): PitchSceneV2 {
  const stored = JSON.parse(JSON.stringify(examplePitchSceneV2())) as unknown;
  const parsed = asPitchSceneV2(parsePitchScene(stored));
  if (parsed === null) {
    throw new Error('the canonical v2 fixture must parse');
  }
  return parsed;
}

function indexes(subject: PitchSceneV2 = scene()) {
  const map = sceneV2PhotoIndexes(subject, PHOTOS);
  if (map === null) {
    throw new Error('the canonical fixture must bind to its photos');
  }
  return map;
}

function options(overrides: Partial<SceneV2FrameOptions> = {}): SceneV2FrameOptions {
  return { words: WORDS, text: TEXT, reducedMotion: false, ...overrides };
}

function frameAt(elapsedMs: number, overrides: Partial<SceneV2FrameOptions> = {}) {
  const subject = scene();
  return sceneV2Frame(subject, indexes(subject), elapsedMs, options(overrides));
}

type WordPopEffect = Extract<PitchShotEffectV2, { readonly type: 'wordPop' }>;
type CountBadgeOverlay = Extract<PitchSceneOverlayV2, { readonly type: 'countBadge' }>;

/**
 * The fixture's own effect windows, looked up rather than written down: these
 * assertions are about the SHAPE of an appearance, so they must keep holding when
 * the canonical scene is retimed.
 */
function firstWordPop(subject: PitchSceneV2): {
  readonly shotIndex: number;
  readonly effect: WordPopEffect;
} {
  for (const [shotIndex, shot] of subject.shots.entries()) {
    if (shot.level === 'typographic') {
      continue;
    }
    for (const effect of shot.effects) {
      if (effect.type === 'wordPop') {
        return { shotIndex, effect };
      }
    }
  }
  throw new Error('the canonical fixture must carry a wordPop');
}

function firstCountBadge(subject: PitchSceneV2): CountBadgeOverlay {
  for (const overlay of subject.overlays) {
    if (overlay.type === 'countBadge') {
      return overlay;
    }
  }
  throw new Error('the canonical fixture must carry a countBadge');
}

function firstCardWindow(subject: PitchSceneV2): {
  readonly startMs: number;
  readonly endMs: number;
} {
  for (const shot of subject.shots) {
    if (shot.level === 'typographic') {
      return { startMs: shot.startMs, endMs: shot.endMs };
    }
  }
  throw new Error('the canonical fixture must carry a text card');
}

/** Replaces one photo shot's effects, for inputs the canonical fixture cannot express. */
function withShotEffects(
  subject: PitchSceneV2,
  shotIndex: number,
  // Mutable on purpose: the schema's inferred shot type carries a mutable array,
  // so a readonly one does not fit where the fixture's own effects go.
  effects: PitchShotEffectV2[],
): PitchSceneV2 {
  return {
    ...subject,
    shots: subject.shots.map((shot, index) =>
      index === shotIndex && shot.level !== 'typographic' ? { ...shot, effects } : shot,
    ),
  };
}

describe('a crop becomes a transform of the canvas-fitted frame', () => {
  it('centres the crop and scales by 1/width', () => {
    // A detail crop: x 0.1, y 0.15, side 0.7 → 1.4286x, pushed right by the
    // horizontal offset, vertically already centred.
    expect(cropTransform({ x: 0.1, y: 0.15, width: 0.7 }, 1)).toEqual({
      transform: 'translate(7.143%, 0%) scale(1.4286)',
      zoom: 1.4286,
    });
    // The whole frame is the identity: no crop, no move.
    expect(cropTransform({ x: 0, y: 0, width: 1 }, 1)).toEqual({
      transform: 'translate(0%, 0%) scale(1)',
      zoom: 1,
    });
  });

  it('travels a kenBurns across its own shot and no further', () => {
    // Shot 0 is 0..3000 with a kenBurns from the full frame to a 0.96 square.
    expect(frameAt(0).photo?.zoom).toBe(1);
    // easeInOut at the midpoint is exactly 0.5 → a 0.98 square.
    expect(frameAt(1_500).photo?.zoom).toBe(1.0204);
    expect(frameAt(2_999).photo?.zoom).toBeGreaterThan(1.02);
    // The next shot starts from its own crop, not from where the travel ended.
    expect(frameAt(3_000).photo?.zoom).toBe(1.1111);
  });

  it('composes a punch on top without passing the level ceiling', () => {
    // Shot 1 is punchIn (ceiling 1.25x) with a 0.9 crop and a 1.1x punch at
    // 3600..3800. The schema checked the composed zoom; the player composes it.
    const peak = frameAt(3_700).photo?.zoom ?? 0;

    expect(peak).toBeGreaterThan(1.11);
    expect(peak).toBeLessThanOrEqual(1.25);
    // Outside the punch window the shot sits at its own crop.
    expect(frameAt(3_500).photo?.zoom).toBe(1.1111);
    expect(frameAt(3_900).photo?.zoom).toBe(1.1111);
  });

  it('reads backdropBlur as the media receding, and only on its own shot', () => {
    expect(frameAt(6_000).photo).toMatchObject({ blurPx: 24, dim: 0.3 });
    expect(frameAt(3_500).photo).toMatchObject({ blurPx: 0, dim: 0 });
  });
});

describe('a text card', () => {
  it('prints the reviewed sentence its token names, over a blurred bed', () => {
    // Shot 3 (7600..9800) is the typographic card naming `hook`.
    const frame = frameAt(8_000);

    expect(frame.photo).toBeNull();
    expect(frame.card?.text).toBe(TEXT.hook);
    // The bed is the nearest photo shot before it, held still.
    expect(frame.backdrop?.assetId).toBe(photoId(3));
    expect(frame.backdrop?.blurPx).toBeGreaterThan(0);
    expect(sceneV2ActivePhotoIndex(frame)).toBe(2);
  });

  it('reveals over its own revealMs and then holds', () => {
    expect(frameAt(7_600).card?.reveal).toBe(0);
    expect(frameAt(7_800).card?.reveal).toBe(0.75);
    expect(frameAt(9_000).card?.reveal).toBe(1);
  });

  it('skips the card when the revision carries no such sentence', () => {
    // A legacy revision (no reviewed structure) and a blank field are the same
    // answer: draw nothing. A placeholder here would be unapproved text on a
    // 92px card.
    expect(frameAt(8_000, { text: null }).card).toBeNull();
    expect(frameAt(8_000, { text: { ...TEXT, hook: '   ' } }).card).toBeNull();
    // …and the shot still renders its bed rather than crashing or going blank.
    expect(frameAt(8_000, { text: null }).backdrop?.assetId).toBe(photoId(3));
  });
});

describe('a word accent', () => {
  // Read out of the fixture rather than written down: the canonical scene gets
  // retimed whenever the flash budget tightens, and these assertions are about
  // the accent's behaviour, not about which millisecond it lands on.
  const accent = firstWordPop(scene()).effect;
  const midAccentMs = Math.floor((accent.startMs + accent.endMs) / 2);

  it('lifts the word its reference points at', () => {
    const frame = frameAt(midAccentMs);

    expect(frame.wordPop?.text).toBe('Tuesdays');
    expect(frame.wordPop?.scale).toBeGreaterThan(1);
    expect(frame.wordPop?.scale).toBeLessThanOrEqual(1.3);
  });

  it('skips silently when the transcript cannot resolve the reference', () => {
    // Exactly a pre-A7 recording: the row has no word timings, so nothing can be
    // lifted. The scene still plays.
    const noWords = frameAt(midAccentMs, { words: [] });

    expect(noWords.wordPop).toBeNull();
    expect(noWords.photo?.assetId).toBe(photoId(2));
    // A list that resolves a different word is the same case.
    expect(
      frameAt(midAccentMs, { words: [{ segmentIndex: 9, wordIndex: 9, text: 'nope' }] }).wordPop,
    ).toBe(null);
    // A blank word is not a word.
    expect(
      frameAt(midAccentMs, { words: [{ segmentIndex: 0, wordIndex: 3, text: ' ' }] }).wordPop,
    ).toBe(null);
  });

  it('shows nothing outside the accent window', () => {
    expect(frameAt(accent.startMs - 1).wordPop).toBeNull();
    expect(frameAt(accent.endMs).wordPop).toBeNull();
  });
});

describe('a count badge', () => {
  it('prints the quality its source token names', () => {
    expect(frameAt(6_000).badge).toEqual({
      text: TEXT.three_specific_qualities[0],
      emphasis: 0.8,
      // Mid-window, so the ramp has long since finished.
      opacity: 1,
    });
  });

  it('skips when that quality is not on this revision', () => {
    expect(frameAt(6_000, { text: null }).badge).toBeNull();
    expect(
      frameAt(6_000, { text: { ...TEXT, three_specific_qualities: ['', 'b', 'c'] } }).badge,
    ).toBeNull();
  });
});

describe('the scene-wide look', () => {
  it('carries the grade through verbatim', () => {
    const frame = frameAt(1_000);

    expect(frame.filter).toBe('contrast(1.1) saturate(1.05)');
    expect(frame.warmth).toBe(0.3);
    expect(frame.vignette).toBe(0.25);
  });

  it('animates grain from the frozen seed, never from a random number', () => {
    // animationHz 24, so the phase steps 24 times a second across 4 seeded tiles.
    expect(frameAt(0).grain).toEqual({ opacity: 0.12, seed: 1_234_567, sizePx: 2 });
    expect(frameAt(100).grain?.seed).toBe(1_234_569);
    // Same millisecond, same tile — every time.
    expect(frameAt(100).grain?.seed).toBe(frameAt(100).grain?.seed);
    expect(grainTileUri(1_234_567, 2)).toBe(grainTileUri(1_234_567, 2));
    expect(grainTileUri(1_234_567, 2)).not.toBe(grainTileUri(1_234_568, 2));
  });

  it('runs the light leak on its own envelope', () => {
    // 7400..7700, peak 0.4, 2Hz. Zero at the edges so it cannot pop.
    expect(frameAt(7_400).lightLeak?.opacity).toBe(0);
    expect(frameAt(7_550).lightLeak?.opacity).toBeGreaterThan(0);
    expect(frameAt(7_550).lightLeak?.angleDeg).toBe(35);
    expect(frameAt(7_700).lightLeak).toBeNull();
  });

  it('drives the progress bar off the approved duration', () => {
    expect(frameAt(0).progressBar).toEqual({
      percent: 0,
      thicknessPx: 4,
      opacity: 0.6,
      anchor: 'bottom',
    });
    expect(frameAt(7_200).progressBar?.percent).toBe(50);
    // Clamped, not extrapolated, past the end.
    expect(frameAt(99_999).progressBar?.percent).toBe(100);
  });

  it('never renders waveViz, even when a scene carries one', () => {
    // Phase 2 templates do not emit waveViz and this player does not draw it, so
    // a scene that has one must be indistinguishable from one that does not.
    const withWave = scene();
    const withoutWave: PitchSceneV2 = {
      ...withWave,
      chrome: { progressBar: withWave.chrome.progressBar },
    };

    expect(withWave.chrome.waveViz).not.toBeUndefined();
    expect(sceneV2Frame(withWave, indexes(withWave), 6_000, options())).toEqual(
      sceneV2Frame(withoutWave, indexes(withoutWave), 6_000, options()),
    );
  });
});

describe('prefers-reduced-motion degrades to a crossfaded shot list', () => {
  const reduced = (elapsedMs: number) => frameAt(elapsedMs, { reducedMotion: true });

  it('holds every shot still', () => {
    // The crop still applies — a static framing is not motion — but it does not
    // travel and it does not punch.
    expect(reduced(0).photo?.zoom).toBe(1);
    expect(reduced(2_999).photo?.zoom).toBe(1);
    expect(reduced(3_700).photo?.zoom).toBe(1.1111);
  });

  it('drops the flash and freezes the grain', () => {
    expect(reduced(7_550).lightLeak).toBeNull();
    expect(reduced(100).grain?.seed).toBe(1_234_567);
    // The texture itself is not the problem, so it is kept at full strength.
    expect(reduced(100).grain?.opacity).toBe(0.12);
  });

  it('still shows every word and sentence the scene references', () => {
    // Reduced motion is not reduced content: the card and the accent are text the
    // Dater approved, so they appear — just without the pop.
    // reveal is 1 from the first frame (no slide) while opacity still ramps: the
    // card fades in and then holds, which is the one motion reduced motion keeps.
    const accent = firstWordPop(scene()).effect;

    expect(reduced(8_000).card).toEqual({ text: TEXT.hook, emphasis: 1, reveal: 1, opacity: 1 });
    expect(reduced(Math.floor((accent.startMs + accent.endMs) / 2)).wordPop).toEqual({
      text: 'Tuesdays',
      scale: 1,
      opacity: 1,
    });
    expect(reduced(6_000).badge?.text).toBe(TEXT.three_specific_qualities[0]);
  });
});

// --- F3: nothing pops on ----------------------------------------------------

/** The steepest opacity change any text layer may make in one millisecond. */
const MAX_OPACITY_PER_MS = 1 / MIN_TEXT_RAMP_MS;
/** The interpreter rounds opacity to 4 places, so one step can round up. */
const ROUNDING_SLACK = 0.0001;

type TextLayer = 'wordPop' | 'card' | 'badge';
const TEXT_LAYERS: readonly TextLayer[] = ['wordPop', 'card', 'badge'];

/** Each text layer's opacity, or null when the layer is not on screen at all. */
function textOpacity(frame: SceneV2Frame, layer: TextLayer): number | null {
  return frame[layer]?.opacity ?? null;
}

describe('no text layer arrives or leaves as a step (F3)', () => {
  const subject = scene();
  const bound = indexes(subject);
  const at = (elapsedMs: number, reducedMotion: boolean) =>
    sceneV2Frame(subject, bound, elapsedMs, options({ reducedMotion }));

  const windows: readonly (readonly [
    TextLayer,
    { readonly startMs: number; readonly endMs: number },
  ])[] = [
    ['wordPop', firstWordPop(subject).effect],
    ['badge', firstCountBadge(subject)],
    ['card', firstCardWindow(subject)],
  ];

  it('pins the ramp floor the deputy conditions require', () => {
    // The value is the contract, not an implementation detail: a shorter fade is
    // still perceived as a flash, which is why 150ms is a floor and not a taste.
    expect(MIN_TEXT_RAMP_MS).toBe(150);
    expect(MIN_TEXT_RAMP_MS).toBeGreaterThanOrEqual(150);
  });

  it('opens every text layer at zero and closes it back at zero', () => {
    for (const [layer, window] of windows) {
      for (const reducedMotion of [false, true]) {
        const opacityAt = (elapsedMs: number) => textOpacity(at(elapsedMs, reducedMotion), layer);
        const where = `${layer} (reducedMotion=${reducedMotion})`;

        // Mounted, and invisible on its first millisecond.
        expect(opacityAt(window.startMs), where).toBe(0);
        expect(opacityAt(window.startMs + 1), where).toBeLessThanOrEqual(
          MAX_OPACITY_PER_MS + ROUNDING_SLACK,
        );
        // …and all but invisible on its last, so unmounting is not a step either.
        expect(opacityAt(window.endMs - 1), where).toBeLessThanOrEqual(
          MAX_OPACITY_PER_MS + ROUNDING_SLACK,
        );
        if (window.endMs < subject.durationMs) {
          expect(opacityAt(window.endMs), where).toBeNull();
        }
      }
    }
  });

  it('reaches full opacity once the ramp has run, and holds there', () => {
    for (const [layer, window] of windows) {
      // Only meaningful for a window with room for both ramps; the schema's
      // shortest wordPop (120ms) deliberately never gets there.
      if (window.endMs - window.startMs < 2 * MIN_TEXT_RAMP_MS) {
        continue;
      }
      for (const reducedMotion of [false, true]) {
        expect(textOpacity(at(window.startMs + MIN_TEXT_RAMP_MS, reducedMotion), layer)).toBe(1);
        const middle = Math.floor((window.startMs + window.endMs) / 2);
        expect(textOpacity(at(middle, reducedMotion), layer)).toBe(1);
      }
    }
  });

  it('never moves a text opacity faster than the ramp, at any millisecond of the scene', () => {
    // The whole timeline at 1ms, both modes. An unmounted layer counts as
    // transparent, so mounting one at full opacity — exactly F3 — is a violation
    // rather than an invisible gap in the scan.
    for (const reducedMotion of [false, true]) {
      let previous = at(0, reducedMotion);
      for (let elapsedMs = 1; elapsedMs <= subject.durationMs; elapsedMs += 1) {
        const current = at(elapsedMs, reducedMotion);
        for (const layer of TEXT_LAYERS) {
          const before = textOpacity(previous, layer) ?? 0;
          const now = textOpacity(current, layer) ?? 0;
          expect(
            Math.abs(now - before),
            `${layer} at ${elapsedMs}ms (reducedMotion=${reducedMotion})`,
          ).toBeLessThanOrEqual(MAX_OPACITY_PER_MS + ROUNDING_SLACK);
        }
        previous = current;
      }
    }
  });

  it('shows a shorter-than-a-ramp accent dim rather than popping it on', () => {
    // MIN_WORD_POP_MS is 120ms, which is shorter than a ramp in plus a ramp out.
    // The trapezoid then peaks at 0.4 instead of steepening: dimmer is the safe
    // direction, and the flash rule holds for every window the schema allows.
    const { shotIndex, effect } = firstWordPop(subject);
    const shortened = withShotEffects(subject, shotIndex, [
      { ...effect, endMs: effect.startMs + 120 },
    ]);
    let peak = 0;
    for (let elapsedMs = effect.startMs; elapsedMs < effect.startMs + 120; elapsedMs += 1) {
      const frame = sceneV2Frame(shortened, bound, elapsedMs, options());
      peak = Math.max(peak, frame.wordPop?.opacity ?? 0);
    }

    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(0.4);
  });
});

describe('reduced motion suppresses every periodic luminance layer', () => {
  const subject = scene();
  const bound = indexes(subject);
  const at = (elapsedMs: number) =>
    sceneV2Frame(subject, bound, elapsedMs, options({ reducedMotion: true }));

  /**
   * What reduced motion promises about each field of a frame. Exhaustive over
   * SceneV2Frame ON PURPOSE: F3 happened because a layer was added (a scrim) and
   * silently inherited no rule at all. A new field fails to compile here until
   * somebody decides which of these it is, and the key check below fails at
   * runtime for the same reason.
   */
  type ReducedRule =
    | 'timeline' // where we are in the approved timeline; not a luminance layer
    | 'frozen' // identical at every millisecond of the scene
    | 'stillWithinShot' // may change at a cut, never inside a shot
    | 'suppressed' // not rendered at all
    | 'rampedText'; // may only fade in and out, at ramp speed

  const REDUCED_MOTION_RULES: Readonly<Record<keyof SceneV2Frame, ReducedRule>> = {
    shotIndex: 'timeline',
    level: 'timeline',
    progressBar: 'timeline',
    photo: 'stillWithinShot',
    backdrop: 'stillWithinShot',
    filter: 'frozen',
    warmth: 'frozen',
    vignette: 'frozen',
    grain: 'frozen',
    lightLeak: 'suppressed',
    wordPop: 'rampedText',
    card: 'rampedText',
    badge: 'rampedText',
  };

  it('classifies every field a frame carries', () => {
    expect(Object.keys(at(0)).sort()).toEqual(Object.keys(REDUCED_MOTION_RULES).sort());
  });

  it('honours the rule each layer was given', () => {
    const shots = subject.shots;
    for (const [field, rule] of Object.entries(REDUCED_MOTION_RULES) as readonly (readonly [
      keyof SceneV2Frame,
      ReducedRule,
    ])[]) {
      switch (rule) {
        case 'timeline':
          break;
        case 'frozen': {
          const opening = JSON.stringify(at(0)[field]);
          for (let elapsedMs = 0; elapsedMs <= subject.durationMs; elapsedMs += 13) {
            expect(JSON.stringify(at(elapsedMs)[field]), `${field} at ${elapsedMs}ms`).toBe(
              opening,
            );
          }
          break;
        }
        case 'stillWithinShot': {
          for (const shot of shots) {
            const opening = JSON.stringify(at(shot.startMs)[field]);
            for (let elapsedMs = shot.startMs; elapsedMs < shot.endMs; elapsedMs += 17) {
              expect(JSON.stringify(at(elapsedMs)[field]), `${field} at ${elapsedMs}ms`).toBe(
                opening,
              );
            }
          }
          break;
        }
        case 'suppressed': {
          for (let elapsedMs = 0; elapsedMs <= subject.durationMs; elapsedMs += 7) {
            expect(at(elapsedMs)[field], `${field} at ${elapsedMs}ms`).toBeNull();
          }
          break;
        }
        case 'rampedText': {
          // Covered per-millisecond by the F3 suite above; here we only insist
          // that the layer is still allowed to exist, because reduced motion is
          // not reduced content.
          const layer = field as TextLayer;
          expect(TEXT_LAYERS).toContain(layer);
          break;
        }
        default: {
          const exhaustive: never = rule;
          throw new Error(`unclassified reduced-motion rule ${String(exhaustive)}`);
        }
      }
    }
  });

  it('never mounts a light leak, at any millisecond, for any pulse rate', () => {
    // Not "pinned to a static opacity": a frozen leak is a bright wash over a
    // photo nobody approved as a still. Absence is the whole promise, so it is
    // checked against the loudest leak the schema can carry.
    const loudest: PitchSceneOverlayV2 = {
      type: 'lightLeak',
      startMs: 0,
      endMs: 1_200,
      peakIntensity: 0.6,
      pulseHz: 3,
      angleDeg: 35,
    };
    const attacked: PitchSceneV2 = { ...subject, overlays: [loudest] };
    for (let elapsedMs = 0; elapsedMs <= 1_200; elapsedMs += 1) {
      expect(
        sceneV2Frame(attacked, bound, elapsedMs, options({ reducedMotion: true })).lightLeak,
      ).toBeNull();
    }
    // …and with motion on it does render, so the assertion above is not vacuous.
    expect(sceneV2Frame(attacked, bound, 600, options()).lightLeak).not.toBeNull();
  });

  it('keeps the stage clock at frame rate in both modes', () => {
    // The ramp is only a ramp if it is SAMPLED like one: the player's timeupdate
    // prop lands about every 250ms, so gating the stage's requestAnimationFrame
    // loop on motion mode would render a 150ms fade as one step. There is no DOM
    // in this suite, so the gate is checked at the source.
    const source = readFileSync(
      new URL('../src/components/MotionSceneV2.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('const followingClock = isPlaying;');
    expect(source).not.toContain('!reducedMotion');
  });
});

describe('the light leak pulses where the flash budget says it does', () => {
  // The schema, the SQL and the builder all count a leak's pulse peaks as
  // startMs + floor(k * 1000 / pulseHz) with k = 0 included. The web pulse is a
  // cosine, so this is the one place the three implementations' shared model is
  // checked against what a viewer actually sees.
  const subject = scene();
  const bound = indexes(subject);

  it('peaks at every k, for every integer pulse rate the schema allows', () => {
    for (const pulseHz of [1, 2, 3]) {
      const leak: PitchSceneOverlayV2 = {
        type: 'lightLeak',
        startMs: 0,
        endMs: 1_200,
        peakIntensity: 0.6,
        pulseHz,
        angleDeg: 35,
      };
      // Deliberately an input the tightened schema REJECTS (a 3Hz leak over
      // 1.2s is the P8 attack scene): the interpretation of the pulse is what is
      // under test, and the interpreter never validates.
      const pulsed: PitchSceneV2 = { ...subject, overlays: [leak] };
      const opacityAt = (elapsedMs: number) =>
        sceneV2Frame(pulsed, bound, elapsedMs, options()).lightLeak?.opacity ?? 0;
      const envelopeAt = (elapsedMs: number) =>
        leak.peakIntensity *
        Math.sin((Math.PI * (elapsedMs - leak.startMs)) / (leak.endMs - leak.startMs));

      let peaks = 0;
      for (let k = 0; ; k += 1) {
        const peakMs = leak.startMs + Math.floor((k * 1000) / pulseHz);
        if (peakMs >= leak.endMs) {
          break;
        }
        peaks += 1;
        // At a peak the pulse factor is 1, so the opacity IS the envelope. 1000/3
        // is not an integer, so allow the one-millisecond grid error (and the
        // interpreter's own rounding to four places).
        expect(opacityAt(peakMs), `${pulseHz}Hz peak k=${k}`).toBeCloseTo(envelopeAt(peakMs), 3);
        // Half a period later the pulse is at its trough, which is what makes the
        // assertion above about ALIGNMENT rather than about the envelope.
        const troughMs = peakMs + Math.floor(500 / pulseHz);
        if (troughMs < leak.endMs) {
          expect(opacityAt(troughMs), `${pulseHz}Hz trough k=${k}`).toBeLessThan(
            envelopeAt(troughMs) * 0.01 + 0.0002,
          );
        }
      }
      // The event count the flash budget charges this leak: 2, 3 and 4 for 1, 2
      // and 3Hz over 1.2s. (The 3Hz case is the P8 attack scene's leak.)
      expect(peaks, `${pulseHz}Hz peaks`).toBe(pulseHz + 1);
    }
  });

  it('treats pulseHz 0 as one appearance with no pulse', () => {
    // Integer 0..3 (schema): nothing here divides by pulseHz, so the floor()
    // model in SQL and the cosine here cannot disagree on a fractional rate.
    const leak: PitchSceneOverlayV2 = {
      type: 'lightLeak',
      startMs: 0,
      endMs: 1_000,
      peakIntensity: 0.5,
      pulseHz: 0,
      angleDeg: 10,
    };
    const steady: PitchSceneV2 = { ...subject, overlays: [leak] };
    const opacityAt = (elapsedMs: number) =>
      sceneV2Frame(steady, bound, elapsedMs, options()).lightLeak?.opacity ?? 0;

    // A single sin envelope: up once, down once, no oscillation. Rounding to four
    // places makes neighbouring frames equal near the top, so the property is
    // "one hump" — never up again after coming down — rather than a step count.
    expect(opacityAt(0)).toBe(0);
    expect(opacityAt(500)).toBe(0.5);
    let falling = false;
    for (let elapsedMs = 1; elapsedMs < 1_000; elapsedMs += 1) {
      const delta = opacityAt(elapsedMs) - opacityAt(elapsedMs - 1);
      if (delta < 0) {
        falling = true;
      }
      expect(falling && delta > 0, `rose again at ${elapsedMs}ms`).toBe(false);
    }

    expect(falling).toBe(true);
  });
});

describe('binding a scene to the photos the page renders', () => {
  it('fails closed when a referenced photo is not on the page', () => {
    // The state after the Dater excludes a photo and before the save rebuilds the
    // scene. Playing it would show a photo they just removed.
    expect(sceneV2PhotoIndexes(scene(), [photoId(1), photoId(2)])).toBeNull();
    expect(sceneV2PhotoIndexes(scene(), [null, null, null, null])).toBeNull();
  });

  it('binds by asset id, not by position', () => {
    const reordered = sceneV2PhotoIndexes(scene(), [
      photoId(4),
      photoId(3),
      photoId(2),
      photoId(1),
    ]);

    expect(reordered?.get(photoId(1))).toBe(3);
    expect(reordered?.get(photoId(4))).toBe(0);
  });

  it('prints a shot signature the QA surfaces can compare', () => {
    expect(sceneV2ShotSignature(scene(), indexes())).toBe(
      '0:0-3000,1:3000-5400,2:5400-7600,t:7600-9800,3:9800-12000,0:12000-14400',
    );
  });

  it('keeps the v1 reader out of a v2 scene', () => {
    // A v1 scene is a window list and a v2 scene is a shot list. Flattening one
    // into the other would hand the Dater's approval to a timeline they never
    // saw, so each reader returns null for the other's version (A4).
    expect(sceneMotionWindows(scene(), PHOTOS)).toBeNull();
    expect(asPitchSceneV2(null)).toBeNull();
  });
});

describe('the interpreter is a function of the scene and the clock', () => {
  it('clamps the clock instead of falling off the shot list', () => {
    const subject = scene();

    expect(activeShotIndex(subject, -5_000)).toBe(0);
    expect(activeShotIndex(subject, 5_399)).toBe(1);
    expect(activeShotIndex(subject, 5_400)).toBe(2);
    expect(activeShotIndex(subject, 999_999)).toBe(5);
    expect(frameAt(-1_000).shotIndex).toBe(0);
    expect(frameAt(999_999).shotIndex).toBe(5);
  });

  it('returns the identical frame for the identical millisecond', () => {
    expect(frameAt(4_000)).toEqual(frameAt(4_000));
    expect(frameAt(7_550)).toEqual(frameAt(7_550));
  });

  it('draws no runtime randomness or wall clock', () => {
    // The frozen-at-build-time property, checked at the source: one Math.random
    // or Date.now in here and "approve once, play identically everywhere" is over.
    const source = readFileSync(new URL('../src/pitch/sceneV2.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('Math.random');
    expect(source).not.toContain('Date.now');
    expect(source).not.toContain('performance.now');
  });
});

describe('a builder scene plays as built', () => {
  it('interprets what buildPitchSceneV2 produces, end to end', () => {
    // The consent save path's own output, not a hand-written fixture: if the
    // builder and the interpreter disagree about a field, this is where it shows.
    const built = buildPitchSceneV2({
      template: 'hype',
      photoAssetIds: [photoId(1), photoId(2)],
      segments: [
        { startMs: 0, endMs: 4_000 },
        { startMs: 4_000, endMs: 11_000 },
        { startMs: 11_000, endMs: 18_000 },
        { startMs: 18_000, endMs: 24_000 },
      ],
      words: [
        { segmentIndex: 0, wordIndex: 0, startMs: 200, endMs: 700 },
        { segmentIndex: 1, wordIndex: 0, startMs: 4_200, endMs: 4_800 },
      ],
      structure: {
        ...TEXT,
        three_specific_qualities: [...TEXT.three_specific_qualities],
        hard_claims_requiring_confirmation: [],
      },
    });
    if (built === null) {
      throw new Error('the builder must produce a scene for four segments');
    }
    const bound = sceneV2PhotoIndexes(built, [photoId(1), photoId(2)]);
    if (bound === null) {
      throw new Error('a built scene must bind to the photos it was built from');
    }

    expect(built.template).toBe('hype');
    expect(built.durationMs).toBe(24_000);
    // Every millisecond of the approved timeline resolves to a frame, and every
    // photo frame stays inside its level's zoom ceiling.
    for (let elapsedMs = 0; elapsedMs < built.durationMs; elapsedMs += 137) {
      const frame = sceneV2Frame(built, bound, elapsedMs, {
        words: [
          { segmentIndex: 0, wordIndex: 0, text: 'Okay' },
          { segmentIndex: 1, wordIndex: 0, text: 'Blair' },
        ],
        text: TEXT,
        reducedMotion: false,
      });
      expect(frame.photo === null ? frame.backdrop !== null : true).toBe(true);
      expect((frame.photo ?? frame.backdrop)?.zoom ?? 1).toBeLessThanOrEqual(1.5);
    }
  });
});
