/**
 * Diagnostics that may be appended to an on-screen error message.
 *
 * Exists because a released build only ever shows `error.message`, and the
 * message alone does not identify a failure like "undefined is not an object
 * (evaluating 'e.rest')": the class of the error and the frame it came from are
 * what say whether it is app code or a library call. TestFlight screenshots are
 * the only channel that carries this back from a real device.
 *
 * Everything appended is derived from the error's own class name and from
 * frames reduced to `function@file:line:column`. Hosts, query strings and
 * directories are dropped, so a bundle URL's parameters (which can carry a dev
 * token) never reach the screen, and no user data is read at all.
 */
export const MAX_ERROR_DIAGNOSTIC_CHARS = 200;

/**
 * Whether this build may print developer diagnostics on a user-facing surface.
 *
 * The class-and-frames suffix was added (B4) to read a crash off a TestFlight
 * screenshot, and it did its job — but a released build was then showing
 * "DraftGenerationError @ entry.bundle:248152:31" to the person who just tried
 * to write a pitch. Metro defines `__DEV__` in every dev bundle and sets it to
 * false in a release build, so it is exactly the line between "someone is
 * debugging this" and "someone is using this". Read off `globalThis` because
 * the constant does not exist at all under plain Node (the unit tests), where
 * the answer is the same as a release build: no frames.
 */
export function diagnosticsEnabled(): boolean {
  return (globalThis as { __DEV__?: unknown }).__DEV__ === true;
}

const MAX_FRAMES = 2;

/**
 * The bare file name of a stack frame's location, or null when there is none.
 *
 * Metro's dev client does not always separate the bundle parameters with `?`:
 * the iOS dev bundle arrives as `/index.bundle//&platform=ios&dev=true…`, so
 * cutting on `?` alone leaves the whole parameter list attached — and because
 * the last `/` then sits in front of it, the parameters became the "file name"
 * on the failure screen. Cut on whichever of `?` or `&` comes first instead, so
 * a parameter list is dropped in either form.
 */
function condenseFileName(rawPath: string): string | null {
  const queryAt = rawPath.search(/[?&]/);
  const withoutQuery = queryAt === -1 ? rawPath : rawPath.slice(0, queryAt);
  // Drop scheme and host explicitly rather than relying on a `/` being the last
  // separator: `http://host:8081/` must yield no frame at all, never the host.
  const schemed = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\/[^/]*(\/.*)?$/.exec(withoutQuery);
  const path = schemed === null ? withoutQuery : (schemed[1] ?? '');
  // `//&` leaves an empty trailing segment once the parameters are gone.
  const trimmed = path.replace(/\/+$/, '');
  const file = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return file === '' ? null : file;
}

function condenseLocation(location: string): string | null {
  // line:column is appended after the url, query string and all, so it has to
  // come off the end before the query can be dropped.
  const positioned = /^(.*):(\d+):(\d+)$/.exec(location.trim());
  if (positioned === null) {
    return null;
  }
  // The query can carry dev-server tokens, so it never reaches the screen.
  const file = condenseFileName(positioned[1] ?? '');
  if (file === null) {
    return null;
  }
  return `${file}:${positioned[2] ?? ''}:${positioned[3] ?? ''}`;
}

function condenseFrame(line: string): string | null {
  const trimmed = line.trim();
  const parenthesised = /^at\s+(.*?)\s*\((.+)\)$/.exec(trimmed);
  if (parenthesised !== null) {
    const location = condenseLocation(parenthesised[2] ?? '');
    return location === null ? null : `${parenthesised[1] ?? 'anonymous'}@${location}`;
  }
  const bare = /^at\s+(.+)$/.exec(trimmed);
  if (bare !== null) {
    const location = condenseLocation(bare[1] ?? '');
    return location === null ? null : location;
  }
  const hermes = /^([^@\s]*)@(.+)$/.exec(trimmed);
  if (hermes !== null) {
    const location = condenseLocation(hermes[2] ?? '');
    return location === null ? null : `${hermes[1] === '' ? 'anonymous' : hermes[1]}@${location}`;
  }
  return null;
}

function condenseStack(stack: string | undefined): string {
  if (typeof stack !== 'string') {
    return '';
  }
  const frames: string[] = [];
  for (const line of stack.split('\n')) {
    const frame = condenseFrame(line);
    if (frame !== null) {
      frames.push(frame);
    }
    if (frames.length === MAX_FRAMES) {
      break;
    }
  }
  return frames.join(' < ');
}

/**
 * `error.message` with the error's class and top frames appended, capped so it
 * still fits on a phone screen. The message stays first and unchanged, so copy
 * that already reads well is not rewritten.
 *
 * The appended part is developer diagnostics, so it is gated: a release build
 * shows the human sentence and nothing else. `showDiagnostics` defaults to
 * {@link diagnosticsEnabled} and is a parameter only so the tests can pin both
 * halves without reaching into globals.
 */
export function formatErrorForDisplay(
  error: unknown,
  showDiagnostics: boolean = diagnosticsEnabled(),
): string {
  if (!(error instanceof Error)) {
    return showDiagnostics
      ? `An unexpected error occurred. · ${typeof error}`
      : 'An unexpected error occurred.';
  }
  if (!showDiagnostics) {
    return error.message;
  }
  const frames = condenseStack(error.stack);
  const diagnostic = frames === '' ? ` · ${error.name}` : ` · ${error.name} @ ${frames}`;
  return `${error.message}${diagnostic.slice(0, MAX_ERROR_DIAGNOSTIC_CHARS)}`;
}
