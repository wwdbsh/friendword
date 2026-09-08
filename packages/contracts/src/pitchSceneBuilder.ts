import { z } from 'zod';

import { PITCH_SCENE_CANVAS, type PitchSceneSegment } from './pitchScene';
import {
  MAX_COUNT_BADGE_MS,
  MAX_LIGHT_LEAK_MS,
  MAX_OVERLAYS_PER_SCENE,
  MAX_SCENE_ASSETS,
  MAX_SCENE_DURATION_MS,
  MAX_SHOT_DURATION_MS,
  MAX_SHOTS_PER_SCENE,
  MAX_STATIC_SHOT_MS,
  MAX_TRANSCRIPT_SEGMENT_INDEX,
  MAX_TRANSCRIPT_WORD_INDEX,
  MAX_WORD_POP_MS,
  MIN_COUNT_BADGE_MS,
  MIN_FLASH_INTERVAL_MS,
  MIN_LIGHT_LEAK_MS,
  MIN_SCENE_DURATION_MS_V2,
  MIN_SHOT_DURATION_MS,
  MIN_WORD_POP_MS,
  PITCH_SCENE_V2_SCHEMA_VERSION,
  lightLeakFlashPeaks,
  pitchSceneV2Schema,
  type PitchCropRect,
  type PitchEasing,
  type PitchPhotoShotLevel,
  type PitchSceneOverlayV2,
  type PitchSceneTemplate,
  type PitchSceneV2,
  type PitchShotEffectV2,
  type PitchTextSource,
} from './pitchSceneV2';
import {
  sanitizeTranscriptWords,
  type SanitizedWord,
  type TranscriptWordTiming,
} from './transcriptWords';

// The PitchScene v2 builder — the one place four photos become a dozen shots.
//
// It is a pure function of its input. No clock, no randomness, no I/O: the same
// recording always yields byte-identical JSON, which is what makes "the Dater
// approved THIS scene" a checkable statement rather than a hope. The grain seed
// is a hash of the input for the same reason.
//
// Three ideas do all the work:
//
// 1. A BEAT GRID derived from silence. We have no music (A6) and no audio
//    envelope yet (ffmpeg is Phase 4), so the only rhythm available is the
//    friend's own breathing: a gap of >=700ms between words is a section, 350-699ms
//    is a phrase, and every word onset is a possible accent. Cuts snap to those
//    gaps, never into the middle of a word. With no word timings the segment
//    boundaries carry the grid alone — a deterministic downgrade, not a fabricated
//    rhythm.
//
// 2. A CROP LADDER. Each photo is revisited at a different framing
//    (wide -> punchIn -> detail -> wideAlt) so a second appearance reads as a
//    camera move rather than a repeat, and the same (photo, framing) pair never
//    returns inside MIN_LADDER_REPEAT_GAP_SHOTS.
//
// 3. TEMPLATES ARE PARAMETER TABLES. `warm` and `hype` share every rule below and
//    differ only in numbers. Adding a template must never add a code path, which
//    is what keeps the closed effect vocabulary closed.
//
// Two deliberate omissions, both honesty rather than scope:
//
//  - `chrome.waveViz` is never emitted. Its `amplitudes` are supposed to be a
//    baked voice envelope, and we do not have one until Phase 4 adds ffmpeg.
//    Drawing word density as if it were a waveform would be a picture claiming to
//    be a measurement (CLAUDE.md rule 12). The field stays in the schema.
//  - `backdropBlur` is never emitted. These templates never composite text over a
//    photo: kineticText exists only on a typographic shot, and a countBadge only
//    ever accompanies the card naming the same sentence. With nothing to separate,
//    a blur would only degrade a photo the Dater approved.

const uuidSchema = z.string().uuid();

/** Silence long enough to read as a paragraph break: a hard cut lands here. */
const SECTION_GAP_MS = 700;
/** Silence long enough to read as a comma: a softer boundary. */
const PHRASE_GAP_MS = 350;

/**
 * How far a shot boundary may move to reach a real pause. Wide enough to find one
 * in normal speech, narrow enough that shots stay near their target length.
 */
const SNAP_TOLERANCE_MS = 600;

/** A punch may not land on the cut itself; it needs to read as a second beat. */
const PUNCH_LEAD_IN_MS = 240;

/** Extra hold beyond the spoken word, so a pop does not vanish mid-syllable. */
const WORD_POP_TAIL_MS = 140;

const COUNT_BADGE_INSET_MS = 100;

/** Cards are punctuation, not the film. */
const MAX_TEXT_CARDS = 4;

/** Ladder order. Every photo starts wide; the tighter rungs are earned by reuse. */
const LADDER: readonly PitchPhotoShotLevel[] = ['wide', 'punchIn', 'detail', 'wideAlt'];

/**
 * The two crop sizes each ladder step travels between, as a side length in
 * canvas-normalized space (zoom = 1 / side). Every value clears its level's floor
 * in CROP_LEVEL_MIN_SIZE with enough headroom that the level's tightest crop times
 * the loudest punch still fits under the level's zoom ceiling — `wide` is the one
 * level with no such headroom, which is why no punch is ever placed on it.
 */
const LEVEL_SIDES: Readonly<Record<PitchPhotoShotLevel, { open: number; close: number }>> = {
  wide: { open: 1, close: 0.965 },
  punchIn: { open: 0.9, close: 0.86 },
  detail: { open: 0.78, close: 0.74 },
  wideAlt: { open: 0.96, close: 0.925 },
};

/**
 * Where each framing aims. Above centre on purpose: in a portrait the face sits in
 * the upper third, and we have no face detection yet (Phase 3), so the ladder
 * biases upward as the crop tightens instead of drifting onto a torso.
 */
const LEVEL_CENTER: Readonly<Record<PitchPhotoShotLevel, { x: number; y: number }>> = {
  wide: { x: 0.5, y: 0.46 },
  punchIn: { x: 0.5, y: 0.4 },
  detail: { x: 0.5, y: 0.34 },
  wideAlt: { x: 0.5, y: 0.44 },
};

/** Lateral travel of a move, so a ladder step pans as well as zooms. */
const LATERAL_DRIFT = 0.03;

type TemplateParams = {
  readonly targetShotMs: number;
  readonly grade: {
    readonly warmth: number;
    readonly contrast: number;
    readonly saturation: number;
    readonly vignette: number;
  };
  readonly grain: {
    readonly intensity: number;
    readonly sizePx: number;
    readonly animationHz: number;
  };
  readonly progressBar: {
    readonly thicknessPx: number;
    readonly opacity: number;
    readonly anchor: 'top' | 'bottom';
  };
  readonly moveEasing: PitchEasing;
  /** Which ladder steps may carry a punch. `wide` is never among them (see LEVEL_SIDES). */
  readonly punchLevels: readonly PitchPhotoShotLevel[];
  readonly punchScale: number;
  readonly punchDurationMs: number;
  readonly punchEasing: PitchEasing;
  readonly wordPopsPerShot: number;
  readonly wordPopScale: number;
  readonly wordPopMaxMs: number;
  readonly wordPopEasing: PitchEasing;
  readonly lightLeak: {
    readonly durationMs: number;
    readonly peakIntensity: number;
    readonly pulseHz: number;
    readonly angleDeg: number;
  } | null;
  readonly card: {
    readonly revealMs: number;
    readonly easing: PitchEasing;
    readonly emphasis: number;
  };
  readonly badgeEmphasis: number;
};

/**
 * The whole difference between the two templates. `warm` breathes: long shots, one
 * slow move, an occasional accent. `hype` cuts short, punches on every framing
 * that has zoom headroom, and burns a light leak through every section break.
 */
const TEMPLATES: Readonly<Record<PitchSceneTemplate, TemplateParams>> = {
  warm: {
    targetShotMs: 2800,
    grade: { warmth: 0.3, contrast: 1.08, saturation: 1.05, vignette: 0.28 },
    grain: { intensity: 0.06, sizePx: 2, animationHz: 24 },
    progressBar: { thicknessPx: 3, opacity: 0.45, anchor: 'bottom' },
    moveEasing: 'easeInOut',
    punchLevels: ['punchIn', 'detail'],
    punchScale: 1.04,
    punchDurationMs: 320,
    punchEasing: 'easeOut',
    wordPopsPerShot: 1,
    wordPopScale: 1.18,
    wordPopMaxMs: 560,
    wordPopEasing: 'easeOut',
    lightLeak: null,
    card: { revealMs: 420, easing: 'easeOut', emphasis: 0.75 },
    badgeEmphasis: 0.6,
  },
  hype: {
    targetShotMs: 2100,
    grade: { warmth: 0.12, contrast: 1.28, saturation: 1.22, vignette: 0.18 },
    grain: { intensity: 0.1, sizePx: 2, animationHz: 30 },
    progressBar: { thicknessPx: 5, opacity: 0.8, anchor: 'top' },
    moveEasing: 'easeOut',
    punchLevels: ['punchIn', 'detail', 'wideAlt'],
    punchScale: 1.07,
    punchDurationMs: 240,
    punchEasing: 'easeOut',
    wordPopsPerShot: 2,
    wordPopScale: 1.34,
    wordPopMaxMs: 380,
    wordPopEasing: 'easeOut',
    lightLeak: { durationMs: 240, peakIntensity: 0.38, pulseHz: 2, angleDeg: 35 },
    card: { revealMs: 220, easing: 'easeOut', emphasis: 1 },
    badgeEmphasis: 0.9,
  },
};

/**
 * The reviewed structure as the builder reads it: deeply readonly, because it only
 * ever reads. `PitchStructure` is assignable to this, and so is a frozen or
 * readonly-typed copy of one — a caller should not have to hand a pure function a
 * mutable array. `hard_claims_requiring_confirmation` is accepted and ignored: it is
 * a review artefact, never printed, and refusing the whole object over it would mean
 * callers stripping a key before they may build a scene.
 */
export type ReviewedPitchStructure = {
  readonly hook: string;
  readonly relationship_context: string;
  readonly three_specific_qualities: readonly string[];
  readonly evidence_or_anecdote: string;
  readonly good_match_for: string;
  readonly hard_claims_requiring_confirmation?: readonly string[];
};

export type BuildPitchSceneV2Input = {
  readonly template: PitchSceneTemplate;
  /** Photo asset ids in publication order (sort_order). */
  readonly photoAssetIds: readonly string[];
  /** The recording's real transcript segments. Order and overlap are repaired here. */
  readonly segments: readonly PitchSceneSegment[];
  /** Word timings from the same transcript row, if the provider returned any. */
  readonly words?: readonly TranscriptWordTiming[] | undefined;
  /**
   * The reviewed structure of the SAME revision, when it carries all five published
   * fields. Text effects name a structure field by token, so a card or badge is only
   * legal while that field exists on the row — pass nothing and the scene is built
   * without text at all rather than with a reference the database will reject.
   */
  readonly structure?: ReviewedPitchStructure | null | undefined;
  /**
   * The recording's audio length in milliseconds, as the transcription provider
   * reported it and as /api/transcribe stored it on the transcript row — read it
   * with {@link transcriptAudioDurationMs}. Absent on a transcript written before
   * T003, which then times the scene by its last segment end as it always did.
   *
   * Never a client measurement: `<audio>.duration` differs per device and per
   * decoder, and the scene has to hash identically everywhere.
   */
  readonly audioDurationMs?: number | null | undefined;
};

type BeatKind = 'section' | 'phrase' | 'word';

type Beat = { readonly atMs: number; readonly kind: BeatKind };

const BEAT_RANK: Readonly<Record<BeatKind, number>> = { section: 0, phrase: 1, word: 2 };

type PhotoShotDraft = {
  readonly level: PitchPhotoShotLevel;
  readonly assetId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly crop: PitchCropRect;
  readonly effects: readonly PitchShotEffectV2[];
};

type CardShotDraft = {
  readonly level: 'typographic';
  readonly startMs: number;
  readonly endMs: number;
  readonly text: {
    readonly type: 'kineticText';
    readonly source: PitchTextSource;
    readonly revealMs: number;
    readonly easing: PitchEasing;
    readonly emphasis: number;
  };
};

type ShotDraft = PhotoShotDraft | CardShotDraft;

type WordPopEffect = Extract<PitchShotEffectV2, { readonly type: 'wordPop' }>;
type LightLeakOverlay = Extract<PitchSceneOverlayV2, { readonly type: 'lightLeak' }>;
type CountBadgeOverlay = Extract<PitchSceneOverlayV2, { readonly type: 'countBadge' }>;

/**
 * What one photo shot would like to spend on the flash timeline: at most one punch,
 * and its wordPops already ranked by which word deserves the accent most.
 */
type ShotFlashCandidates = {
  readonly punchAtMs: number | null;
  readonly wordPops: readonly WordPopEffect[];
};

/** A boundary and the grid feature it landed on, if any. */
type Boundary = { readonly atMs: number; readonly kind: BeatKind | null };

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Crop coordinates are stored to four decimals so the JSON stays comparable. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Four decimals again, but never rounding UP: this is used on the largest offset a
 * crop may take, and 1 - 0.965 is 0.035000000000000031 in binary. Rounding that to
 * the nearest four decimals is what a reader expects to see in the JSON; rounding it
 * up would push `x + width` past the frame the Dater reviewed.
 */
function floor4(value: number): number {
  return Math.floor(value * 10_000) / 10_000;
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * The longest audio a transcript may claim, mirroring the DB's own 24-hour guard
 * on a segment end (`> 86400` seconds yields NULL there). It is not the scene
 * ceiling — {@link MAX_SCENE_DURATION_MS} is, and it is applied after the two
 * candidates are compared, so this only decides which numbers count as durations
 * at all.
 */
const MAX_TRANSCRIPT_AUDIO_DURATION_MS = 86_400_000;

// --- Input repair -----------------------------------------------------------

/**
 * THE AUDIO LENGTH the provider reported for this recording, in milliseconds, or
 * null when the stored transcript carries none.
 *
 * Mirrors `private.pitch_transcript_duration_ms` (0062), which reads the same key
 * through `private.pitch_scene_integer`: a JSON number with no fractional part,
 * inside INTEGER range, above zero and no longer than a day. Anything else is not
 * a duration and is ignored here exactly as it is there, so a transcript this
 * cannot read produces the pre-0062 answer instead of a rejected scene.
 *
 * `unknown` in, because the caller holds provider-shaped JSONB read back from a
 * row, not a parsed type.
 */
export function transcriptAudioDurationMs(transcript: unknown): number | null {
  if (typeof transcript !== 'object' || transcript === null || Array.isArray(transcript)) {
    return null;
  }
  return usableAudioDurationMs((transcript as { readonly durationMs?: unknown }).durationMs);
}

/** The reader's single rule, applied to a value however it reached us. */
function usableAudioDurationMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null;
  }
  if (value <= 0 || value > MAX_TRANSCRIPT_AUDIO_DURATION_MS) {
    return null;
  }
  return value;
}

/**
 * THE SCENE'S DURATION, by the database's rule and not by ours.
 *
 * `private.pitch_transcript_duration_ms` (0062) returns the GREATER of the
 * recording's provider-reported audio length and the end of the LAST ARRAY ELEMENT
 * — `ORDER BY ordinality DESC LIMIT 1` — of the raw transcript, and
 * `assert_scene_definition` then requires the scene's `durationMs` to equal it
 * exactly. So this is the raw last element too. Taking the maximum end instead
 * would be a nicer number and would have every submission from a provider that
 * returned two segments out of order rejected by the database.
 *
 * The audio length is the one that matters to a viewer: T003 (issue #72) found a
 * 54.5s recording whose last segment ended at 37.66s, so the player froze the
 * visuals 15s before the voice stopped. It is still not a client measurement —
 * it is what the transcription provider reported for the stored object, written
 * into the transcript by /api/transcribe — so the scene stays identical on every
 * device. The transcript end remains the floor: a provider that reports a
 * duration shorter than its own last segment cannot shorten the timeline.
 *
 * The DB's own guards are mirrored: a non-numeric end, an end at or below zero, or
 * one past 24 hours yields null there, which is "this pitch has no motion". A
 * length past the schema's own ceiling yields null here rather than a scene the
 * schema would reject — the same answer this gave before an audio length existed.
 */
function transcriptDurationMs(
  segments: readonly PitchSceneSegment[],
  audioDurationMs: number | null | undefined,
): number | null {
  const last = segments.at(-1);
  if (last === undefined || !Number.isFinite(last.endMs)) {
    return null;
  }
  const segmentEndMs = Math.round(last.endMs);
  if (segmentEndMs <= 0 || segmentEndMs > MAX_TRANSCRIPT_AUDIO_DURATION_MS) {
    return null;
  }
  const audioMs = usableAudioDurationMs(audioDurationMs);
  const durationMs = audioMs === null ? segmentEndMs : Math.max(segmentEndMs, audioMs);
  if (durationMs > MAX_SCENE_DURATION_MS) {
    return null;
  }
  return durationMs;
}

/**
 * Transcript segments arrive from a provider, not from us: they can be unordered,
 * overlapping or zero-length. The grid needs a monotonic list.
 *
 * `durationMs` is a PRE-FILTER, not a trim applied afterwards: a segment that ends
 * past the scene is cut here, before a beat grid or a shot list is derived from it,
 * so the 1200ms shot floor and the "shots cover exactly [0, durationMs]" rule stay
 * assembly invariants. Cutting a finished timeline back to length is what produces
 * a last shot below the floor.
 */
function sanitizeSegments(
  segments: readonly PitchSceneSegment[],
  durationMs: number,
): readonly PitchSceneSegment[] {
  const usable: PitchSceneSegment[] = [];
  for (const segment of segments) {
    if (!Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs)) {
      continue;
    }
    const startMs = Math.max(0, Math.round(segment.startMs));
    const endMs = Math.min(Math.max(0, Math.round(segment.endMs)), durationMs);
    if (endMs <= startMs) {
      continue;
    }
    usable.push({ startMs, endMs });
  }
  usable.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);

  const ordered: PitchSceneSegment[] = [];
  let cursorMs = 0;
  for (const segment of usable) {
    const startMs = Math.max(segment.startMs, cursorMs);
    if (segment.endMs <= startMs) {
      continue;
    }
    ordered.push({ startMs, endMs: segment.endMs });
    cursorMs = segment.endMs;
  }
  return ordered;
}

/**
 * Words we could reference. A word whose transcript position is beyond what a
 * wordPop can store is dropped rather than clamped: clamping would re-point the
 * effect at a different word.
 */
function referenceableWords(words: readonly TranscriptWordTiming[]): readonly SanitizedWord[] {
  return sanitizeTranscriptWords(words).filter(
    (word) =>
      word.segmentIndex <= MAX_TRANSCRIPT_SEGMENT_INDEX &&
      word.wordIndex <= MAX_TRANSCRIPT_WORD_INDEX,
  );
}

// --- The beat grid ----------------------------------------------------------

function classifyGap(gapMs: number, sentenceBreak: boolean): BeatKind {
  if (gapMs >= SECTION_GAP_MS) {
    return 'section';
  }
  if (gapMs >= PHRASE_GAP_MS || sentenceBreak) {
    return 'phrase';
  }
  return 'word';
}

/**
 * Cut candidates, strongest first at any given millisecond. Every candidate is a
 * point where nobody is mid-word: the moment speech resumes after a pause, or a
 * sentence boundary. Word onsets are included as the weakest rung so a short,
 * fast-cut template still has somewhere legal to land.
 */
function buildBeatGrid(
  segments: readonly PitchSceneSegment[],
  words: readonly SanitizedWord[],
  durationMs: number,
): readonly Beat[] {
  const strongest = new Map<number, BeatKind>();
  const offer = (atMs: number, kind: BeatKind): void => {
    if (atMs <= 0 || atMs >= durationMs) {
      return;
    }
    const current = strongest.get(atMs);
    if (current === undefined || BEAT_RANK[kind] < BEAT_RANK[current]) {
      strongest.set(atMs, kind);
    }
  };

  for (let index = 1; index < words.length; index += 1) {
    const previous = words[index - 1] as SanitizedWord;
    const word = words[index] as SanitizedWord;
    offer(
      word.startMs,
      classifyGap(word.startMs - previous.endMs, word.segmentIndex !== previous.segmentIndex),
    );
  }
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1] as PitchSceneSegment;
    const segment = segments[index] as PitchSceneSegment;
    offer(segment.startMs, classifyGap(segment.startMs - previous.endMs, true));
  }

  return [...strongest.entries()]
    .map(([atMs, kind]) => ({ atMs, kind }))
    .sort((left, right) => left.atMs - right.atMs);
}

// --- Shot plan --------------------------------------------------------------

/**
 * The five published fields, and only those. `hard_claims_requiring_confirmation`
 * is deliberately absent: it is a review artefact, never printed, and requiring it
 * here would reject a structure the database considers published.
 */
const publishedStructureSchema = z.object({
  hook: z.string(),
  relationship_context: z.string(),
  three_specific_qualities: z.array(z.string()).length(3),
  evidence_or_anecdote: z.string(),
  good_match_for: z.string(),
});

/**
 * Which structure fields a text effect may name. Mirrors the database's
 * "published structure" predicate: the five fields must all be present, because a
 * revision either carries the reviewed structure or carries none. An empty field is
 * treated as absent so a card can never be a blank screen.
 */
export function usableTextSources(
  structure: ReviewedPitchStructure | null | undefined,
): readonly PitchTextSource[] {
  if (structure === null || structure === undefined) {
    return [];
  }
  const parsed = publishedStructureSchema.safeParse(structure);
  if (!parsed.success) {
    return [];
  }
  const value = parsed.data;
  const sources: PitchTextSource[] = [];
  const push = (source: PitchTextSource, text: string): void => {
    if (text.trim().length > 0) {
      sources.push(source);
    }
  };
  push('hook', value.hook);
  const qualities = value.three_specific_qualities;
  // All three or none: a "1/3" badge with no 2/3 promises a passage that never
  // arrives, so the trio is only usable whole.
  if (qualities.every((quality) => quality.trim().length > 0)) {
    push('quality:0', qualities[0] as string);
    push('quality:1', qualities[1] as string);
    push('quality:2', qualities[2] as string);
  }
  push('good_match_for', value.good_match_for);
  push('evidence_or_anecdote', value.evidence_or_anecdote);
  push('relationship_context', value.relationship_context);
  return sources;
}

/**
 * The cards a scene of this size can carry, in the order they appear. The hook
 * always opens — it is the cold open, the first thing a viewer reads. The quality
 * trio is only reached once there is room for all three.
 */
function chooseCardSources(
  available: readonly PitchTextSource[],
  capacity: number,
): readonly PitchTextSource[] {
  if (capacity <= 0 || available.length === 0) {
    return [];
  }
  const has = (source: PitchTextSource): boolean => available.includes(source);
  const ordered: PitchTextSource[] = [];
  if (has('hook')) {
    ordered.push('hook');
  }
  const trio: readonly PitchTextSource[] = ['quality:0', 'quality:1', 'quality:2'];
  if (capacity >= ordered.length + trio.length && trio.every(has)) {
    ordered.push(...trio);
  } else {
    for (const source of [
      'good_match_for',
      'evidence_or_anecdote',
      'relationship_context',
    ] as const) {
      if (ordered.length >= capacity) {
        break;
      }
      if (has(source)) {
        ordered.push(source);
      }
    }
  }
  return ordered.slice(0, capacity);
}

/**
 * Where the cards sit in the shot list. Never adjacent (the schema forbids it),
 * never last (a scene should end on a face), and spread rather than clustered.
 */
function planCardSlots(totalShots: number, cardCount: number): readonly number[] {
  const slots: number[] = [];
  // A stride of at least 2 always leaves a photo between two cards. The card budget
  // (one per six shots) already implies a much larger stride; the floor is what keeps
  // the schema's "no two cards in a row" true if that budget ever changes.
  const stride = Math.max(2, Math.floor(totalShots / (cardCount + 1)));
  for (let index = 0; index < cardCount; index += 1) {
    const previous = slots[index - 1];
    const slot = previous === undefined ? 0 : previous + stride;
    if (slot > totalShots - 2) {
      break;
    }
    slots.push(slot);
  }
  return slots;
}

type ShotPlan = {
  readonly isCard: readonly boolean[];
  readonly cardSources: readonly PitchTextSource[];
};

function maxDurationFor(isCard: boolean): number {
  // A text card may not outlive its own reveal, so it caps lower than a photo.
  return isCard ? MAX_STATIC_SHOT_MS : MAX_SHOT_DURATION_MS;
}

function capacityMs(isCard: readonly boolean[]): number {
  return isCard.reduce((total, card) => total + maxDurationFor(card), 0);
}

function cardMask(totalShots: number, slots: readonly number[]): readonly boolean[] {
  return Array.from({ length: totalShots }, (_value, index) => slots.includes(index));
}

/**
 * How many shots, and which of them are cards. The count comes from the template's
 * target length, then three floors raise it: every photo needs a turn, no shot may
 * exceed its ceiling, and cards are added only while the timeline can still hold
 * them.
 */
function planShots(
  durationMs: number,
  photoCount: number,
  available: readonly PitchTextSource[],
  params: TemplateParams,
): ShotPlan | null {
  const maxShots = Math.min(Math.floor(durationMs / MIN_SHOT_DURATION_MS), MAX_SHOTS_PER_SCENE);
  const minShots = Math.max(photoCount, Math.ceil(durationMs / MAX_SHOT_DURATION_MS), 1);
  if (minShots > maxShots) {
    return null;
  }
  const base = clamp(Math.round(durationMs / params.targetShotMs), minShots, maxShots);
  // One card always (the hook is the cold open), then one more per six shots: the
  // quality trio is only reachable on a long recording, which is the only place it
  // fits without turning the film into slides.
  const wantCards = Math.min(MAX_TEXT_CARDS, 1 + Math.floor(base / 6), available.length);
  const total = Math.min(maxShots, base + wantCards);

  let slots = planCardSlots(total, wantCards);
  // A card costs a photo turn and caps its shot shorter than a photo would. When
  // either bill cannot be paid, cards go — never photos, because a photo the Dater
  // included has to appear.
  while (
    slots.length > 0 &&
    (total - slots.length < photoCount || capacityMs(cardMask(total, slots)) < durationMs)
  ) {
    slots = slots.slice(0, -1);
  }
  // The grammar may offer fewer sentences than there are slots (the quality trio is
  // all-or-nothing), so shrink the slots to what it will actually fill. Each round
  // strictly shortens the list, so this terminates.
  let sources = chooseCardSources(available, slots.length);
  while (sources.length < slots.length) {
    slots = slots.slice(0, sources.length);
    sources = chooseCardSources(available, slots.length);
  }
  const isCard = cardMask(total, slots);
  if (capacityMs(isCard) < durationMs || total - slots.length < photoCount) {
    // Unreachable: with no cards left `total >= ceil(durationMs / MAX_SHOT_DURATION_MS)`
    // and `total >= photoCount`. Kept so a future change fails closed instead of
    // emitting a timeline with a gap.
    return null;
  }
  return { isCard, cardSources: sources };
}

// --- Boundaries -------------------------------------------------------------

/**
 * Shot boundaries: evenly spaced, then pulled onto the nearest real pause, then
 * clamped so every shot stays inside its own length bounds AND leaves the shots
 * after it enough room. The clamp is what makes the snap safe — a boundary that
 * cannot move to a beat legally simply does not.
 */
function planBoundaries(
  durationMs: number,
  isCard: readonly boolean[],
  beats: readonly Beat[],
): readonly Boundary[] {
  const total = isCard.length;
  const suffixMin: number[] = new Array(total + 1).fill(0);
  const suffixMax: number[] = new Array(total + 1).fill(0);
  for (let index = total - 1; index >= 0; index -= 1) {
    suffixMin[index] = (suffixMin[index + 1] as number) + MIN_SHOT_DURATION_MS;
    suffixMax[index] = (suffixMax[index + 1] as number) + maxDurationFor(isCard[index] as boolean);
  }

  const boundaries: Boundary[] = [];
  let previousMs = 0;
  for (let index = 1; index < total; index += 1) {
    const low = Math.max(
      previousMs + MIN_SHOT_DURATION_MS,
      durationMs - (suffixMax[index] as number),
    );
    const high = Math.min(
      previousMs + maxDurationFor(isCard[index - 1] as boolean),
      durationMs - (suffixMin[index] as number),
    );
    const ideal = Math.round((index * durationMs) / total);
    const target = clamp(ideal, low, high);
    const beat = bestBeat(beats, ideal, low, high);
    const atMs = beat === null ? target : beat.atMs;
    boundaries.push({ atMs, kind: beat === null ? null : beat.kind });
    previousMs = atMs;
  }
  return boundaries;
}

/**
 * The pause a boundary should move to: strongest rung first, then closest to the
 * even split, then earliest. Only beats that are legal for this boundary are
 * considered, so snapping can never produce a shot outside its bounds.
 */
function bestBeat(
  beats: readonly Beat[],
  idealMs: number,
  lowMs: number,
  highMs: number,
): Beat | null {
  let best: Beat | null = null;
  let bestDelta = 0;
  for (const beat of beats) {
    if (beat.atMs < lowMs || beat.atMs > highMs) {
      continue;
    }
    const delta = Math.abs(beat.atMs - idealMs);
    if (delta > SNAP_TOLERANCE_MS) {
      continue;
    }
    if (
      best === null ||
      BEAT_RANK[beat.kind] < BEAT_RANK[best.kind] ||
      (BEAT_RANK[beat.kind] === BEAT_RANK[best.kind] && delta < bestDelta)
    ) {
      best = beat;
      bestDelta = delta;
    }
  }
  return best;
}

// --- Media assignment -------------------------------------------------------

type Framing = { readonly level: PitchPhotoShotLevel; readonly assetId: string };

/**
 * Which photo at which rung, per photo shot.
 *
 * With room for two shots per photo the ladder travels in pairs — wide then
 * punchIn on the same photo, which reads as a camera pushing in rather than as two
 * pictures. Below that every photo gets one turn each pass, because "every included
 * photo appears" outranks any framing idea. Either way a (photo, rung) pair cannot
 * return inside four shots.
 */
function assignFramings(photoShots: number, assetIds: readonly string[]): readonly Framing[] {
  const count = assetIds.length;
  const framings: Framing[] = [];
  const usePairs = photoShots >= 2 * count;
  for (let index = 0; index < photoShots; index += 1) {
    if (usePairs) {
      const pair = Math.floor(index / 2);
      const rung = Math.floor(pair / count) % 2;
      const step = (rung * 2 + (index % 2)) % LADDER.length;
      framings.push({
        level: LADDER[step] as PitchPhotoShotLevel,
        assetId: assetIds[pair % count] as string,
      });
    } else {
      framings.push({
        level: LADDER[Math.floor(index / count) % LADDER.length] as PitchPhotoShotLevel,
        assetId: assetIds[index % count] as string,
      });
    }
  }
  return framings;
}

function squareAt(centerX: number, centerY: number, side: number): PitchCropRect {
  const span = floor4(1 - side);
  return {
    x: clamp(round4(centerX - side / 2), 0, span),
    y: clamp(round4(centerY - side / 2), 0, span),
    width: side,
    height: side,
  };
}

/**
 * The move for one photo shot: the level's two crop sizes, taken in a direction
 * that alternates so consecutive shots do not all zoom the same way, plus a lateral
 * drift. Both ends clear the level's floor, so the composed zoom (crop x move x
 * punch) stays under the level's ceiling.
 */
function planMove(
  level: PitchPhotoShotLevel,
  ordinal: number,
): { readonly crop: PitchCropRect; readonly to: PitchCropRect } {
  const sides = LEVEL_SIDES[level];
  const center = LEVEL_CENTER[level];
  const pushIn = ordinal % 2 === 0;
  const fromSide = pushIn ? sides.open : sides.close;
  const toSide = pushIn ? sides.close : sides.open;
  const mirrored = level === 'wideAlt';
  const drift = (ordinal % 4 < 2 ? LATERAL_DRIFT : -LATERAL_DRIFT) * (mirrored ? -1 : 1);
  return {
    crop: squareAt(center.x, center.y, fromSide),
    to: squareAt(center.x + drift, center.y, toSide),
  };
}

// --- Effects ----------------------------------------------------------------

function kenBurns(to: PitchCropRect, easing: PitchEasing): PitchShotEffectV2 {
  return { type: 'kenBurns', to, easing };
}

/**
 * When a punch would land inside this shot: on the first word onset (or beat) far
 * enough past the cut to read as its own accent. No onset, no punch — an accent
 * invented at an arbitrary millisecond is not rhythm.
 */
function punchOnset(
  startMs: number,
  endMs: number,
  words: readonly SanitizedWord[],
  beats: readonly Beat[],
  params: TemplateParams,
): number | null {
  const earliest = startMs + PUNCH_LEAD_IN_MS;
  const latest = endMs - params.punchDurationMs;
  if (latest < earliest) {
    return null;
  }
  for (const word of words) {
    if (word.startMs >= earliest && word.startMs <= latest) {
      return word.startMs;
    }
  }
  for (const beat of beats) {
    if (beat.atMs >= earliest && beat.atMs <= latest) {
      return beat.atMs;
    }
  }
  return null;
}

/**
 * Every wordPop this shot COULD carry, ranked by how much it deserves the accent:
 * longer words first — with no word text available (references only, by design) a
 * longer word is the best text-free proxy for a stressed one — then earliest, so
 * the ranking never depends on sort stability.
 *
 * Each candidate is a finished effect at the millisecond its word is spoken. The
 * selection pass accepts or drops one, never moves it: a pop nudged off its word to
 * fit the flash budget would be lifting a word nobody is saying.
 */
function wordPopCandidates(
  startMs: number,
  endMs: number,
  words: readonly SanitizedWord[],
  params: TemplateParams,
): readonly WordPopEffect[] {
  const inside = words.filter(
    (word) => word.startMs >= startMs && word.startMs + MIN_WORD_POP_MS <= endMs,
  );
  const ranked = [...inside].sort(
    (left, right) =>
      right.endMs - right.startMs - (left.endMs - left.startMs) || left.startMs - right.startMs,
  );
  const candidates: WordPopEffect[] = [];
  for (const word of ranked) {
    const hold = Math.round(
      clamp(
        word.endMs - word.startMs + WORD_POP_TAIL_MS,
        MIN_WORD_POP_MS,
        Math.min(MAX_WORD_POP_MS, params.wordPopMaxMs),
      ),
    );
    const popEnd = Math.min(endMs, word.startMs + hold);
    if (popEnd - word.startMs < MIN_WORD_POP_MS) {
      continue;
    }
    candidates.push({
      type: 'wordPop',
      word: { segmentIndex: word.segmentIndex, wordIndex: word.wordIndex },
      startMs: word.startMs,
      endMs: popEnd,
      scale: params.wordPopScale,
      easing: params.wordPopEasing,
    });
  }
  return candidates;
}

// --- Assembly ---------------------------------------------------------------

function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // >>> 1 keeps the seed inside the schema's signed 32-bit range.
  return hash >>> 1;
}

function isQualitySource(source: PitchTextSource): boolean {
  return source === 'quality:0' || source === 'quality:1' || source === 'quality:2';
}

/**
 * Builds the v2 scene the Dater approves, or null when this input cannot carry a
 * legal one. Null is a real answer, not an error: the surface then falls back to
 * whatever it showed before (plan A4) rather than publishing a broken timeline.
 *
 * Null happens when there are no photos, no transcript, more photos than the
 * schema's asset ceiling, an id that is not a UUID, or a recording too short to
 * give every included photo a legal shot. Every other outcome is a scene that has
 * already passed `pitchSceneV2Schema` — see the parse at the end, which throws
 * rather than returning null, because a scene this builder cannot validate is a bug
 * in this file and must not be swallowed.
 */
export function buildPitchSceneV2(input: BuildPitchSceneV2Input): PitchSceneV2 | null {
  const assetIds = [...new Set(input.photoAssetIds)];
  if (assetIds.length === 0 || assetIds.length > MAX_SCENE_ASSETS) {
    return null;
  }
  if (!assetIds.every((assetId) => uuidSchema.safeParse(assetId).success)) {
    return null;
  }

  const durationMs = transcriptDurationMs(input.segments, input.audioDurationMs);
  if (durationMs === null || durationMs < MIN_SCENE_DURATION_MS_V2) {
    return null;
  }

  const segments = sanitizeSegments(input.segments, durationMs);
  if (segments.length === 0) {
    return null;
  }

  const params = TEMPLATES[input.template];
  const words = referenceableWords(input.words ?? []).filter((word) => word.endMs <= durationMs);
  const beats = buildBeatGrid(segments, words, durationMs);
  const plan = planShots(durationMs, assetIds.length, usableTextSources(input.structure), params);
  if (plan === null) {
    return null;
  }

  const boundaries = planBoundaries(durationMs, plan.isCard, beats);
  const framings = assignFramings(plan.isCard.filter((card) => !card).length, assetIds);

  // Pass one: the shots and everything that wants to flash. Nothing is committed to
  // the flash timeline yet, because what a punch or a pop is allowed to do depends
  // on what the leaks and badges around it already spent.
  const drafts: ShotDraft[] = [];
  const badges: CountBadgeOverlay[] = [];
  const candidates = new Map<number, ShotFlashCandidates>();
  let cardIndex = 0;
  let photoIndex = 0;
  for (const [index, isCard] of plan.isCard.entries()) {
    const startMs = index === 0 ? 0 : (boundaries[index - 1] as Boundary).atMs;
    const endMs =
      index === plan.isCard.length - 1 ? durationMs : (boundaries[index] as Boundary).atMs;
    if (isCard) {
      const source = plan.cardSources[cardIndex] as PitchTextSource;
      cardIndex += 1;
      drafts.push({
        level: 'typographic',
        startMs,
        endMs,
        text: {
          type: 'kineticText',
          source,
          revealMs: params.card.revealMs,
          easing: params.card.easing,
          emphasis: params.card.emphasis,
        },
      });
      if (isQualitySource(source)) {
        const badgeStart = startMs + COUNT_BADGE_INSET_MS;
        const badgeEnd = Math.min(endMs - COUNT_BADGE_INSET_MS, badgeStart + MAX_COUNT_BADGE_MS);
        if (badgeEnd - badgeStart >= MIN_COUNT_BADGE_MS) {
          badges.push({
            type: 'countBadge',
            source,
            startMs: badgeStart,
            endMs: badgeEnd,
            emphasis: params.badgeEmphasis,
          });
        }
      }
      continue;
    }
    const framing = framings[photoIndex] as Framing;
    const move = planMove(framing.level, photoIndex);
    photoIndex += 1;
    candidates.set(index, {
      punchAtMs: params.punchLevels.includes(framing.level)
        ? punchOnset(startMs, endMs, words, beats, params)
        : null,
      wordPops: wordPopCandidates(startMs, endMs, words, params),
    });
    drafts.push({
      ...framing,
      startMs,
      endMs,
      crop: move.crop,
      effects: [kenBurns(move.to, params.moveEasing)],
    });
  }

  const budget = applyFlashBudget(
    planLightLeaks(boundaries, durationMs, badges.length, params),
    badges,
    candidates,
    params,
  );

  // Overlays of one type must be ordered and disjoint; sorting the mixed list by
  // time keeps both types internally ordered. The type tiebreak is a plain
  // comparison rather than a locale collation so the output cannot vary by host.
  const overlays = [...budget.badges, ...budget.leaks].sort(
    (left, right) => left.startMs - right.startMs || compareText(left.type, right.type),
  );

  const scene = {
    schemaVersion: PITCH_SCENE_V2_SCHEMA_VERSION,
    template: input.template,
    canvas: { ...PITCH_SCENE_CANVAS },
    durationMs,
    assetIds,
    shots: drafts.map((shot, index) => withFlashEffects(shot, budget.effects.get(index))),
    look: {
      grade: { ...params.grade },
      grain: {
        ...params.grain,
        seed: fnv1a32(`${input.template}|${durationMs}|${assetIds.join(',')}`),
      },
    },
    chrome: { progressBar: { ...params.progressBar } },
    overlays,
  };

  // A scene this builder cannot validate is a bug here, not a bad input: throw.
  return pitchSceneV2Schema.parse(scene);
}

function withFlashEffects(
  shot: ShotDraft,
  extra: readonly PitchShotEffectV2[] | undefined,
): ShotDraft {
  if (extra === undefined || extra.length === 0 || shot.level === 'typographic') {
    return shot;
  }
  return { ...shot, effects: [...shot.effects, ...extra] };
}

/**
 * A light leak straddles a hard cut, so it reads as one transition rather than as a
 * flash inside a shot. Only section boundaries get one, and only if the template
 * asks for it.
 */
function planLightLeaks(
  boundaries: readonly Boundary[],
  durationMs: number,
  badgeCount: number,
  params: TemplateParams,
): readonly LightLeakOverlay[] {
  const leak = params.lightLeak;
  if (leak === null) {
    return [];
  }
  const budget = MAX_OVERLAYS_PER_SCENE - badgeCount;
  const half = Math.round(leak.durationMs / 2);
  const leaks: LightLeakOverlay[] = [];
  let lastEnd = 0;
  for (const boundary of boundaries) {
    if (boundary.kind !== 'section' || leaks.length >= budget) {
      continue;
    }
    const startMs = Math.max(lastEnd, boundary.atMs - half);
    const endMs = Math.min(durationMs, startMs + leak.durationMs);
    const span = endMs - startMs;
    if (span < MIN_LIGHT_LEAK_MS || span > MAX_LIGHT_LEAK_MS) {
      continue;
    }
    leaks.push({
      type: 'lightLeak',
      startMs,
      endMs,
      peakIntensity: leak.peakIntensity,
      pulseHz: leak.pulseHz,
      angleDeg: leak.angleDeg,
    });
    lastEnd = endMs;
  }
  return leaks;
}

/** Whether one more event may join the timeline without breaking the budget. */
function admits(events: readonly number[], atMs: number): boolean {
  return events.every((event) => Math.abs(event - atMs) >= MIN_FLASH_INTERVAL_MS);
}

function overlaps(effect: WordPopEffect, taken: readonly WordPopEffect[]): boolean {
  return taken.some((other) => effect.startMs < other.endMs && other.startMs < effect.endMs);
}

/**
 * THE PHOTOSENSITIVITY BUDGET, spent in the order of what a scene would lose.
 *
 * Every event on `pitchSceneV2FlashEvents`' timeline is priced the same — a punch
 * onset, each expanded pulse peak of a light leak, a wordPop appearance, a
 * countBadge appearance — and no two may land inside MIN_FLASH_INTERVAL_MS. When
 * they would, something has to go, and these four tiers say what:
 *
 *   1. a LIGHT LEAK marks a hard cut, so it is offered first, with all of its pulse
 *      peaks at once: a half-drawn leak is not a leak.
 *   2. a COUNT BADGE labels the passage its card is printing.
 *   3. a PUNCH is an accent on a word onset.
 *   4. a WORD POP is decoration on a word already being spoken.
 *
 * Within a tier the earliest event wins, except for pops, where the shot's own
 * ranking (longest word first) decides which of them is offered — dropping the
 * accent the shot wanted least is the whole point.
 *
 * Nothing here is a claim that the drops never happen. They do: `hype` asks for two
 * pops a shot and a fast speaker puts two words 200ms apart, which is exactly the
 * case this function turns into a quieter scene instead of a parse failure at
 * publish time. The self-validating `parse` at the end of the build is what proves
 * the arithmetic — remove this pass and it throws.
 */
function applyFlashBudget(
  leaks: readonly LightLeakOverlay[],
  badges: readonly CountBadgeOverlay[],
  candidates: ReadonlyMap<number, ShotFlashCandidates>,
  params: TemplateParams,
): {
  readonly leaks: readonly LightLeakOverlay[];
  readonly badges: readonly CountBadgeOverlay[];
  readonly effects: ReadonlyMap<number, readonly PitchShotEffectV2[]>;
} {
  const events: number[] = [];

  const keptLeaks: LightLeakOverlay[] = [];
  for (const leak of leaks) {
    const peaks = lightLeakFlashPeaks(leak);
    if (!peaks.every((peak) => admits(events, peak))) {
      continue;
    }
    keptLeaks.push(leak);
    events.push(...peaks);
  }

  const keptBadges: CountBadgeOverlay[] = [];
  for (const badge of badges) {
    if (!admits(events, badge.startMs)) {
      continue;
    }
    keptBadges.push(badge);
    events.push(badge.startMs);
  }

  const shotIndexes = [...candidates.keys()].sort((left, right) => left - right);
  const effects = new Map<number, PitchShotEffectV2[]>();
  const add = (shotIndex: number, effect: PitchShotEffectV2): void => {
    const existing = effects.get(shotIndex);
    if (existing === undefined) {
      effects.set(shotIndex, [effect]);
    } else {
      existing.push(effect);
    }
  };

  for (const shotIndex of shotIndexes) {
    const onsetMs = (candidates.get(shotIndex) as ShotFlashCandidates).punchAtMs;
    if (onsetMs === null || !admits(events, onsetMs)) {
      continue;
    }
    add(shotIndex, {
      type: 'punch',
      atMs: onsetMs,
      durationMs: params.punchDurationMs,
      scale: params.punchScale,
      easing: params.punchEasing,
    });
    events.push(onsetMs);
  }

  for (const shotIndex of shotIndexes) {
    const taken: WordPopEffect[] = [];
    for (const pop of (candidates.get(shotIndex) as ShotFlashCandidates).wordPops) {
      if (taken.length >= params.wordPopsPerShot) {
        break;
      }
      if (overlaps(pop, taken) || !admits(events, pop.startMs)) {
        continue;
      }
      taken.push(pop);
      events.push(pop.startMs);
    }
    // Emitted in time order, which is how a reader of the JSON expects to find them;
    // the ranking above only decided WHICH pops survived.
    for (const pop of [...taken].sort((left, right) => left.startMs - right.startMs)) {
      add(shotIndex, pop);
    }
  }

  return { leaks: keptLeaks, badges: keptBadges, effects };
}
