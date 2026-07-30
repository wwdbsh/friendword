import { useCallback, useEffect, useRef, useState } from 'react';

import {
  advanceClipIngestPoll,
  CLIP_INGEST_POLL_INTERVAL_MS,
  startClipIngestPoll,
  type ClipIngestPoll,
} from '../../services/clipIngest';
import { pitchDraftService } from '../../services/draftServiceInstance';
import type { ClipIngestState, PitchClip, PitchDraftId } from '../../services/types';

/** The states that have a job behind them: a clip that was never uploaded has none. */
function uploadedClipStates(clips: readonly PitchClip[]): readonly (ClipIngestState | undefined)[] {
  return clips.flatMap((clip) => (clip.upload === undefined ? [] : [clip.ingest]));
}

export type ClipIngestStatus = {
  /** The draft's clips with the freshest ingest states this device has heard. */
  readonly clips: readonly PitchClip[];
  readonly poll: ClipIngestPoll;
  readonly checking: boolean;
  /** Asks the server again now, whatever the poll phase is. */
  readonly checkNow: () => void;
};

/**
 * Keeps a screen's view of clip ingest states current while any uploaded clip is
 * still unreported.
 *
 * Polls rather than subscribes because the state is produced by a background
 * worker: there is no row this client is allowed to listen on, and the verdict
 * matters within seconds of an upload. Stops on its own once every clip has a
 * final state or the attempts run out, so a screen left open cannot keep asking
 * forever, and the introducer can still ask by hand (`checkNow`).
 *
 * A refresh that answers nothing never rewrites a state — see
 * `HybridPitchDraftService.refreshClipIngest`.
 */
export function useClipIngestStatus(
  draftId: PitchDraftId | null,
  draftClips: readonly PitchClip[],
  intervalMs: number = CLIP_INGEST_POLL_INTERVAL_MS,
  service: Pick<typeof pitchDraftService, 'refreshClipIngest'> = pitchDraftService,
): ClipIngestStatus {
  const [clips, setClips] = useState<readonly PitchClip[]>(draftClips);
  const [poll, setPoll] = useState<ClipIngestPoll>(() =>
    startClipIngestPoll(uploadedClipStates(draftClips)),
  );
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    setClips(draftClips);
    setPoll(startClipIngestPoll(uploadedClipStates(draftClips)));
  }, [draftClips]);

  const refresh = useCallback(async (): Promise<void> => {
    if (draftId === null || inFlight.current) {
      return;
    }
    inFlight.current = true;
    setChecking(true);
    try {
      const refreshed = await service.refreshClipIngest(draftId);
      setClips(refreshed.clips);
      setPoll((current) => advanceClipIngestPoll(current, uploadedClipStates(refreshed.clips)));
    } catch (error: unknown) {
      // An unreadable draft or an offline device is not something to tell the
      // introducer about here: the phase already says the review is unconfirmed,
      // and the states on screen are the last ones the server actually reported.
      console.warn(
        'Could not refresh clip ingest state:',
        error instanceof Error ? error.message : 'Unknown ingest refresh error.',
      );
      setPoll((current) => advanceClipIngestPoll(current, uploadedClipStates(clips)));
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }, [clips, draftId, service]);

  useEffect(() => {
    if (draftId === null || poll.phase !== 'waiting') {
      return;
    }
    const timer = setTimeout(() => {
      void refresh();
    }, intervalMs);
    return () => clearTimeout(timer);
  }, [draftId, intervalMs, poll, refresh]);

  return {
    clips,
    poll,
    checking,
    checkNow: () => {
      void refresh();
    },
  };
}
