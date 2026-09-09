import { describe, expect, it, vi } from 'vitest';

import {
  findSelfieClip,
  handleSubmitError,
  hasSelfieClip,
  selfieClipFromCapture,
  selfieClipSlotAvailable,
  withSelfieClip,
} from './pitchFlowState';
import type { SelfieCapture } from './selfieClip';
import type { PitchClip } from '../../services/types';

/** M-11: the frames are a dev-build affordance, so a dev build is what this asks for. */
function withDevBundle<T>(run: () => T): T {
  const scope = globalThis as { __DEV__?: unknown };
  scope.__DEV__ = true;
  try {
    return run();
  } finally {
    delete scope.__DEV__;
  }
}

describe('handleSubmitError', () => {
  it('shows the error class and originating frame next to the message on a dev build', () => {
    // T015 defect 2: on a released build this string is the entire diagnostic
    // channel, so "undefined is not an object" alone is not enough to say where
    // the throw came from.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = new TypeError("undefined is not an object (evaluating 'e.rest')");
    error.stack =
      'TypeError: undefined is not an object\n    at rpc (http://10.0.0.2:8081/index.bundle?platform=ios:12345:6)';
    const messages: string[] = [];

    withDevBundle(() => {
      handleSubmitError(error, (message) => messages.push(message));
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("evaluating 'e.rest'");
    expect(messages[0]).toContain('TypeError');
    expect(messages[0]).toContain('rpc@index.bundle:12345:6');
    vi.restoreAllMocks();
  });

  // M-11 (T004, Issue #73): the same failure on a released build. The person
  // sending the pitch gets the sentence; the stack frame is not theirs to read.
  it('shows only the human sentence on a release build', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = new TypeError("undefined is not an object (evaluating 'e.rest')");
    error.stack =
      'TypeError: undefined is not an object\n    at rpc (http://10.0.0.2:8081/index.bundle?platform=ios:12345:6)';
    const messages: string[] = [];

    handleSubmitError(error, (message) => messages.push(message));

    expect(messages).toEqual(["undefined is not an object (evaluating 'e.rest')"]);
    expect(messages[0]).not.toContain('index.bundle');
    vi.restoreAllMocks();
  });

  it('rethrows a thrown non-Error instead of describing it as a message', () => {
    expect(() =>
      handleSubmitError({ nope: true }, () => {
        throw new Error('should not be called');
      }),
    ).toThrow();
  });
});

const PICKED_CLIP: PitchClip = {
  uri: 'file:///beach.mov',
  width: 1080,
  height: 1920,
  durationMillis: 9_000,
  byteSize: 8_000_000,
  mimeType: 'video/quicktime',
  assetKey: 'abc123',
  upload: { objectName: 'clip-abc123.mov', registered: true, validated: false },
};

const CAPTURE: SelfieCapture = {
  uri: 'file:///selfie.mp4',
  durationMillis: 4_000,
  width: 1080,
  height: 1920,
  byteSize: 2_400_000,
  mimeType: 'video/mp4',
};

describe('the selfie clip inside the draft clips', () => {
  it('offers a slot only while the picked clips have not spent the budget', () => {
    // 0050 allows one video per draft without a Campaign Pass and refuses the
    // second one inside registerAsset, after the bytes are already up. Asking
    // first is what keeps the card from offering a doomed recording.
    expect(selfieClipSlotAvailable([], 1)).toBe(true);
    expect(selfieClipSlotAvailable([PICKED_CLIP], 1)).toBe(false);
    expect(selfieClipSlotAvailable([PICKED_CLIP], 3)).toBe(true);
    expect(selfieClipSlotAvailable([], 0)).toBe(false);
  });

  it('does not count the selfie already on the draft against its own slot', () => {
    const clips = withSelfieClip([], selfieClipFromCapture(CAPTURE));

    // Otherwise the card would show "your slot is used" over the clip that is
    // using it, instead of the delete it actually offers.
    expect(selfieClipSlotAvailable(clips, 1)).toBe(true);
  });

  it('has no selfie until one is added', () => {
    expect(findSelfieClip([PICKED_CLIP])).toBeNull();
    expect(hasSelfieClip([PICKED_CLIP])).toBe(false);
  });

  it('appends the selfie after the picked clips, leaving them untouched', () => {
    const selfie = selfieClipFromCapture(CAPTURE);

    const clips = withSelfieClip([PICKED_CLIP], selfie);

    // The picked clip keeps its identity and its upload record: those name
    // bytes already on the server, and reordering or re-keying it would point
    // the row at a different video.
    expect(clips[0]).toBe(PICKED_CLIP);
    expect(clips[1]).toEqual({ ...selfie, role: 'selfie' });
    expect(hasSelfieClip(clips)).toBe(true);
  });

  it('replaces the previous selfie rather than keeping two', () => {
    const first = withSelfieClip([PICKED_CLIP], selfieClipFromCapture(CAPTURE));
    const second = withSelfieClip(
      first,
      selfieClipFromCapture({ ...CAPTURE, uri: 'file:///retake.mp4' }),
    );

    expect(second.filter((clip) => clip.role === 'selfie')).toHaveLength(1);
    expect(findSelfieClip(second)?.uri).toBe('file:///retake.mp4');
  });

  it('removes the selfie and only the selfie', () => {
    const clips = withSelfieClip([PICKED_CLIP], selfieClipFromCapture(CAPTURE));

    expect(withSelfieClip(clips, null)).toEqual([PICKED_CLIP]);
  });

  it('carries the capture measurements the upload ceiling and probe read', () => {
    const selfie = selfieClipFromCapture(CAPTURE);

    expect(selfie).toEqual({
      uri: 'file:///selfie.mp4',
      width: 1080,
      height: 1920,
      durationMillis: 4_000,
      byteSize: 2_400_000,
      mimeType: 'video/mp4',
      role: 'selfie',
    });
    // saveClips mints and keeps the assetKey; a second name for the same bytes
    // would leave one of them orphaned in storage.
    expect(selfie.assetKey).toBeUndefined();
  });
});
