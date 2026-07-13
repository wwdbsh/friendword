import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';

import { pitchDraftService } from '../../services/draftServiceInstance';
import { NeedsSignInError } from '../../services/pitchDraftsSupabase';
import type { PitchDraftId } from '../../services/types';
import { handleSubmitError, requireDraftId } from './pitchFlowState';
import { preparePitchReview } from './preparePitchReview';

type PitchSubmissionState = {
  readonly submitting: boolean;
  readonly signInVisible: boolean;
  readonly closeSignIn: () => void;
  readonly submit: () => Promise<void>;
};

export function usePitchSubmission(
  draftId: PitchDraftId | null,
  setErrorMessage: (message: string | null) => void,
): PitchSubmissionState {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [signInVisible, setSignInVisible] = useState(false);
  const inFlight = useRef(false);

  const submit = async (): Promise<void> => {
    if (inFlight.current) {
      return;
    }
    const activeDraftId = requireDraftId(draftId);
    inFlight.current = true;
    setSubmitting(true);
    try {
      await preparePitchReview(pitchDraftService, activeDraftId);
      setErrorMessage(null);
      router.push({ pathname: '/pitch/review', params: { draftId: activeDraftId } });
    } catch (error: unknown) {
      if (error instanceof NeedsSignInError) {
        setSignInVisible(true);
        return;
      }
      handleSubmitError(error, setErrorMessage);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return {
    submitting,
    signInVisible,
    closeSignIn: () => setSignInVisible(false),
    submit,
  };
}
