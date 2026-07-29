import { describe, expect, it } from 'vitest';

import { transcriptSegmentWindows } from './pitchSceneInput';

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
