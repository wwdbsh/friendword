import { describe, expect, it } from 'vitest';

import { evaluateRecordedTake } from './recordingIntegrity';

const HEALTHY = {
  // Measured on the simulator with a working input: 35.64s of audio,
  // 434,693 bytes (12,196 B/s) for the HIGH_QUALITY .m4a preset.
  url: 'file:///take.m4a',
  elapsedMillis: 35_700,
  capturedMillis: 35_641,
  byteSize: 434_693,
};

describe('evaluateRecordedTake', () => {
  it('accepts a take whose file holds the audio the timer promised', () => {
    expect(evaluateRecordedTake(HEALTHY)).toEqual({
      kind: 'accept',
      uri: 'file:///take.m4a',
      durationMillis: 35_641,
    });
  });

  it('saves the measured audio length, not the wall clock the timer showed', () => {
    // The recorder's duration comes from deviceCurrentTime, which keeps running
    // even when nothing is being written; only the file-derived length is honest.
    const verdict = evaluateRecordedTake({ ...HEALTHY, elapsedMillis: 46_000 });
    expect(verdict).toEqual({
      kind: 'accept',
      uri: 'file:///take.m4a',
      durationMillis: 35_641,
    });
  });

  it('caps an over-long take at the 60s ceiling the draft schema allows', () => {
    const verdict = evaluateRecordedTake({
      ...HEALTHY,
      elapsedMillis: 60_400,
      capturedMillis: 60_320,
      byteSize: 735_000,
    });
    expect(verdict).toEqual({ kind: 'accept', uri: 'file:///take.m4a', durationMillis: 60_000 });
  });

  it('refuses the silent take the simulator produced with no usable input', () => {
    // Real failure: UI showed 46s, afinfo reported 0.23s and 72 audio bytes.
    const verdict = evaluateRecordedTake({
      url: 'file:///silent.m4a',
      elapsedMillis: 46_000,
      capturedMillis: 230,
      byteSize: 72,
    });
    expect(verdict.kind).toBe('reject');
    expect(verdict.kind === 'reject' ? verdict.message : '').toContain('Record it again');
  });

  it('refuses a take shorter than its timer even when the file cannot be measured', () => {
    // The captured-vs-elapsed rule has to stand on its own: off-device, and
    // whenever expo-file-system cannot size the file, it is the only guard left.
    expect(
      evaluateRecordedTake({
        url: 'file:///silent.m4a',
        elapsedMillis: 46_000,
        capturedMillis: 230,
        byteSize: null,
      }).kind,
    ).toBe('reject');
  });

  it('refuses a take the recorder never wrote any audio for', () => {
    expect(evaluateRecordedTake({ ...HEALTHY, capturedMillis: 0, byteSize: 0 }).kind).toBe(
      'reject',
    );
    expect(evaluateRecordedTake({ ...HEALTHY, capturedMillis: null, byteSize: null }).kind).toBe(
      'reject',
    );
  });

  it('refuses a take with no file behind it', () => {
    expect(evaluateRecordedTake({ ...HEALTHY, url: null }).kind).toBe('reject');
    expect(evaluateRecordedTake({ ...HEALTHY, url: '' }).kind).toBe('reject');
  });

  it('marks only a size complaint as retryable, since a closing file reads small', () => {
    // The hook re-measures a `small-file` rejection once; the other reasons are
    // final, so mislabelling one would either lose a bad take's error or make
    // the caller wait on a take that is already known to be empty.
    const small = evaluateRecordedTake({ ...HEALTHY, byteSize: 5_000 });
    expect(small.kind === 'reject' ? small.reason : null).toBe('small-file');
    const silent = evaluateRecordedTake({
      url: 'file:///silent.m4a',
      elapsedMillis: 46_000,
      capturedMillis: 230,
      byteSize: null,
    });
    expect(silent.kind === 'reject' ? silent.reason : null).toBe('short-audio');
    const empty = evaluateRecordedTake({ ...HEALTHY, capturedMillis: null, byteSize: null });
    expect(empty.kind === 'reject' ? empty.reason : null).toBe('no-audio');
    const missing = evaluateRecordedTake({ ...HEALTHY, url: null });
    expect(missing.kind === 'reject' ? missing.reason : null).toBe('no-file');
  });

  it('refuses a file below the floor any real recording clears', () => {
    // Short enough that the wall-clock ratio has nothing to say, so only the
    // absolute byte floor can catch it: 900 bytes is not half a second of AAC.
    expect(
      evaluateRecordedTake({
        url: 'file:///tiny.m4a',
        elapsedMillis: 600,
        capturedMillis: 500,
        byteSize: 900,
      }).kind,
    ).toBe('reject');
  });

  it('refuses a file far too small for the audio length it claims', () => {
    // Well over the absolute floor, but 5KB cannot hold 35s of 128 kbps AAC
    // (a measured healthy take of that length was 434,693 bytes).
    expect(evaluateRecordedTake({ ...HEALTHY, byteSize: 5_000 }).kind).toBe('reject');
  });

  it('accepts when the runtime cannot measure the file at all', () => {
    // localFileByteSize returns null off-device; that must not be read as an
    // empty file, and the captured-length check still guards the take.
    expect(evaluateRecordedTake({ ...HEALTHY, byteSize: null }).kind).toBe('accept');
  });

  it('does not judge a sub-second take against the wall clock', () => {
    // A quick tap has too little elapsed time for the ratio to mean anything.
    expect(evaluateRecordedTake({ ...HEALTHY, elapsedMillis: 400, capturedMillis: 180 }).kind).toBe(
      'accept',
    );
  });
});
