import { describe, expect, it } from 'vitest';

import {
  HIGHLIGHT_EDGE_MARGIN_MS,
  HIGHLIGHT_MAX_MS,
  HIGHLIGHT_MIN_MS,
  buildHighlightPlan,
  type HighlightPitchFields,
  type HighlightPlanInput,
} from './highlightPlan';
import type { TranscriptSegment } from './transcriptSufficiency';

/**
 * Two synthetic-but-realistic voice notes. Nothing here is user data: the
 * people, the stories and the timings were written for this file. The shape is
 * what `/api/transcribe` stores — `{start, end, text}` in SECONDS, sentence per
 * segment, gapless-ish with the small pauses a real take has.
 */

// ── Fixture A: ~40s, 10 segments, Maya named in the second sentence ──────
const MAYA_SEGMENTS: readonly TranscriptSegment[] = [
  { start: 0.0, end: 3.4, text: 'Okay so I have been trying to set up my best friend for months.' },
  {
    start: 3.6,
    end: 7.9,
    text: 'Her name is Maya and she is honestly the most generous person I know.',
  },
  {
    start: 8.1,
    end: 12.4,
    text: 'We met in a chemistry lab in college and we have been close ever since.',
  },
  { start: 12.6, end: 17.2, text: 'Last winter my car died in the snow at eleven at night.' },
  {
    start: 17.4,
    end: 22.6,
    text: 'Maya drove forty minutes with a thermos of soup and waited with me for the tow truck.',
  },
  {
    start: 22.8,
    end: 26.5,
    text: 'That is just who she is, she shows up when it is inconvenient.',
  },
  { start: 26.7, end: 30.9, text: 'She is funny in a very dry way that sneaks up on you.' },
  { start: 31.1, end: 34.8, text: 'She is also stubbornly curious, she reads two books a week.' },
  {
    start: 35.0,
    end: 38.4,
    text: 'I think she would be a good match for someone patient and outdoorsy.',
  },
  { start: 38.6, end: 41.2, text: 'Someone who will actually text back, please.' },
];

const MAYA_STRUCTURE: HighlightPitchFields = {
  hook: 'The friend who drives forty minutes with soup.',
  evidence_or_anecdote:
    'When her car died in the snow at eleven at night, Maya drove forty minutes with a thermos of soup and waited for the tow truck.',
  good_match_for: 'Someone patient and outdoorsy who actually texts back.',
  three_specific_qualities: ['generous', 'dry funny', 'stubbornly curious about books'],
};

// ── Fixture B: ~60s, 13 segments, Dev named in the opening sentence ──────
const DEV_SEGMENTS: readonly TranscriptSegment[] = [
  { start: 0.0, end: 4.2, text: 'I am doing this for Dev, who would never do it for himself.' },
  {
    start: 4.4,
    end: 9.1,
    text: 'We have been roommates for six years which is longer than most marriages I know.',
  },
  { start: 9.3, end: 13.8, text: 'He is a nurse and he works the shifts nobody else wants.' },
  {
    start: 14.0,
    end: 19.4,
    text: 'One time our neighbour fell on the stairs at two in the morning.',
  },
  {
    start: 19.6,
    end: 25.8,
    text: 'Dev sat with her on the cold landing for an hour until the ambulance came.',
  },
  { start: 26.0, end: 30.6, text: 'He never mentioned it again, I found out from her daughter.' },
  { start: 30.8, end: 35.2, text: 'He is calm in a way that makes other people calm down too.' },
  {
    start: 35.4,
    end: 39.9,
    text: 'He is a genuinely excellent cook, his dal is famous on our street.',
  },
  {
    start: 40.1,
    end: 44.6,
    text: 'And he is loyal to a fault, he still calls his college professor.',
  },
  {
    start: 44.8,
    end: 49.2,
    text: 'He would be a good match for someone direct who says what they want.',
  },
  { start: 49.4, end: 53.1, text: 'Somebody who likes quiet evenings more than loud bars.' },
  { start: 53.3, end: 57.4, text: 'He is not going to sell himself so I am doing it for him.' },
  { start: 57.6, end: 61.0, text: 'Please just say hello, he is worth the message.' },
];

const DEV_STRUCTURE: HighlightPitchFields = {
  hook: 'The nurse who sat on a cold landing for an hour.',
  evidence_or_anecdote:
    'When the neighbour fell on the stairs at two in the morning, Dev sat with her on the cold landing for an hour until the ambulance came.',
  good_match_for: 'Someone direct who says what they want and likes quiet evenings.',
  three_specific_qualities: ['calm', 'an excellent cook', 'loyal to a fault'],
};

function segmentSpansMs(segments: readonly TranscriptSegment[]): {
  readonly startMs: number;
  readonly endMs: number;
}[] {
  return segments.map((segment) => ({
    startMs: Math.round(segment.start * 1000),
    endMs: Math.round(segment.end * 1000),
  }));
}

/**
 * A window is legal only if it is made of WHOLE segments (§1 rule 1): its edges
 * may sit up to the margin outside a segment boundary, but never inside a
 * segment that the window does not fully contain.
 */
function coveredSegmentIndexes(
  windows: readonly { readonly startMs: number; readonly endMs: number }[],
  segments: readonly TranscriptSegment[],
): number[] {
  const spans = segmentSpansMs(segments);
  const covered: number[] = [];
  spans.forEach((span, index) => {
    for (const window of windows) {
      const overlap = Math.min(window.endMs, span.endMs) - Math.max(window.startMs, span.startMs);
      if (overlap <= 0) {
        continue;
      }
      const whole = window.startMs <= span.startMs && window.endMs >= span.endMs;
      expect(
        whole,
        `window ${window.startMs}-${window.endMs} cuts into segment ${index} (${span.startMs}-${span.endMs})`,
      ).toBe(true);
      covered.push(index);
      break;
    }
  });
  return covered;
}

const mayaInput: HighlightPlanInput = {
  segments: MAYA_SEGMENTS,
  structure: MAYA_STRUCTURE,
  daterDisplayName: 'Maya',
};

const devInput: HighlightPlanInput = {
  segments: DEV_SEGMENTS,
  structure: DEV_STRUCTURE,
  daterDisplayName: 'Dev',
};

describe('buildHighlightPlan — length', () => {
  it.each([
    ['40s take', mayaInput],
    ['60s take', devInput],
  ])('%s lands inside the 15-30s window', (_label, input) => {
    const plan = buildHighlightPlan(input);
    expect(plan).not.toBeNull();
    expect(plan?.totalMs).toBeGreaterThanOrEqual(HIGHLIGHT_MIN_MS);
    expect(plan?.totalMs).toBeLessThanOrEqual(HIGHLIGHT_MAX_MS);
    // totalMs is the windows, not a stored guess.
    const summed = (plan?.windows ?? []).reduce(
      (total, window) => total + (window.endMs - window.startMs),
      0,
    );
    expect(plan?.totalMs).toBe(summed);
  });

  it('gives back the lowest-priority sentences rather than exceeding maxMs', () => {
    // A 12s ceiling on a take whose every sentence is ~4s: everything but the
    // highest-priority picks has to go, and the result still respects it.
    const plan = buildHighlightPlan({
      ...devInput,
      options: { minMs: 4_000, targetMs: 24_000, maxMs: 12_000 },
    });
    expect(plan).not.toBeNull();
    expect(plan?.totalMs).toBeLessThanOrEqual(12_000);
    expect(plan?.windows.some((window) => window.reason === 'name')).toBe(true);
    expect(plan?.windows.every((window) => window.reason !== 'quality')).toBe(true);
  });

  it('grows into neighbouring sentences to clear minMs', () => {
    // No structured fields at all: ① alone is ~4s, so only the grow step can
    // reach 15s, and it may only take NEIGHBOURS of what is already chosen.
    const plan = buildHighlightPlan({ segments: DEV_SEGMENTS, daterDisplayName: 'Dev' });
    expect(plan).not.toBeNull();
    expect(plan?.totalMs).toBeGreaterThanOrEqual(HIGHLIGHT_MIN_MS);
    const covered = coveredSegmentIndexes(plan?.windows ?? [], DEV_SEGMENTS);
    // Grown from segment 0 upward, so the covered set is one leading run.
    expect(covered).toEqual(covered.map((_unused, position) => position));
  });
});

describe('buildHighlightPlan — what it keeps', () => {
  it('always includes the sentence that first says the Dater name', () => {
    const mayaPlan = buildHighlightPlan(mayaInput);
    // "Her name is Maya…" is segment 1 of fixture A.
    expect(coveredSegmentIndexes(mayaPlan?.windows ?? [], MAYA_SEGMENTS)).toContain(1);
    expect(mayaPlan?.windows.some((window) => window.reason === 'name')).toBe(true);

    const devPlan = buildHighlightPlan(devInput);
    expect(coveredSegmentIndexes(devPlan?.windows ?? [], DEV_SEGMENTS)).toContain(0);
  });

  it('falls back to the opening sentence when the name is never spoken', () => {
    const plan = buildHighlightPlan({ ...mayaInput, daterDisplayName: 'Rosalind' });
    expect(coveredSegmentIndexes(plan?.windows ?? [], MAYA_SEGMENTS)).toContain(0);
  });

  it('keeps the anecdote the evidence field describes', () => {
    const plan = buildHighlightPlan(mayaInput);
    const covered = coveredSegmentIndexes(plan?.windows ?? [], MAYA_SEGMENTS);
    // Segments 3-4 are the snow/soup story that evidence_or_anecdote retells.
    expect(covered).toContain(4);
    expect(plan?.windows.some((window) => window.reason === 'evidence')).toBe(true);
  });

  it('only ever emits whole segments, in order, without overlap', () => {
    for (const input of [mayaInput, devInput]) {
      const plan = buildHighlightPlan(input);
      const windows = plan?.windows ?? [];
      expect(windows.length).toBeGreaterThan(0);
      // coveredSegmentIndexes asserts wholeness; here: strict ordering.
      coveredSegmentIndexes(windows, input.segments);
      for (let i = 1; i < windows.length; i += 1) {
        expect(windows[i]?.startMs).toBeGreaterThan(windows[i - 1]?.endMs ?? 0);
      }
      for (const window of windows) {
        expect(window.endMs).toBeGreaterThan(window.startMs);
      }
    }
  });

  it('merges adjacent picks into one window instead of two touching ones', () => {
    const plan = buildHighlightPlan(mayaInput);
    const windows = plan?.windows ?? [];
    const covered = coveredSegmentIndexes(windows, MAYA_SEGMENTS);
    // The pick set spans more segments than there are windows, which is only
    // possible if consecutive picks were merged.
    expect(covered.length).toBeGreaterThan(windows.length);
    // And no two windows are separated by less than a real sentence.
    const spans = segmentSpansMs(MAYA_SEGMENTS);
    for (let i = 1; i < windows.length; i += 1) {
      const gapStart = windows[i - 1]?.endMs ?? 0;
      const gapEnd = windows[i]?.startMs ?? 0;
      expect(
        spans.some((span) => span.startMs >= gapStart && span.endMs <= gapEnd),
        'a gap between windows must contain at least one dropped sentence',
      ).toBe(true);
    }
  });
});

describe('buildHighlightPlan — edges', () => {
  it('adds the 40ms margin without reaching into a neighbouring sentence', () => {
    const plan = buildHighlightPlan(mayaInput);
    const spans = segmentSpansMs(MAYA_SEGMENTS);
    for (const window of plan?.windows ?? []) {
      const first = spans.find((span) => span.startMs >= window.startMs);
      const last = [...spans].reverse().find((span) => span.endMs <= window.endMs);
      expect(first).toBeDefined();
      expect(last).toBeDefined();
      expect(window.startMs).toBeGreaterThanOrEqual(
        (first?.startMs ?? 0) - HIGHLIGHT_EDGE_MARGIN_MS,
      );
      expect(window.endMs).toBeLessThanOrEqual((last?.endMs ?? 0) + HIGHLIGHT_EDGE_MARGIN_MS);
      // The pauses in these fixtures are 200ms, so a legal margin never lands
      // inside a neighbour — coveredSegmentIndexes proves that directly.
    }
    coveredSegmentIndexes(plan?.windows ?? [], MAYA_SEGMENTS);
  });

  it('snaps an edge to a shot boundary within 120ms', () => {
    const plain = buildHighlightPlan(mayaInput);
    const firstWindow = plain?.windows[0];
    expect(firstWindow).toBeDefined();
    const boundary = (firstWindow?.startMs ?? 0) - 20;
    const snapped = buildHighlightPlan({ ...mayaInput, shotBoundariesMs: [boundary] });
    expect(snapped?.windows[0]?.startMs).toBe(boundary);
    // Still whole segments after snapping.
    coveredSegmentIndexes(snapped?.windows ?? [], MAYA_SEGMENTS);
  });

  it('refuses a nearby boundary that would clip the first word', () => {
    const plain = buildHighlightPlan(mayaInput);
    // Inside the chosen sentence: close enough to snap, but taking it would
    // start the clip mid-word, which rule 1 forbids.
    const insideSentence = (plain?.windows[0]?.startMs ?? 0) + 60;
    const snapped = buildHighlightPlan({ ...mayaInput, shotBoundariesMs: [insideSentence] });
    expect(snapped?.windows[0]?.startMs).toBe(plain?.windows[0]?.startMs);
  });

  it('ignores a shot boundary further away than 120ms', () => {
    const plain = buildHighlightPlan(mayaInput);
    const far = (plain?.windows[0]?.startMs ?? 0) - 400;
    const unsnapped = buildHighlightPlan({ ...mayaInput, shotBoundariesMs: [far] });
    expect(unsnapped?.windows[0]?.startMs).toBe(plain?.windows[0]?.startMs);
  });
});

describe('buildHighlightPlan — determinism', () => {
  it('returns byte-identical plans over 100 runs', () => {
    const first = buildHighlightPlan(devInput);
    expect(first).not.toBeNull();
    const reference = JSON.stringify(first);
    for (let run = 0; run < 100; run += 1) {
      expect(JSON.stringify(buildHighlightPlan(devInput))).toBe(reference);
    }
  });

  it('hashes the windows, so a different cut is a different hash', () => {
    const maya = buildHighlightPlan(mayaInput);
    const dev = buildHighlightPlan(devInput);
    expect(maya?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(dev?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(maya?.hash).not.toBe(dev?.hash);
  });

  it('does not depend on the caller reusing one input object', () => {
    const a = buildHighlightPlan({
      segments: [...MAYA_SEGMENTS],
      structure: { ...MAYA_STRUCTURE },
      daterDisplayName: 'Maya',
    });
    const b = buildHighlightPlan(mayaInput);
    expect(a?.hash).toBe(b?.hash);
  });
});

describe('buildHighlightPlan — refusals', () => {
  it('returns null for a single-segment transcript', () => {
    expect(
      buildHighlightPlan({ segments: [MAYA_SEGMENTS[0] ?? { start: 0, end: 1, text: 'hi' }] }),
    ).toBeNull();
  });

  it('returns null for no transcript at all', () => {
    expect(buildHighlightPlan({ segments: [] })).toBeNull();
  });

  it('returns null when the segments are unusable rather than merely few', () => {
    expect(
      buildHighlightPlan({
        segments: [
          { start: 0, end: 0, text: 'zero length' },
          { start: 5, end: 4, text: 'backwards' },
          { start: Number.NaN, end: 3, text: 'not a number' },
          { start: 3, end: 4, text: '   ' },
        ],
      }),
    ).toBeNull();
  });
});

/**
 * MUTATION RED (recorded, not automated): removing the
 * `.sort((left, right) => left.index - right.index)` in `buildWindows` — the
 * §1 rule-3 "sort into original order" step — makes
 * "only ever emits whole segments, in order, without overlap" and
 * "merges adjacent picks into one window instead of two touching ones" fail,
 * because the picks are produced in PRIORITY order (name, evidence, good
 * match, quality) and would be emitted as unordered, unmerged windows. Verified
 * by hand, then restored; see the task report for the exact failure output.
 */
