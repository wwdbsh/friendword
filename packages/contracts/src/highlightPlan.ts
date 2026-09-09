/**
 * T002 (issue #98) — the cut plan behind the "highlight" MP4 variant.
 *
 * `docs/REEL_V3_DESIGN.md` §1 is the contract. The one-sentence version: a
 * 60-second voice note is a bad reel, so the MP4 (and ONLY the MP4 — the web
 * player still plays the whole approved recording, losslessly) is cut down to
 * roughly 24 seconds of the sentences that actually introduce the person.
 *
 * Three properties matter more than cleverness here, and each one is a rule
 * rather than a heuristic:
 *
 *  1. SENTENCES ARE ATOMIC. The candidate unit is a transcript segment, never
 *     part of one. A cut inside a sentence produces a clip of someone being
 *     interrupted, and — worse for this product — a clip that says something
 *     the Dater did not approve. Every window here is a whole number of
 *     segments, so the words in the MP4 are a subsequence of the sentences the
 *     Dater read and approved.
 *  2. FULLY DETERMINISTIC. No randomness, no Date, no locale-sensitive
 *     comparison, no dependence on object key order or sort stability. The same
 *     input yields the same `hash` on every machine, which is what lets the
 *     render pipeline treat `cut_hash` as an identity and what the 100x test
 *     below pins.
 *  3. IT REFUSES. Fewer than two segments, or no transcript at all, and the
 *     answer is `null` — the worker then renders the Full variant and records
 *     `effective_variant='full'`. A "highlight" of one sentence is not a
 *     highlight, and inventing one would be a worse video, not a shorter one.
 *
 * This module is pure and carries no I/O, so the render worker, the tests and
 * (later) any preview surface share exactly one definition of the cut.
 */

import { sha256Hex } from './sha256';
import type { TranscriptSegment } from './transcriptSufficiency';

/** Which §1 priority put a window in the plan. Also the removal order. */
export type HighlightReason =
  /** ① the Dater's name — the first two seconds have to say who this is about. */
  | 'name'
  /** ② the story that proves the claim. */
  | 'evidence'
  /** ③ who they are looking for. */
  | 'good_match'
  /** ④ a specific quality, used to reach the target length. */
  | 'quality'
  /** neighbour pulled in only to clear `minMs`. */
  | 'fill';

/** Priority order, low first. Selection walks up it; trimming walks down it. */
const REASON_RANK: Readonly<Record<HighlightReason, number>> = {
  name: 0,
  evidence: 1,
  good_match: 2,
  quality: 3,
  fill: 4,
};

export type HighlightWindow = {
  readonly startMs: number;
  readonly endMs: number;
  readonly reason: HighlightReason;
};

export type HighlightPlan = {
  readonly version: 1;
  readonly windows: readonly HighlightWindow[];
  readonly totalMs: number;
  readonly hash: string;
};

/** The structured fields §1 selects against. All optional: an older draft may
 *  predate one, and a missing field simply contributes no candidate. */
export type HighlightPitchFields = {
  readonly hook?: string | null;
  readonly evidence_or_anecdote?: string | null;
  readonly good_match_for?: string | null;
  readonly three_specific_qualities?: readonly string[] | null;
};

export type HighlightPlanOptions = {
  readonly targetMs: number;
  readonly minMs: number;
  readonly maxMs: number;
};

export type HighlightPlanInput = {
  /** Transcript segments, in provider order, with `start`/`end` in SECONDS. */
  readonly segments: readonly TranscriptSegment[];
  readonly structure?: HighlightPitchFields | null;
  /** The Dater's public display name, for rule ①. */
  readonly daterDisplayName?: string | null;
  /** Scene shot boundaries in ms, when the scene has them (rule 4 snap). */
  readonly shotBoundariesMs?: readonly number[] | null;
  readonly options?: Partial<HighlightPlanOptions> | null;
};

export const HIGHLIGHT_TARGET_MS = 24_000;
export const HIGHLIGHT_MIN_MS = 15_000;
export const HIGHLIGHT_MAX_MS = 30_000;
/** §1 rule 4: breathing room at a cut, never enough to enter a neighbour. */
export const HIGHLIGHT_EDGE_MARGIN_MS = 40;
/** §1 rule 4: a shot boundary this close wins the edge (no mid-Ken-Burns cut). */
export const HIGHLIGHT_SHOT_SNAP_MS = 120;
/** §1 rule 2: ② may take a run of at most this many consecutive segments. */
export const HIGHLIGHT_MAX_RUN_SEGMENTS = 3;
/** §1 rule 5: below this, there is nothing to choose between. */
export const HIGHLIGHT_MIN_SEGMENTS = 2;

type NormalizedSegment = {
  readonly index: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly tokens: ReadonlySet<string>;
};

type Pick = {
  readonly index: number;
  readonly reason: HighlightReason;
  /** Selection order, so trimming is a total order even inside one reason. */
  readonly order: number;
};

/**
 * Words too common to be evidence of anything. Kept deliberately short: this
 * is overlap scoring between two texts written about the same person, not
 * search relevance, and a long list would start deciding which real words
 * count.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'her',
  'him',
  'his',
  'i',
  'in',
  'is',
  'it',
  'its',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'she',
  'that',
  'the',
  'their',
  'them',
  'they',
  'this',
  'to',
  'was',
  'we',
  'were',
  'who',
  'with',
  'you',
  'your',
]);

/**
 * Lowercase alphanumeric tokens, stop words dropped. `toLowerCase` without a
 * locale argument on purpose: the same string must tokenize identically on a
 * Turkish-locale machine and on CI.
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9']+/)) {
    const token = raw.replace(/'/g, '');
    if (token.length >= 2 && !STOP_WORDS.has(token)) {
      tokens.push(token);
    }
  }
  return tokens;
}

function distinctTokens(text: string): ReadonlySet<string> {
  return new Set(tokenize(text));
}

/**
 * Segments the plan may use: finite times, positive duration, in provider
 * order. Times are rounded to whole milliseconds here and nowhere else, so
 * every later comparison is integer arithmetic.
 */
function normalize(segments: readonly TranscriptSegment[]): NormalizedSegment[] {
  const normalized: NormalizedSegment[] = [];
  let index = 0;
  for (const segment of segments) {
    if (typeof segment.text !== 'string' || segment.text.trim() === '') {
      continue;
    }
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end)) {
      continue;
    }
    const startMs = Math.max(0, Math.round(segment.start * 1000));
    const endMs = Math.round(segment.end * 1000);
    if (endMs <= startMs) {
      continue;
    }
    normalized.push({
      index,
      startMs,
      endMs,
      tokens: distinctTokens(segment.text),
    });
    index += 1;
  }
  return normalized;
}

function durationOf(segment: NormalizedSegment): number {
  return segment.endMs - segment.startMs;
}

/** How many of `wanted`'s distinct tokens the segment says. */
function overlapScore(segment: NormalizedSegment, wanted: ReadonlySet<string>): number {
  let score = 0;
  for (const token of wanted) {
    if (segment.tokens.has(token)) {
      score += 1;
    }
  }
  return score;
}

/**
 * ① The first segment that says the Dater's name — the reel has to answer
 * "who is this about" before anyone swipes. Matched on the first name token,
 * because that is what people say out loud. No name (or no match): the first
 * segment, which is the opening line and the next best claim to "who".
 */
function nameSegmentIndex(
  segments: readonly NormalizedSegment[],
  daterDisplayName: string | null | undefined,
): number {
  const nameTokens = typeof daterDisplayName === 'string' ? tokenize(daterDisplayName) : [];
  const firstName = nameTokens[0];
  if (firstName !== undefined) {
    for (const segment of segments) {
      if (segment.tokens.has(firstName)) {
        return segment.index;
      }
    }
  }
  return 0;
}

/**
 * The consecutive run of at most `maxRun` segments that says the most of
 * `wanted`. Ties break toward the shorter run, then toward the earlier one, so
 * the answer never depends on iteration or sort stability.
 */
function bestRun(
  segments: readonly NormalizedSegment[],
  wanted: ReadonlySet<string>,
  maxRun: number,
): readonly number[] {
  if (wanted.size === 0) {
    return [];
  }
  let bestScore = 0;
  let best: readonly number[] = [];
  for (let start = 0; start < segments.length; start += 1) {
    const covered = new Set<string>();
    for (let length = 1; length <= maxRun && start + length <= segments.length; length += 1) {
      const segment = segments[start + length - 1];
      if (segment === undefined) {
        break;
      }
      for (const token of wanted) {
        if (segment.tokens.has(token)) {
          covered.add(token);
        }
      }
      const score = covered.size;
      if (score > bestScore) {
        bestScore = score;
        best = Array.from({ length }, (_unused, offset) => start + offset);
      }
    }
  }
  return best;
}

function totalDuration(
  picks: ReadonlyMap<number, Pick>,
  segments: readonly NormalizedSegment[],
): number {
  let total = 0;
  for (const index of picks.keys()) {
    const segment = segments[index];
    if (segment !== undefined) {
      total += durationOf(segment);
    }
  }
  return total;
}

function addPick(
  picks: Map<number, Pick>,
  index: number,
  reason: HighlightReason,
  order: { value: number },
): void {
  const existing = picks.get(index);
  if (existing !== undefined) {
    // A segment chosen twice keeps the HIGHER priority, so trimming cannot
    // drop a sentence that ① or ② also depends on.
    if (REASON_RANK[reason] < REASON_RANK[existing.reason]) {
      picks.set(index, { index, reason, order: existing.order });
    }
    return;
  }
  picks.set(index, { index, reason, order: order.value });
  order.value += 1;
}

/**
 * §1 rule 3, second half: over `maxMs`, give back the least important
 * sentences — ④ then ③ then ②, latest-chosen first inside a tier. ① is never
 * given back: a highlight without the name is not the thing this exists for.
 */
function trimToMax(
  picks: Map<number, Pick>,
  segments: readonly NormalizedSegment[],
  maxMs: number,
): void {
  while (totalDuration(picks, segments) > maxMs) {
    let victim: Pick | undefined;
    for (const pick of picks.values()) {
      if (pick.reason === 'name') {
        continue;
      }
      if (
        victim === undefined ||
        REASON_RANK[pick.reason] > REASON_RANK[victim.reason] ||
        (REASON_RANK[pick.reason] === REASON_RANK[victim.reason] && pick.order > victim.order)
      ) {
        victim = pick;
      }
    }
    if (victim === undefined) {
      // Only ① is left and it is still too long. A single approved sentence
      // that runs past maxMs is kept whole (rule 1 outranks rule 3): the
      // alternative is cutting someone off mid-word.
      return;
    }
    picks.delete(victim.index);
  }
}

/**
 * §1 rule 3, first half: under `minMs`, grow into the sentences NEXT TO what
 * is already chosen, lowest index first, and never past `maxMs`. Neighbours
 * rather than "the next best scoring segment" because contiguity is what makes
 * the cut sound like speech instead of a supercut.
 */
function growToMin(
  picks: Map<number, Pick>,
  segments: readonly NormalizedSegment[],
  minMs: number,
  maxMs: number,
  order: { value: number },
): void {
  while (totalDuration(picks, segments) < minMs) {
    let candidate: number | undefined;
    for (const index of Array.from(picks.keys()).sort((a, b) => a - b)) {
      for (const neighbour of [index - 1, index + 1]) {
        if (neighbour < 0 || neighbour >= segments.length || picks.has(neighbour)) {
          continue;
        }
        if (candidate === undefined || neighbour < candidate) {
          candidate = neighbour;
        }
      }
    }
    if (candidate === undefined) {
      return;
    }
    const segment = segments[candidate];
    if (segment === undefined) {
      return;
    }
    if (totalDuration(picks, segments) + durationOf(segment) > maxMs) {
      // Growing would break the ceiling. Short is better than long here: the
      // ceiling is what keeps the MP4 postable.
      return;
    }
    addPick(picks, candidate, 'fill', order);
  }
}

/** The nearest shot boundary within `HIGHLIGHT_SHOT_SNAP_MS`, or `undefined`. */
function snapCandidate(
  edgeMs: number,
  boundaries: readonly number[],
  lowerMs: number,
  upperMs: number,
): number | undefined {
  let best: number | undefined;
  for (const boundary of boundaries) {
    if (!Number.isFinite(boundary)) {
      continue;
    }
    const rounded = Math.round(boundary);
    if (rounded < lowerMs || rounded > upperMs) {
      continue;
    }
    if (Math.abs(rounded - edgeMs) > HIGHLIGHT_SHOT_SNAP_MS) {
      continue;
    }
    if (
      best === undefined ||
      Math.abs(rounded - edgeMs) < Math.abs(best - edgeMs) ||
      (Math.abs(rounded - edgeMs) === Math.abs(best - edgeMs) && rounded < best)
    ) {
      best = rounded;
    }
  }
  return best;
}

/**
 * §1 rules 3 and 4: consecutive picks become one window, each edge gets 40ms
 * of air — but only as far as the neighbouring SENTENCE allows, so the margin
 * can never leak a word the window did not select. A shot boundary inside the
 * snap distance takes the edge instead, clamped to the same limits.
 */
function buildWindows(
  picks: ReadonlyMap<number, Pick>,
  segments: readonly NormalizedSegment[],
  boundaries: readonly number[],
): HighlightWindow[] {
  const ordered = Array.from(picks.values()).sort((left, right) => left.index - right.index);
  const windows: HighlightWindow[] = [];

  let runStart = 0;
  while (runStart < ordered.length) {
    let runEnd = runStart;
    while (
      runEnd + 1 < ordered.length &&
      (ordered[runEnd + 1]?.index ?? -1) === (ordered[runEnd]?.index ?? -1) + 1
    ) {
      runEnd += 1;
    }
    const first = ordered[runStart];
    const last = ordered[runEnd];
    if (first === undefined || last === undefined) {
      break;
    }
    const firstSegment = segments[first.index];
    const lastSegment = segments[last.index];
    if (firstSegment === undefined || lastSegment === undefined) {
      break;
    }

    const previous = segments[first.index - 1];
    const next = segments[last.index + 1];
    const lowerMs = Math.max(0, previous?.endMs ?? 0);
    const upperMs = next?.startMs ?? lastSegment.endMs;

    let startMs = Math.max(lowerMs, firstSegment.startMs - HIGHLIGHT_EDGE_MARGIN_MS);
    let endMs = Math.min(upperMs, lastSegment.endMs + HIGHLIGHT_EDGE_MARGIN_MS);

    const snappedStart = snapCandidate(startMs, boundaries, lowerMs, firstSegment.startMs);
    if (snappedStart !== undefined) {
      startMs = snappedStart;
    }
    const snappedEnd = snapCandidate(endMs, boundaries, lastSegment.endMs, upperMs);
    if (snappedEnd !== undefined) {
      endMs = snappedEnd;
    }
    if (endMs <= startMs) {
      startMs = firstSegment.startMs;
      endMs = lastSegment.endMs;
    }

    let reason: HighlightReason = last.reason;
    for (let i = runStart; i <= runEnd; i += 1) {
      const pick = ordered[i];
      if (pick !== undefined && REASON_RANK[pick.reason] < REASON_RANK[reason]) {
        reason = pick.reason;
      }
    }

    windows.push({ startMs, endMs, reason });
    runStart = runEnd + 1;
  }
  return windows;
}

/**
 * The cut plan for one transcript, or `null` when there is nothing to cut.
 *
 * Pure and total: it never throws on a malformed transcript, it answers `null`
 * instead, because the caller's fallback (render the Full variant) is a good
 * video and an exception is a failed job.
 */
export function buildHighlightPlan(input: HighlightPlanInput): HighlightPlan | null {
  const segments = normalize(input.segments);
  if (segments.length < HIGHLIGHT_MIN_SEGMENTS) {
    return null;
  }

  const targetMs = input.options?.targetMs ?? HIGHLIGHT_TARGET_MS;
  const minMs = input.options?.minMs ?? HIGHLIGHT_MIN_MS;
  const maxMs = input.options?.maxMs ?? HIGHLIGHT_MAX_MS;

  const structure = input.structure ?? {};
  const picks = new Map<number, Pick>();
  const order = { value: 0 };

  // ① the name.
  addPick(picks, nameSegmentIndex(segments, input.daterDisplayName), 'name', order);

  // ② the story, as a run of at most three sentences.
  if (totalDuration(picks, segments) < targetMs) {
    const wanted = distinctTokens(structure.evidence_or_anecdote ?? '');
    for (const index of bestRun(segments, wanted, HIGHLIGHT_MAX_RUN_SEGMENTS)) {
      addPick(picks, index, 'evidence', order);
    }
  }

  // ③ who they are looking for — one sentence, the one that says the most of it.
  if (totalDuration(picks, segments) < targetMs) {
    const wanted = distinctTokens(structure.good_match_for ?? '');
    for (const index of bestRun(segments, wanted, 1)) {
      addPick(picks, index, 'good_match', order);
    }
  }

  // ④ fill toward the target with the qualities, in their approved order.
  for (const quality of structure.three_specific_qualities ?? []) {
    if (totalDuration(picks, segments) >= targetMs) {
      break;
    }
    if (typeof quality !== 'string') {
      continue;
    }
    const wanted = distinctTokens(quality);
    let best: NormalizedSegment | undefined;
    let bestScore = 0;
    for (const segment of segments) {
      if (picks.has(segment.index)) {
        continue;
      }
      const score = overlapScore(segment, wanted);
      if (score > bestScore) {
        bestScore = score;
        best = segment;
      }
    }
    if (best !== undefined) {
      addPick(picks, best.index, 'quality', order);
    }
  }

  trimToMax(picks, segments, maxMs);
  growToMin(picks, segments, minMs, maxMs, order);

  const boundaries = (input.shotBoundariesMs ?? []).filter((value) => Number.isFinite(value));
  const windows = buildWindows(picks, segments, boundaries);
  if (windows.length === 0) {
    return null;
  }

  const totalMs = windows.reduce((sum, window) => sum + (window.endMs - window.startMs), 0);
  return {
    version: 1,
    windows,
    totalMs,
    // §1 rule 6. Hashed over the windows alone — the plan's identity is the
    // cut, and `totalMs` is derived from it.
    hash: sha256Hex(JSON.stringify(windows)),
  };
}
