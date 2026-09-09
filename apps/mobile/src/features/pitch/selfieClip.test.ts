import { describe, expect, it } from 'vitest';

import {
  canStopSelfieRecording,
  INITIAL_SELFIE_CLIP_STATE,
  nextSelfieClipState,
  selfieCaptureOf,
  selfieElapsedMs,
  SELFIE_CLIP_MAX_MS,
  SELFIE_CLIP_MIN_MS,
  shouldStopSelfieRecording,
  type SelfieCapture,
  type SelfieClipEvent,
  type SelfieClipState,
} from './selfieClip';

const CAPTURE: SelfieCapture = {
  uri: 'file:///selfie.mp4',
  durationMillis: 4_000,
  width: 1080,
  height: 1920,
  byteSize: 2_400_000,
  mimeType: 'video/mp4',
};

/** The state after a run of events from idle — how every path below is set up. */
function run(...events: readonly SelfieClipEvent[]): SelfieClipState {
  return events.reduce(nextSelfieClipState, INITIAL_SELFIE_CLIP_STATE);
}

const GRANTED = run({ type: 'add' }, { type: 'permission_granted' });

describe('selfie clip state machine', () => {
  it('starts idle and asks for permission on the first tap', () => {
    expect(INITIAL_SELFIE_CLIP_STATE).toEqual({ status: 'idle' });
    expect(run({ type: 'add' })).toEqual({ status: 'requesting' });
  });

  it('opens the preview once permission is granted', () => {
    expect(GRANTED).toEqual({ status: 'ready' });
  });

  it('lands on denied when the person says no, and stays there on a second tap', () => {
    // iOS asks once. A second tap must not re-enter `requesting`, which would
    // leave the card waiting for an answer the OS is never going to send.
    const denied = run({ type: 'add' }, { type: 'permission_denied' });

    expect(denied).toEqual({ status: 'denied' });
    expect(nextSelfieClipState(denied, { type: 'add' })).toBe(denied);
  });

  it('never lets a denial reach a state that holds a take', () => {
    const denied = run({ type: 'add' }, { type: 'permission_denied' });
    const everyEvent: readonly SelfieClipEvent[] = [
      { type: 'add' },
      { type: 'permission_granted' },
      { type: 'permission_denied' },
      { type: 'record_start', atMs: 0 },
      { type: 'tick', atMs: 1_000 },
      { type: 'record_stop', capture: CAPTURE },
      { type: 'record_fail', message: 'no' },
      { type: 'retake' },
      { type: 'discard' },
      { type: 'keep' },
      { type: 'keep_succeeded' },
      { type: 'keep_failed', message: 'no' },
      { type: 'retry' },
    ];

    for (const event of everyEvent) {
      expect(nextSelfieClipState(denied, event)).toEqual({ status: 'denied' });
    }
  });

  it('records from ready and tracks elapsed time from the ticker', () => {
    const recording = nextSelfieClipState(GRANTED, { type: 'record_start', atMs: 10_000 });

    expect(recording).toEqual({ status: 'recording', startedAtMs: 10_000, elapsedMs: 0 });
    expect(nextSelfieClipState(recording, { type: 'tick', atMs: 12_500 })).toEqual({
      status: 'recording',
      startedAtMs: 10_000,
      elapsedMs: 2_500,
    });
  });

  it('ignores a tick that arrives after the recording stopped', () => {
    const captured = run(
      { type: 'add' },
      { type: 'permission_granted' },
      { type: 'record_start', atMs: 0 },
      { type: 'record_stop', capture: CAPTURE },
    );

    expect(nextSelfieClipState(captured, { type: 'tick', atMs: 9_999 })).toBe(captured);
  });

  it('holds the 3s floor and the 5s ceiling', () => {
    const recording = nextSelfieClipState(GRANTED, { type: 'record_start', atMs: 0 });

    expect(canStopSelfieRecording(recording, SELFIE_CLIP_MIN_MS - 1)).toBe(false);
    expect(canStopSelfieRecording(recording, SELFIE_CLIP_MIN_MS)).toBe(true);
    expect(shouldStopSelfieRecording(recording, SELFIE_CLIP_MAX_MS - 1)).toBe(false);
    expect(shouldStopSelfieRecording(recording, SELFIE_CLIP_MAX_MS)).toBe(true);
    // Neither question means anything off a live recording.
    expect(canStopSelfieRecording(GRANTED, 99_999)).toBe(false);
    expect(shouldStopSelfieRecording(GRANTED, 99_999)).toBe(false);
    expect(selfieElapsedMs(GRANTED, 99_999)).toBe(0);
  });

  it('reads a backwards clock as zero rather than a negative length', () => {
    const recording = nextSelfieClipState(GRANTED, { type: 'record_start', atMs: 10_000 });

    expect(selfieElapsedMs(recording, 9_000)).toBe(0);
  });

  it('refuses a take the camera measured under three seconds', () => {
    const recording = nextSelfieClipState(GRANTED, { type: 'record_start', atMs: 0 });

    const state = nextSelfieClipState(recording, {
      type: 'record_stop',
      capture: { ...CAPTURE, durationMillis: SELFIE_CLIP_MIN_MS - 1 },
    });

    expect(state).toEqual({
      status: 'failed',
      message: 'That clip was under 3 seconds. Try one more time.',
      capture: null,
    });
    expect(selfieCaptureOf(state)).toBeNull();
  });

  it('keeps a take of exactly three seconds', () => {
    const recording = nextSelfieClipState(GRANTED, { type: 'record_start', atMs: 0 });
    const capture = { ...CAPTURE, durationMillis: SELFIE_CLIP_MIN_MS };

    expect(nextSelfieClipState(recording, { type: 'record_stop', capture })).toEqual({
      status: 'captured',
      capture,
    });
  });

  it('returns a retake to the live preview holding no take', () => {
    const captured = run(
      { type: 'add' },
      { type: 'permission_granted' },
      { type: 'record_start', atMs: 0 },
      { type: 'record_stop', capture: CAPTURE },
    );

    const retaken = nextSelfieClipState(captured, { type: 'retake' });

    expect(retaken).toEqual({ status: 'ready' });
    expect(selfieCaptureOf(retaken)).toBeNull();
  });

  it('closes the card entirely when the take is deleted', () => {
    const captured = run(
      { type: 'add' },
      { type: 'permission_granted' },
      { type: 'record_start', atMs: 0 },
      { type: 'record_stop', capture: CAPTURE },
    );

    expect(nextSelfieClipState(captured, { type: 'discard' })).toEqual({ status: 'idle' });
  });

  it('uploads only what keep was pressed on, and returns to idle when it lands', () => {
    const captured = run(
      { type: 'add' },
      { type: 'permission_granted' },
      { type: 'record_start', atMs: 0 },
      { type: 'record_stop', capture: CAPTURE },
    );
    const uploading = nextSelfieClipState(captured, { type: 'keep' });

    expect(uploading).toEqual({ status: 'uploading', capture: CAPTURE });
    // A double tap must not restart the upload.
    expect(nextSelfieClipState(uploading, { type: 'keep' })).toBe(uploading);
    expect(nextSelfieClipState(uploading, { type: 'keep_succeeded' })).toEqual({ status: 'idle' });
  });

  it('keeps the take on the device when the upload fails, and retries from it', () => {
    const uploading = run(
      { type: 'add' },
      { type: 'permission_granted' },
      { type: 'record_start', atMs: 0 },
      { type: 'record_stop', capture: CAPTURE },
      { type: 'keep' },
    );

    const failed = nextSelfieClipState(uploading, { type: 'keep_failed', message: 'Offline.' });

    expect(failed).toEqual({ status: 'failed', message: 'Offline.', capture: CAPTURE });
    expect(selfieCaptureOf(failed)).toEqual(CAPTURE);
    expect(nextSelfieClipState(failed, { type: 'retry' })).toEqual({
      status: 'captured',
      capture: CAPTURE,
    });
  });

  it('retries a capture failure from the preview, since there is no take to send', () => {
    const failed = run(
      { type: 'add' },
      { type: 'permission_granted' },
      { type: 'record_start', atMs: 0 },
      { type: 'record_fail', message: 'The camera stopped.' },
    );

    expect(failed).toEqual({ status: 'failed', message: 'The camera stopped.', capture: null });
    expect(nextSelfieClipState(failed, { type: 'retry' })).toEqual({ status: 'ready' });
  });

  it('ignores a record_start that did not come from the preview', () => {
    const requesting = run({ type: 'add' });

    expect(nextSelfieClipState(requesting, { type: 'record_start', atMs: 0 })).toBe(requesting);
  });
});
