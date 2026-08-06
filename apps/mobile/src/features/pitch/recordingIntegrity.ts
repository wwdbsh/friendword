/**
 * The take a recorder claims to have made, as this device can actually measure
 * it after the fact.
 */
export type RecordedTakeMeasurement = {
  /** File the recorder wrote, as reported by the recorder itself. */
  readonly url: string | null;
  /**
   * Wall-clock length of the session in milliseconds — what the on-screen timer
   * showed. `expo-audio` derives it from `AVAudioRecorder.deviceCurrentTime`,
   * which keeps advancing whether or not audio is being written, so it is a
   * claim about elapsed time and never evidence of captured audio.
   */
  readonly elapsedMillis: number;
  /**
   * Audio actually written to the file, in milliseconds, sampled from
   * `AVAudioRecorder.currentTime` (frames written) while recording. `null` when
   * this runtime never produced a sample.
   */
  readonly capturedMillis: number | null;
  /** Size of the produced file, or `null` when this runtime cannot measure it. */
  readonly byteSize: number | null;
};

/**
 * Why a take was refused. `small-file` is the one a caller may retry: the size
 * of a file that is still being finalised reads small, so it is not proof of a
 * bad take until it has been measured again after the writer has closed it.
 */
export type RecordedTakeRejection = 'no-file' | 'no-audio' | 'short-audio' | 'small-file';

export type RecordedTakeVerdict =
  | { readonly kind: 'accept'; readonly uri: string; readonly durationMillis: number }
  | { readonly kind: 'reject'; readonly reason: RecordedTakeRejection; readonly message: string };

/** The draft schema refuses anything longer, so a longer take is saved clamped. */
const MAX_TAKE_MILLIS = 60_000;

/**
 * Below this the wall clock is too short for the captured/elapsed ratio to mean
 * anything: a quick tap legitimately loses the tail between the last sample and
 * the stop.
 */
const RATIO_CHECK_MIN_ELAPSED_MILLIS = 1_000;

/**
 * A take must hold at least half of the audio its timer promised.
 *
 * Both numbers are driven by the same audio clock on a healthy recording, where
 * they agree to well under a percent; the only gap is the up-to-one sampling
 * interval of tail that is missed after the last sample. The observed failure
 * had 0.23s of audio behind a 46s timer (0.5%), so this catches it with two
 * orders of magnitude to spare while never being reachable by a healthy take.
 */
const MIN_CAPTURED_RATIO = 0.5;

/**
 * Absolute floor for a file that contains any audio at all. The silent
 * simulator take was 72 bytes end to end; a healthy `.m4a` header alone is
 * larger than this.
 */
export const MIN_TAKE_FILE_BYTES = 1_024;

/**
 * Coarse per-second floor, only there to catch a file that is far too small for
 * the audio it claims. The HIGH_QUALITY preset is 128 kbps AAC (16,000 B/s
 * nominal) and a measured healthy take ran at 12,196 B/s, so this sits ~30x
 * below anything a working microphone produces — deliberately loose, because
 * the captured-length check above is the precise instrument and a quiet room
 * must never be refused as a failure.
 */
export const MIN_TAKE_BYTES_PER_SECOND = 400;

function formatSeconds(millis: number): string {
  return `${Math.round(millis / 100) / 10}s`;
}

/**
 * Decides whether a finished take may be saved as the pitch recording.
 *
 * Exists because the recorder reports success for a take that holds no audio:
 * with no usable input the on-screen timer ran to 46s while the file held 0.23s
 * of digital silence (72 audio bytes), and that take was saved and later played
 * back silent. Nothing here inspects the audio's *content* — a rejection only
 * ever means "the file is not as long as we told you", which is what the copy
 * says.
 */
export function evaluateRecordedTake(measurement: RecordedTakeMeasurement): RecordedTakeVerdict {
  const { url, elapsedMillis, capturedMillis, byteSize } = measurement;
  if (url === null || url.trim() === '') {
    return {
      kind: 'reject',
      reason: 'no-file',
      message: 'The recording file was not saved. Record it again.',
    };
  }
  if (capturedMillis === null || capturedMillis < 1) {
    return {
      kind: 'reject',
      reason: 'no-audio',
      message: 'No audio reached the recording file. Check your microphone and record it again.',
    };
  }
  if (
    elapsedMillis >= RATIO_CHECK_MIN_ELAPSED_MILLIS &&
    capturedMillis < elapsedMillis * MIN_CAPTURED_RATIO
  ) {
    return {
      kind: 'reject',
      reason: 'short-audio',
      message: `Only ${formatSeconds(capturedMillis)} of audio reached the file while the timer showed ${formatSeconds(elapsedMillis)}. Record it again.`,
    };
  }
  if (byteSize !== null) {
    const required = Math.max(
      MIN_TAKE_FILE_BYTES,
      Math.floor((capturedMillis / 1_000) * MIN_TAKE_BYTES_PER_SECOND),
    );
    if (byteSize < required) {
      return {
        kind: 'reject',
        reason: 'small-file',
        message: 'The recording file is too small to hold this take. Record it again.',
      };
    }
  }
  return {
    kind: 'accept',
    uri: url,
    durationMillis: Math.min(Math.round(capturedMillis), MAX_TAKE_MILLIS),
  };
}
