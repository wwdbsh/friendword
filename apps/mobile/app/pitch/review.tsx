import { UnauthenticatedError } from '@friendword/data';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, fontSizes, spacing } from '@friendword/ui-tokens';

import { SignInSheet } from '../../src/features/auth/SignInSheet';
import {
  AiConsentDisclosure,
  type AiConsentUiState,
} from '../../src/features/pitch/AiConsentDisclosure';
import { PitchReviewEditor } from '../../src/features/pitch/PitchReviewEditor';
import {
  getAiDraftFailureMessage,
  isAiConsentRequiredFailure,
  preparePitchReview,
  type PitchReviewPreparationChoice,
} from '../../src/features/pitch/preparePitchReview';
import { HypeButton } from '../../src/components';
import { pitchDraftService } from '../../src/services/draftServiceInstance';
import { NeedsSignInError } from '../../src/services/pitchDraftsSupabase';
import type { PitchDraft, PitchReview } from '../../src/services/types';

export default function PitchReviewScreen() {
  const router = useRouter();
  const { draftId } = useLocalSearchParams<{ draftId: string }>();
  const [draft, setDraft] = useState<PitchDraft | null>(null);
  const [review, setReview] = useState<PitchReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signInVisible, setSignInVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [aiConsentState, setAiConsentState] = useState<AiConsentUiState>('checking');
  const finalizeInFlight = useRef(false);
  const pendingPreparation = useRef<PitchReviewPreparationChoice | null>(null);

  const loadReview = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErrorMessage(null);
    setAiConsentState('checking');
    try {
      const candidate = (await pitchDraftService.getMyDrafts()).find(
        (savedDraft) => savedDraft.id === draftId,
      );
      if (candidate === undefined) {
        setDraft(null);
        setReview(null);
        setErrorMessage('This draft could not be found.');
        return;
      }
      setDraft(candidate);
      setReview(candidate.review);
      if (candidate.review.generationMode === 'pending') {
        setPreparing(true);
        const prepared = await preparePitchReview(
          pitchDraftService,
          candidate.id,
          'use_existing_ai_consent',
        );
        setDraft(prepared);
        setReview(prepared.review);
      }
    } catch (error: unknown) {
      if (isAiConsentRequiredFailure(error)) {
        setAiConsentState('required');
        setErrorMessage(null);
        return;
      }
      setAiConsentState('error');
      setErrorMessage(getAiDraftFailureMessage(error));
    } finally {
      setPreparing(false);
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    void loadReview();
  }, [loadReview]);

  const preparePendingReview = async (choice: PitchReviewPreparationChoice): Promise<void> => {
    if (draft === null || preparing) {
      return;
    }
    pendingPreparation.current = choice;
    setPreparing(true);
    setErrorMessage(null);
    try {
      const prepared = await preparePitchReview(pitchDraftService, draft.id, choice);
      pendingPreparation.current = null;
      setDraft(prepared);
      setReview(prepared.review);
      setAiConsentState('existing');
    } catch (error: unknown) {
      if (error instanceof NeedsSignInError || error instanceof UnauthenticatedError) {
        setSignInVisible(true);
        return;
      }
      pendingPreparation.current = null;
      if (isAiConsentRequiredFailure(error)) {
        setAiConsentState('required');
        setErrorMessage('External AI processing consent must be confirmed again.');
        return;
      }
      setAiConsentState('error');
      setErrorMessage(getAiDraftFailureMessage(error));
    } finally {
      setPreparing(false);
    }
  };

  const finalize = async (): Promise<void> => {
    if (draft === null || review === null || busy || finalizeInFlight.current) {
      return;
    }
    finalizeInFlight.current = true;
    setBusy(true);
    try {
      await pitchDraftService.saveReview(draft.id, review);
      const wasChangesRequested = draft.status === 'changes_requested';
      const finalized = await pitchDraftService.finalizeConsent(draft.id);
      setErrorMessage(null);
      if (finalized.server === null) {
        router.replace('/campaigns');
        return;
      }
      router.replace({
        pathname: '/pitch/share',
        params: { draftId: finalized.id, resent: wasChangesRequested ? '1' : '0' },
      });
    } catch (error: unknown) {
      if (error instanceof NeedsSignInError || error instanceof UnauthenticatedError) {
        setSignInVisible(true);
        return;
      }
      if (error instanceof Error) {
        setErrorMessage(error.message);
        return;
      }
      throw error;
    } finally {
      finalizeInFlight.current = false;
      setBusy(false);
    }
  };

  if (
    draft !== null &&
    review !== null &&
    review.generationMode === 'pending' &&
    !loading &&
    !preparing
  ) {
    return (
      <>
        <SafeAreaView style={styles.safeArea}>
          <Stack.Screen options={{ title: 'Review your draft' }} />
          <ScrollView contentContainerStyle={styles.disclosureContent}>
            <AiConsentDisclosure
              busy={preparing}
              errorMessage={errorMessage}
              onCreateAiDraft={() => {
                void preparePendingReview('affirm_ai_consent');
              }}
              onRetry={() => {
                void loadReview();
              }}
              onWriteManually={() => {
                void preparePendingReview('write_manually');
              }}
              state={aiConsentState}
            />
          </ScrollView>
        </SafeAreaView>
        <SignInSheet
          visible={signInVisible}
          onClose={() => setSignInVisible(false)}
          onSignedIn={() => {
            setSignInVisible(false);
            const choice = pendingPreparation.current;
            if (choice !== null) {
              void preparePendingReview(choice);
            }
          }}
        />
      </>
    );
  }

  if (draft === null || review === null || review.generationMode === 'pending') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ title: 'Review your draft' }} />
        <Text style={styles.message}>
          {preparing ? 'Preparing your draft…' : (errorMessage ?? 'Loading your draft…')}
        </Text>
        {!loading && errorMessage ? <HypeButton label="Try again" onPress={loadReview} /> : null}
      </SafeAreaView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Review your draft' }} />
      <PitchReviewEditor
        busy={busy}
        errorMessage={errorMessage}
        friendName={draft.relationship?.friendFirstName ?? 'your friend'}
        onChange={setReview}
        onSubmit={() => {
          void finalize();
        }}
        review={review}
      />
      <SignInSheet
        visible={signInVisible}
        onClose={() => setSignInVisible(false)}
        onSignedIn={() => {
          setSignInVisible(false);
          void finalize();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  disclosureContent: { flexGrow: 1, justifyContent: 'center' },
  message: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: fontSizes.md },
});
