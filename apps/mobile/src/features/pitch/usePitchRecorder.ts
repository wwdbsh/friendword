import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { useEffect, useRef, useState } from 'react';

import type { PitchRecording } from '../../services/types';

const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  directory: 'document',
  isMeteringEnabled: true,
} satisfies RecordingOptions;

export function usePitchRecorder(
  recording: PitchRecording | null,
  onRecordingChange: (recording: PitchRecording | null) => void,
  caption: string,
) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const lastSavedUri = useRef<string | null>(recording?.uri ?? null);
  const lastDurationMillis = useRef(recording?.durationMillis ?? 0);
  const recordingActive = useRef(false);
  const wasRecording = useRef(false);
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 80);

  function saveFinishedRecording(url: string | null, durationMillis: number): void {
    if (!url || durationMillis <= 0 || lastSavedUri.current === url) {
      return;
    }

    lastSavedUri.current = url;
    onRecordingChange({
      uri: url,
      durationMillis: Math.min(durationMillis, 60_000),
      caption: caption.trim(),
    });
  }

  useEffect(() => {
    if (recorderState.isRecording) {
      lastDurationMillis.current = Math.max(
        lastDurationMillis.current,
        recorderState.durationMillis,
      );
    }
    if (wasRecording.current && !recorderState.isRecording) {
      recordingActive.current = false;
      saveFinishedRecording(recorderState.url ?? recorder.uri, lastDurationMillis.current);
      void setAudioModeAsync({ allowsRecording: false }).catch((error: unknown) => {
        handleRecordingError(error, setErrorMessage);
      });
    }
    wasRecording.current = recorderState.isRecording;
  }, [recorderState]);

  useEffect(
    () => () => {
      void setAudioModeAsync({ allowsRecording: false }).catch((error: unknown) => {
        if (error instanceof Error) {
          return;
        }
        throw error;
      });
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
      lastDurationMillis.current = 0;
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: 60 });
    } catch (error: unknown) {
      recordingActive.current = false;
      try {
        await setAudioModeAsync({ allowsRecording: false });
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
      lastDurationMillis.current = Math.max(
        lastDurationMillis.current,
        recorderState.durationMillis,
      );
      await recorder.stop();
      saveFinishedRecording(recorder.uri, lastDurationMillis.current);
      await setAudioModeAsync({ allowsRecording: false });
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
