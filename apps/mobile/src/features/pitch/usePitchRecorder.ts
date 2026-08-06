import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
  type RecordingStatus,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { localFileByteSize } from '../../services/mediaFiles';
import type { PitchRecording } from '../../services/types';
import { evaluateRecordedTake, type RecordedTakeVerdict } from './recordingIntegrity';

const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  directory: 'document',
  isMeteringEnabled: true,
} satisfies RecordingOptions;

/** Keeps a recorder-reported failure short enough to read on a phone. */
const MAX_RECORDER_ERROR_CHARS = 120;

/** Grace given to the writer before a small file is treated as a bad take. */
const FILE_SETTLE_MILLIS = 300;

function recorderFailureMessage(error: string | null | undefined): string {
  const detail = typeof error === 'string' ? error.trim() : '';
  const base = 'This take failed while recording and was not saved. Record it again.';
  return detail === '' ? base : `${base} (${detail.slice(0, MAX_RECORDER_ERROR_CHARS)})`;
}

export function usePitchRecorder(
  recording: PitchRecording | null,
  onRecordingChange: (recording: PitchRecording | null) => void,
  caption: string,
) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const lastSavedUri = useRef<string | null>(recording?.uri ?? null);
  /** Wall clock the on-screen timer showed — a claim, never evidence. */
  const elapsedMillis = useRef(recording?.durationMillis ?? 0);
  /** Audio the recorder reported having written, sampled while recording. */
  const capturedMillis = useRef<number | null>(null);
  /** Set by the status listener when the recorder reports the take failed. */
  const takeFailed = useRef(false);
  const recordingActive = useRef(false);
  const wasRecording = useRef(false);
  const finishing = useRef(false);

  // Registered once by useAudioRecorder (its subscription effect only re-runs on
  // recorder.id), so this callback must stay stable and read only refs.
  const handleRecordingStatus = useCallback((status: RecordingStatus): void => {
    if (status.mediaServicesDidReset === true) {
      takeFailed.current = true;
      recordingActive.current = false;
      setErrorMessage('The system audio service restarted mid-take, so nothing was saved.');
      return;
    }
    if (status.hasError) {
      takeFailed.current = true;
      recordingActive.current = false;
      setErrorMessage(recorderFailureMessage(status.error));
    }
  }, []);

  const recorder = useAudioRecorder(RECORDING_OPTIONS, handleRecordingStatus);
  const recorderState = useAudioRecorderState(recorder, 80);

  /**
   * Saves the take only if the file behind it holds the audio the timer
   * promised. The recorder happily reports a full-length session for a file
   * that holds none (device QA: a 46s timer over 0.23s of digital silence), so
   * the wall clock is never what gets written to the draft.
   */
  async function finishTake(url: string | null): Promise<void> {
    if (finishing.current) {
      return;
    }
    finishing.current = true;
    try {
      if (takeFailed.current) {
        lastSavedUri.current = null;
        onRecordingChange(null);
        return;
      }
      const measure = async (): Promise<RecordedTakeVerdict> =>
        evaluateRecordedTake({
          url,
          elapsedMillis: elapsedMillis.current,
          capturedMillis: capturedMillis.current,
          byteSize: url === null ? null : await localFileByteSize(url),
        });
      let verdict = await measure();
      if (verdict.kind === 'reject' && verdict.reason === 'small-file') {
        // The take is measured as soon as the recorder reports it stopped, which
        // can be before AVAudioRecorder has closed the file — a size read that
        // early is not evidence of a bad take, so it gets one more chance.
        await new Promise((resolve) => setTimeout(resolve, FILE_SETTLE_MILLIS));
        verdict = await measure();
      }
      if (verdict.kind === 'reject') {
        lastSavedUri.current = null;
        onRecordingChange(null);
        setErrorMessage(verdict.message);
        return;
      }
      if (lastSavedUri.current === verdict.uri) {
        return;
      }
      lastSavedUri.current = verdict.uri;
      onRecordingChange({
        uri: verdict.uri,
        durationMillis: verdict.durationMillis,
        caption: caption.trim(),
      });
    } finally {
      finishing.current = false;
    }
  }

  useEffect(() => {
    if (recorderState.isRecording) {
      elapsedMillis.current = Math.max(elapsedMillis.current, recorderState.durationMillis);
      // AVAudioRecorder.currentTime counts the audio actually written, in
      // seconds, and stops advancing the moment capture dies — unlike
      // durationMillis, which is derived from the device clock.
      const captured = recorder.currentTime;
      if (typeof captured === 'number' && Number.isFinite(captured) && captured > 0) {
        capturedMillis.current = Math.max(capturedMillis.current ?? 0, Math.round(captured * 1000));
      }
    }
    if (wasRecording.current && !recorderState.isRecording) {
      recordingActive.current = false;
      void finishTake(recorderState.url ?? recorder.uri);
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(
        (error: unknown) => {
          handleRecordingError(error, setErrorMessage);
        },
      );
    }
    wasRecording.current = recorderState.isRecording;
  }, [recorderState]);

  useEffect(
    () => () => {
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(
        (error: unknown) => {
          if (error instanceof Error) {
            return;
          }
          throw error;
        },
      );
    },
    [],
  );

  const startRecording = async (): Promise<void> => {
    if (recordingActive.current) {
      return;
    }
    recordingActive.current = true;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        recordingActive.current = false;
        setErrorMessage('Microphone access is needed to record your friend’s pitch.');
        return;
      }

      setErrorMessage(null);
      onRecordingChange(null);
      lastSavedUri.current = null;
      elapsedMillis.current = 0;
      capturedMillis.current = null;
      takeFailed.current = false;
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: 60 });
      // expo-audio marks the recorder "recording" without checking whether
      // AVAudioRecorder.record() succeeded; `isRecording` reads the underlying
      // recorder, so it is the one place a refused start is still visible.
      if (recorder.isRecording === false) {
        recordingActive.current = false;
        wasRecording.current = false;
        takeFailed.current = true;
        setErrorMessage('Recording did not start. Check microphone access and try again.');
        // Without this the recorder keeps reporting itself as recording and the
        // on-screen timer would run for a take that never began.
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      }
    } catch (error: unknown) {
      recordingActive.current = false;
      try {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      } catch (restoreError: unknown) {
        handleRecordingError(restoreError, setErrorMessage);
        return;
      }
      handleRecordingError(error, setErrorMessage);
    }
  };

  const stopRecording = async (): Promise<void> => {
    if (!recordingActive.current) {
      return;
    }
    recordingActive.current = false;
    try {
      elapsedMillis.current = Math.max(elapsedMillis.current, recorderState.durationMillis);
      const captured = recorder.currentTime;
      if (typeof captured === 'number' && Number.isFinite(captured) && captured > 0) {
        capturedMillis.current = Math.max(capturedMillis.current ?? 0, Math.round(captured * 1000));
      }
      // The take is saved by the recorder-state effect above, which is the one
      // path both an explicit stop and the 60s auto-stop go through.
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch (error: unknown) {
      recordingActive.current = recorderState.isRecording;
      handleRecordingError(error, setErrorMessage);
    }
  };

  return { recorderState, errorMessage, startRecording, stopRecording };
}

function handleRecordingError(error: unknown, setErrorMessage: (message: string) => void): void {
  if (error instanceof Error) {
    setErrorMessage('Recording did not start. Check microphone access and try again.');
    return;
  }
  throw error;
}
