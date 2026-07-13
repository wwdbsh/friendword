import { trackEvent } from '@friendword/data';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { requestDraftGeneration } from '../../services/draftGeneration';
import { pitchDraftService } from '../../services/draftServiceInstance';
import { NeedsSignInError } from '../../services/pitchDraftsSupabase';
import { getSupabaseClient } from '../../services/supabaseClient';
import type { PitchDraftId } from '../../services/types';
import { handleSubmitError, requireDraftId } from './pitchFlowState';

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

  const submit = async (): Promise<void> => {
    const activeDraftId = requireDraftId(draftId);
    setSubmitting(true);
    try {
      const submitted = await pitchDraftService.submitForConsent(activeDraftId);
      trackEvent(getSupabaseClient(), 'consent_sent', {
        platform: 'mobile',
        pitch_draft_id: submitted.server?.draftId ?? null,
      });
      if (submitted.server !== null) {
        void requestDraftGeneration(submitted.server.draftId);
      }
      setErrorMessage(null);
      router.replace(
        submitted.server === null
          ? '/campaigns'
          : { pathname: '/pitch/share', params: { draftId: submitted.id } },
      );
    } catch (error: unknown) {
      if (error instanceof NeedsSignInError) {
        setSignInVisible(true);
        return;
      }
      handleSubmitError(error, setErrorMessage);
    } finally {
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
