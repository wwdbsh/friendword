import { describe, expect, it } from 'vitest';

import {
  MAX_ERROR_DIAGNOSTIC_CHARS,
  diagnosticsEnabled,
  formatErrorForDisplay,
} from './errorDiagnostics';

function errorWithStack(name: string, message: string, stack: string): Error {
  const error = new Error(message);
  error.name = name;
  error.stack = stack;
  return error;
}

/**
 * Everything in this block is the DIAGNOSTIC form, which only a dev build
 * shows, so it asks for it explicitly. The release form is the block below.
 */
describe('formatErrorForDisplay', () => {
  it('keeps the message first so existing copy still reads normally', () => {
    const shown = formatErrorForDisplay(errorWithStack('Error', 'Nope', ''), true);
    expect(shown.startsWith('Nope')).toBe(true);
  });

  it('names the error class, which the message alone never does', () => {
    // The device-only crash reads "undefined is not an object (evaluating
    // 'x.rest')"; without the class name a TypeError is indistinguishable from
    // a thrown app error on a TestFlight screenshot.
    const shown = formatErrorForDisplay(
      errorWithStack(
        'TypeError',
        "undefined is not an object (evaluating 'e.rest')",
        'TypeError: undefined is not an object\n    at from (http://10.0.0.2:8081/index.bundle?platform=ios&dev=true:98765:12)',
      ),
      true,
    );
    expect(shown).toContain('TypeError');
    expect(shown).toContain('from');
  });

  it('condenses a frame to function, file, line and column', () => {
    const shown = formatErrorForDisplay(
      errorWithStack(
        'TypeError',
        'boom',
        'TypeError: boom\n    at SupabaseClient.from (http://10.0.0.2:8081/index.bundle?platform=ios&dev=true&token=secret123:98765:12)\n    at submitAi (http://10.0.0.2:8081/index.bundle?platform=ios:4444:9)\n    at third (http://10.0.0.2:8081/index.bundle:1:1)',
      ),
      true,
    );
    expect(shown).toContain('SupabaseClient.from@index.bundle:98765:12');
    expect(shown).toContain('submitAi@index.bundle:4444:9');
  });

  it('never carries the query string of a bundle url into the screen', () => {
    const shown = formatErrorForDisplay(
      errorWithStack(
        'TypeError',
        'boom',
        'TypeError: boom\n    at from (http://10.0.0.2:8081/index.bundle?platform=ios&token=secret123&email=a%40b.com:1:2)',
      ),
      true,
    );
    expect(shown).not.toContain('secret123');
    expect(shown).not.toContain('a%40b.com');
    expect(shown).not.toContain('10.0.0.2');
  });

  it('condenses the dev bundle url whose query is glued on with // instead of ?', () => {
    // Verbatim frame shape from the iOS dev client (2026-08-06 simulator run):
    // Metro joins the bundle parameters with `//&`, so there is no `?` to split
    // on and the last `/` sits in front of the parameters. Splitting on `?`
    // alone printed the whole parameter list on the failure screen.
    const shown = formatErrorForDisplay(
      errorWithStack(
        'DraftGenerationError',
        'We could not create the AI draft. Check your connection and try again.',
        'DraftGenerationError: nope\nDraftGenerationError@http://10.0.0.2:8081/index.bundle//&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.friendword.app:198765:24',
      ),
      true,
    );
    expect(shown).toContain('DraftGenerationError@index.bundle:198765:24');
    expect(shown).not.toContain('platform=ios');
    expect(shown).not.toContain('app=com.friendword.app');
    expect(shown).not.toContain('10.0.0.2');
  });

  it('shows no frame rather than a host when the url has no file name', () => {
    const shown = formatErrorForDisplay(
      errorWithStack(
        'TypeError',
        'boom',
        'TypeError: boom\n    at from (http://10.0.0.2:8081/:1:2)',
      ),
      true,
    );
    expect(shown).toBe('boom · TypeError');
  });

  it('reads the Hermes function@location frame format too', () => {
    const shown = formatErrorForDisplay(
      errorWithStack(
        'TypeError',
        'boom',
        'TypeError: boom\nrpc@/data/app/main.jsbundle:1:7654\nanonymous@/data/app/main.jsbundle:1:12',
      ),
      true,
    );
    expect(shown).toContain('rpc@main.jsbundle:1:7654');
  });

  it('stays inside its character budget however long the stack is', () => {
    const frames = Array.from(
      { length: 40 },
      (_, index) =>
        `    at aVeryLongFunctionNameIndeed${index} (http://10.0.0.2:8081/index.bundle?platform=ios:${index}:${index})`,
    ).join('\n');
    const shown = formatErrorForDisplay(
      errorWithStack('TypeError', 'boom', `boom\n${frames}`),
      true,
    );
    expect(shown.length).toBeLessThanOrEqual('boom'.length + MAX_ERROR_DIAGNOSTIC_CHARS);
  });

  it('falls back to the message when there is no usable stack', () => {
    expect(
      formatErrorForDisplay(errorWithStack('RangeError', 'nope', 'RangeError: nope'), true),
    ).toBe('nope · RangeError');
  });

  it('describes a thrown non-Error without inventing a message', () => {
    expect(formatErrorForDisplay('plain string', true)).toBe(
      'An unexpected error occurred. · string',
    );
  });
});

// M-11 (T004, Issue #73). B4's class-and-frames suffix was built to read a
// crash off a TestFlight screenshot, and a released build was then showing
// "DraftGenerationError @ entry.bundle:248152:31" to an introducer whose AI
// draft had just failed. The sentence is the product; the frames are for us.
describe('what a release build is allowed to print', () => {
  it('shows the human sentence and no class or frames', () => {
    const shown = formatErrorForDisplay(
      errorWithStack(
        'DraftGenerationError',
        'We could not create the AI draft. Check your connection and try again.',
        'DraftGenerationError: nope\nDraftGenerationError@http://10.0.0.2:8081/entry.bundle:248152:31',
      ),
      false,
    );

    expect(shown).toBe('We could not create the AI draft. Check your connection and try again.');
    expect(shown).not.toContain('DraftGenerationError @');
    expect(shown).not.toContain('entry.bundle');
  });

  it('does not name the type of a thrown non-Error either', () => {
    expect(formatErrorForDisplay('plain string', false)).toBe('An unexpected error occurred.');
  });

  it('is the default outside a dev bundle, where __DEV__ does not exist', () => {
    expect(diagnosticsEnabled()).toBe(false);
    expect(
      formatErrorForDisplay(
        errorWithStack('RangeError', 'nope', 'RangeError: nope\nat a (b.js:1:2)'),
      ),
    ).toBe('nope');
  });

  it('turns the frames back on for a dev bundle', () => {
    const scope = globalThis as { __DEV__?: unknown };
    scope.__DEV__ = true;
    try {
      expect(diagnosticsEnabled()).toBe(true);
      expect(formatErrorForDisplay(errorWithStack('RangeError', 'nope', 'RangeError: nope'))).toBe(
        'nope · RangeError',
      );
    } finally {
      delete scope.__DEV__;
    }
  });
});
