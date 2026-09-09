/**
 * The optional 3-second selfie opener, as a pure state machine
 * (docs/REEL_V3_DESIGN.md §3).
 *
 * Every rule that matters is here rather than in the card that renders it: the
 * camera, the permission prompt and the upload are all effects a screen runs,
 * and what may follow what is decided by {@link nextSelfieClipState} alone.
 *
 * Two invariants this file exists to hold:
 *
 * - **Optional means optional.** No state is reachable in which a denied camera
 *   permission, a failed capture or a failed upload stops the pitch. `denied`
 *   and `failed` both keep an explanation and an exit, and neither is a state
 *   the rest of the composer reads.
 * - **The take is the introducer's own.** A capture is only ever kept by an
 *   explicit `keep`, and `retake`/`discard` return to a state that holds no
 *   capture at all, so a discarded take can never be the one that uploads.
 */

/** Shortest take worth keeping. Below it the render worker has no opener. */
export const SELFIE_CLIP_MIN_MS = 3_000;
/** Hard stop. The opener is an opener, not a second pitch. */
export const SELFIE_CLIP_MAX_MS = 5_000;

/** What the camera handed back, before anything is uploaded. */
export type SelfieCapture = {
  readonly uri: string;
  readonly durationMillis: number;
  readonly width: number;
  readonly height: number;
  readonly byteSize: number;
  readonly mimeType: 'video/mp4' | 'video/quicktime';
};

export type SelfieClipState =
  /** Nothing asked for yet — the card shows only its offer. */
  | { readonly status: 'idle' }
  /** The OS permission prompt is up. */
  | { readonly status: 'requesting' }
  /**
   * Camera access is off for Friendword. A dead end for the camera only: the
   * card says so and offers Settings, and the pitch continues without a clip.
   */
  | { readonly status: 'denied' }
  /** Permission granted, preview live, nothing recorded yet. */
  | { readonly status: 'ready' }
  /** Recording. `elapsedMs` is what the screen's ticker last reported. */
  | { readonly status: 'recording'; readonly startedAtMs: number; readonly elapsedMs: number }
  /** A take is on the device, waiting for retake / discard / keep. */
  | { readonly status: 'captured'; readonly capture: SelfieCapture }
  /** The kept take is on its way to the draft. */
  | { readonly status: 'uploading'; readonly capture: SelfieCapture }
  /**
   * Something the introducer may retry. `capture` is the take still on the
   * device when there is one (a failed upload), and null when the failure is
   * what stopped there being a take at all.
   */
  | {
      readonly status: 'failed';
      readonly message: string;
      readonly capture: SelfieCapture | null;
    };

export type SelfieClipEvent =
  /** The introducer tapped the card's offer. */
  | { readonly type: 'add' }
  | { readonly type: 'permission_granted' }
  | { readonly type: 'permission_denied' }
  | { readonly type: 'record_start'; readonly atMs: number }
  /** The screen's ticker, and the only thing that can reach the hard stop. */
  | { readonly type: 'tick'; readonly atMs: number }
  | { readonly type: 'record_stop'; readonly capture: SelfieCapture }
  | { readonly type: 'record_fail'; readonly message: string }
  /** Throw this take away and stay on the camera. */
  | { readonly type: 'retake' }
  /** Throw this take away and close the camera. */
  | { readonly type: 'discard' }
  | { readonly type: 'keep' }
  | { readonly type: 'keep_succeeded' }
  | { readonly type: 'keep_failed'; readonly message: string }
  /** Retry after a failure, from whatever the failure left behind. */
  | { readonly type: 'retry' };

export const INITIAL_SELFIE_CLIP_STATE: SelfieClipState = { status: 'idle' };

/**
 * How long the current take has run, or 0 when nothing is recording.
 * `atMs` is a wall clock the caller supplies; a clock that went backwards is
 * clamped to 0 rather than producing a negative length.
 */
export function selfieElapsedMs(state: SelfieClipState, atMs: number): number {
  return state.status === 'recording' ? Math.max(0, atMs - state.startedAtMs) : 0;
}

/** True once the take is long enough to be worth keeping. */
export function canStopSelfieRecording(state: SelfieClipState, atMs: number): boolean {
  return state.status === 'recording' && selfieElapsedMs(state, atMs) >= SELFIE_CLIP_MIN_MS;
}

/**
 * True at the hard stop. The screen stops the camera on this; the machine also
 * refuses to stay in `recording` past it, so a screen whose ticker stalled
 * cannot bank a longer take.
 */
export function shouldStopSelfieRecording(state: SelfieClipState, atMs: number): boolean {
  return state.status === 'recording' && selfieElapsedMs(state, atMs) >= SELFIE_CLIP_MAX_MS;
}

/** The take this state is holding, if any — the only thing worth uploading. */
export function selfieCaptureOf(state: SelfieClipState): SelfieCapture | null {
  if (state.status === 'captured' || state.status === 'uploading') {
    return state.capture;
  }
  return state.status === 'failed' ? state.capture : null;
}

const TOO_SHORT_MESSAGE = 'That clip was under 3 seconds. Try one more time.';

/**
 * The state after one event. Unknown transitions return the state unchanged:
 * a late tick from a stopped recording, a second `keep` from a double tap, or
 * a permission answer for a request that was already resolved must not move
 * the card anywhere.
 */
export function nextSelfieClipState(
  state: SelfieClipState,
  event: SelfieClipEvent,
): SelfieClipState {
  switch (event.type) {
    case 'add':
      // Only from a state with no camera open and no take to lose. `denied`
      // stays denied: the OS will not ask twice, so a second tap there has to
      // go to Settings, which is what the card offers instead.
      return state.status === 'idle' ? { status: 'requesting' } : state;
    case 'permission_granted':
      return state.status === 'requesting' ? { status: 'ready' } : state;
    case 'permission_denied':
      return state.status === 'requesting' ? { status: 'denied' } : state;
    case 'record_start':
      return state.status === 'ready'
        ? { status: 'recording', startedAtMs: event.atMs, elapsedMs: 0 }
        : state;
    case 'tick':
      if (state.status !== 'recording') {
        return state;
      }
      return { ...state, elapsedMs: selfieElapsedMs(state, event.atMs) };
    case 'record_stop': {
      if (state.status !== 'recording') {
        return state;
      }
      // The length on the capture decides. It is the app's own timing of the
      // take — `recordAsync` resolves with a uri and nothing else, and nothing
      // here probes the container — so it is a floor guard, not a measurement:
      // it stops a take the screen watched run for under three seconds, and the
      // server re-reads the real length during ingest.
      if (event.capture.durationMillis < SELFIE_CLIP_MIN_MS) {
        return { status: 'failed', message: TOO_SHORT_MESSAGE, capture: null };
      }
      return { status: 'captured', capture: event.capture };
    }
    case 'record_fail':
      return state.status === 'recording'
        ? { status: 'failed', message: event.message, capture: null }
        : state;
    case 'retake':
      // Back to the live preview, holding nothing. Reachable from a failure
      // too, which is how a too-short take gets its second try.
      return state.status === 'captured' || state.status === 'failed' ? { status: 'ready' } : state;
    case 'discard':
      // Deleting the take closes the camera as well: the card is optional and
      // this is how the introducer says no after seeing themselves.
      return state.status === 'captured' || state.status === 'failed' ? { status: 'idle' } : state;
    case 'keep':
      return state.status === 'captured' ? { status: 'uploading', capture: state.capture } : state;
    case 'keep_succeeded':
      // The clip now lives in the draft, so this card is done with it.
      return state.status === 'uploading' ? { status: 'idle' } : state;
    case 'keep_failed':
      // The take is still on the device, so the retry is a re-upload rather
      // than a re-record.
      return state.status === 'uploading'
        ? { status: 'failed', message: event.message, capture: state.capture }
        : state;
    case 'retry':
      if (state.status !== 'failed') {
        return state;
      }
      return state.capture === null
        ? { status: 'ready' }
        : { status: 'captured', capture: state.capture };
    default:
      return assertNeverEvent(event);
  }
}

function assertNeverEvent(event: never): never {
  throw new Error(`Unhandled selfie clip event: ${JSON.stringify(event)}`);
}
