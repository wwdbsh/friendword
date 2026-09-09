/**
 * Notices about media the upload step decided *not* to send, kept until a
 * screen reads them.
 *
 * There is one producer and one consumer, and they are on opposite sides of a
 * navigation: `uploadDraftMedia` runs inside `preparePitchReview`, which
 * replaces the composer with the review screen the moment it resolves. A
 * callback or a piece of component state would be unmounted before the message
 * could be drawn, and the alternative — throwing — is exactly what these
 * notices exist to avoid, because everything reported here is optional and the
 * pitch went out fine without it.
 *
 * Deliberately not persisted: a notice describes the submit that just happened,
 * and a stale one shown days later would describe nothing.
 */
let pending: string[] = [];

/** Queues one notice. Repeats of a message already queued are ignored. */
export function recordMediaNotice(message: string): void {
  if (!pending.includes(message)) {
    pending.push(message);
  }
}

/**
 * Every queued notice, clearing the queue. Reading is what consumes them, so a
 * screen that mounts twice does not show the same sentence twice.
 */
export function takeMediaNotices(): readonly string[] {
  const taken = pending;
  pending = [];
  return taken;
}
