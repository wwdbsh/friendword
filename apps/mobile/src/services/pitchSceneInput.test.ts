import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  pitchSceneRejectionMessage,
  reportPitchSceneDemotion,
  transcriptSegmentWindows,
} from './pitchSceneInput';

describe('transcriptSegmentWindows', () => {
  it('converts the provider seconds to the integer milliseconds the timeline uses', () => {
    // The same conversion the published player applies to this snapshot; the
    // submitted scene has to describe the timeline that player will run.
    expect(
      transcriptSegmentWindows({
        text: 'Two lines.',
        segments: [
          { start: 0, end: 1.8405, text: 'Two' },
          { start: 1.8405, end: 4.0021, text: 'lines.' },
        ],
      }),
    ).toEqual([
      { startMs: 0, endMs: 1_841 },
      { startMs: 1_841, endMs: 4_002 },
    ]);
  });

  it('clamps a negative start and a zero-length end instead of dropping the segment', () => {
    expect(transcriptSegmentWindows({ segments: [{ start: -0.2, end: 0, text: 'oh' }] })).toEqual([
      { startMs: 0, endMs: 1 },
    ]);
  });

  it('reads no windows out of a transcript that never ran', () => {
    expect(transcriptSegmentWindows(null)).toEqual([]);
    expect(transcriptSegmentWindows(undefined)).toEqual([]);
    expect(transcriptSegmentWindows('a plain string transcript')).toEqual([]);
    expect(transcriptSegmentWindows([{ start: 0, end: 1, text: 'x' }])).toEqual([]);
    expect(transcriptSegmentWindows({ text: 'no segments key' })).toEqual([]);
    expect(transcriptSegmentWindows({ segments: 'not-an-array' })).toEqual([]);
  });

  it('skips the entries a scene cannot be timed from rather than guessing', () => {
    expect(
      transcriptSegmentWindows({
        segments: [
          { start: 0, end: 1, text: 'kept' },
          { start: '1', end: 2, text: 'string start' },
          { start: 2, text: 'no end' },
          { start: 2, end: 3 },
          null,
          { start: 3, end: 4, text: 'also kept' },
        ],
      }),
    ).toEqual([
      { startMs: 0, endMs: 1_000 },
      { startMs: 3_000, endMs: 4_000 },
    ]);
  });
});

/** How the data layer surfaces a PostgREST error: the SQLERRM is on the cause. */
function wrapped(serverMessage: string): Error {
  return new Error('Supabase operation failed: pitchDraft.submitForConsent', {
    cause: { message: serverMessage, code: 'P0001' },
  });
}

describe('pitchSceneRejectionMessage', () => {
  it('finds the server rejection the sceneless fallback is allowed to act on', () => {
    // Verbatim from 0049, so the log names the rule that was broken.
    expect(
      pitchSceneRejectionMessage(
        wrapped('pitch scene duration must match the transcript segments'),
      ),
    ).toBe('pitch scene duration must match the transcript segments');
    expect(
      pitchSceneRejectionMessage(wrapped('pitch scene flashes must be at least 334ms apart')),
    ).toBe('pitch scene flashes must be at least 334ms apart');
    // 0048's plural spelling still starts with the prefix.
    expect(
      pitchSceneRejectionMessage(wrapped('pitch scenes must be contiguous from 0 to durationMs')),
    ).toBe('pitch scenes must be contiguous from 0 to durationMs');
  });

  it('ignores a failure that is not a scene rejection', () => {
    // Each of these has a cause the introducer can act on, or a retry that would
    // fix it. Demoting the pitch to sceneless would hide it instead.
    expect(pitchSceneRejectionMessage(wrapped('network request failed'))).toBeNull();
    expect(
      pitchSceneRejectionMessage(wrapped('pitch media requires completed validation')),
    ).toBeNull();
    expect(pitchSceneRejectionMessage(wrapped('authentication required'))).toBeNull();
    expect(pitchSceneRejectionMessage(null)).toBeNull();
    expect(pitchSceneRejectionMessage('pitch scene duration must match')).toBeNull();
  });

  it('is anchored to the start of the message, not to a mention anywhere in it', () => {
    // A Postgres context line, or any other text that happens to contain the
    // words, must not be able to demote a real failure.
    expect(
      pitchSceneRejectionMessage(wrapped('permission denied\nCONTEXT: pitch scene validation')),
    ).toBeNull();
    expect(
      pitchSceneRejectionMessage(wrapped('could not serialize access to pitch scene rows')),
    ).toBeNull();
  });

  it('reads through a deeper cause chain than one wrapper', () => {
    expect(
      pitchSceneRejectionMessage(
        new Error('submit failed', { cause: wrapped('pitch scene must not repeat a photo') }),
      ),
    ).toBe('pitch scene must not repeat a photo');
  });
});

describe('reportPitchSceneDemotion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the draft and the server reason, which is all the triage there is', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    reportPitchSceneDemotion({
      draftId: '10000000-0000-4000-8000-000000000001',
      reason: 'pitch scene duration must match the transcript segments',
    });

    // A demotion is silent to the introducer, so without a line naming both the
    // draft and the rule, a builder regression that strips motion from every
    // submit leaves no trace at all.
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('10000000-0000-4000-8000-000000000001');
    expect(line).toContain('pitch scene duration must match the transcript segments');
  });
});
