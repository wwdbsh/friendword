import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { hasCurrentAiProcessingConsent } from '../../services/aiConsent';
import { pitchDraftService } from '../../services/draftServiceInstance';
import { isUnconfirmedSubmission, unconfirmedDraftMessage } from '../../services/pitchDrafts';
import { NeedsSignInError } from '../../services/pitchDraftsSupabase';
import type { PitchDraftId } from '../../services/types';
import { handleSubmitError, requireDraftId } from './pitchFlowState';
import type { AiConsentUiState } from './AiConsentDisclosure';
import {
  getAiDraftFailureMessage,
  isAiConsentRequiredFailure,
  isManualRecapRequiredFailure,
  preparePitchReview,
  type PitchReviewPreparationChoice,
} from './preparePitchReview';

type PitchSubmissionState = {
  readonly submitting: boolean;
  readonly signInVisible: boolean;
  readonly aiConsentState: AiConsentUiState;
  readonly closeSignIn: () => void;
  readonly refreshAiConsent: () => Promise<void>;
  readonly resumeAfterSignIn: () => Promise<void>;
  readonly submitAi: () => Promise<void>;
  readonly writeManually: () => Promise<void>;
};

export function usePitchSubmission(
  draftId: PitchDraftId | null,
  setErrorMessage: (message: string | null) => void,
): PitchSubmissionState {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [signInVisible, setSignInVisible] = useState(false);
  const [aiConsentState, setAiConsentState] = useState<AiConsentUiState>('checking');
  const inFlight = useRef(false);
  const pendingChoice = useRef<PitchReviewPreparationChoice | null>(null);
  // Set by the consent read below, which already knows the listing's sync state,
  // so blocking a submit costs no extra bounded-and-possibly-stalling call.
  const unconfirmed = useRef<string | null>(null);

  const refreshAiConsent = useCallback(async (): Promise<void> => {
    if (draftId === null) {
      setAiConsentState('required');
      return;
    }
    setAiConsentState('checking');
    try {
      const listing = await pitchDraftService.listMyDrafts();
      const draft = listing.drafts.find((candidate) => candidate.id === draftId);
      // A draft the dater may already have answered must not be re-prepared from
      // this device's unconfirmed copy.
      unconfirmed.current =
        draft !== undefined && isUnconfirmedSubmission(draft, listing.sync)
          ? unconfirmedDraftMessage(
              listing.sync,
              draft.relationship?.friendFirstName ?? 'your friend',
            )
          : null;
      if (unconfirmed.current !== null) {
        setAiConsentState('error');
        setErrorMessage(unconfirmed.current);
        return;
      }
      if (draft?.server === null || draft?.server === undefined) {
        setAiConsentState('required');
        return;
      }
      setAiConsentState(
        (await hasCurrentAiProcessingConsent(draft.server.draftId)) ? 'existing' : 'required',
      );
      setErrorMessage(null);
    } catch (error: unknown) {
      setAiConsentState('error');
      handleSubmitError(error, setErrorMessage);
    }
  }, [draftId, setErrorMessage]);

  useEffect(() => {
    void refreshAiConsent();
  }, [refreshAiConsent]);

  const submit = async (choice: PitchReviewPreparationChoice): Promise<void> => {
    if (inFlight.current) {
      return;
    }
    const activeDraftId = requireDraftId(draftId);
    if (unconfirmed.current !== null) {
      setErrorMessage(unconfirmed.current);
      return;
    }
    pendingChoice.current = choice;
    inFlight.current = true;
    setSubmitting(true);
    try {
      await preparePitchReview(pitchDraftService, activeDraftId, choice);
      pendingChoice.current = null;
      setErrorMessage(null);
      router.push({ pathname: '/pitch/review', params: { draftId: activeDraftId } });
    } catch (error: unknown) {
      if (error instanceof NeedsSignInError) {
        setSignInVisible(true);
        return;
      }
      if (isAiConsentRequiredFailure(error)) {
        pendingChoice.current = null;
        setAiConsentState('required');
        setErrorMessage('External AI processing consent must be confirmed again.');
        return;
      }
      if (isManualRecapRequiredFailure(error)) {
        // CP-8: publishing without AI needs the typed recap as its captions.
        pendingChoice.current = null;
        setErrorMessage('Add a short text recap to publish without AI captions.');
        return;
      }
      pendingChoice.current = null;
      setAiConsentState('error');
      setErrorMessage(getAiDraftFailureMessage(error));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return {
    submitting,
    signInVisible,
    aiConsentState,
    closeSignIn: () => setSignInVisible(false),
    refreshAiConsent,
    resumeAfterSignIn: async () => {
      const choice = pendingChoice.current;
      if (choice !== null) {
        await submit(choice);
      }
    },
    submitAi: () =>
      submit(aiConsentState === 'existing' ? 'use_existing_ai_consent' : 'affirm_ai_consent'),
    writeManually: () => submit('write_manually'),
  };
}
