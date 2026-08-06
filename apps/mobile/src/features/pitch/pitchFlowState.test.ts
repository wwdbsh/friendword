import { describe, expect, it, vi } from 'vitest';

import { handleSubmitError } from './pitchFlowState';

describe('handleSubmitError', () => {
  it('shows the error class and originating frame next to the message', () => {
    // T015 defect 2: on a released build this string is the entire diagnostic
    // channel, so "undefined is not an object" alone is not enough to say where
    // the throw came from.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = new TypeError("undefined is not an object (evaluating 'e.rest')");
    error.stack =
      'TypeError: undefined is not an object\n    at rpc (http://10.0.0.2:8081/index.bundle?platform=ios:12345:6)';
    const messages: string[] = [];

    handleSubmitError(error, (message) => messages.push(message));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("evaluating 'e.rest'");
    expect(messages[0]).toContain('TypeError');
    expect(messages[0]).toContain('rpc@index.bundle:12345:6');
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
