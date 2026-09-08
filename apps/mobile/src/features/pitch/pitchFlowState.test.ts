import { describe, expect, it, vi } from 'vitest';

import { handleSubmitError } from './pitchFlowState';

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
