import { trackEvent, UnauthenticatedError } from '@friendword/data';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, fontSizes, spacing } from '@friendword/ui-tokens';

import { SignInSheet } from '../../src/features/auth/SignInSheet';
import { PitchReviewEditor } from '../../src/features/pitch/PitchReviewEditor';
import { preparePitchReview } from '../../src/features/pitch/preparePitchReview';
import { HypeButton } from '../../src/components';
import { pitchDraftService } from '../../src/services/draftServiceInstance';
import { NeedsSignInError } from '../../src/services/pitchDraftsSupabase';
import { getSupabaseClient } from '../../src/services/supabaseClient';
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
  const finalizeInFlight = useRef(false);

  const loadReview = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErrorMessage(null);
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
        const prepared = await preparePitchReview(pitchDraftService, candidate.id);
        setDraft(prepared);
        setReview(prepared.review);
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        setErrorMessage(error.message);
        return;
      }
      throw error;
    } finally {
      setPreparing(false);
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    void loadReview();
  }, [loadReview]);

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
      trackEvent(getSupabaseClient(), 'consent_sent', {
        platform: 'mobile',
        pitch_draft_id: finalized.server?.draftId ?? null,
      });
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

  if (draft === null || review === null || review.generationMode === 'pending') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ title: 'Review your draft' }} />
        <Text style={styles.message}>
          {preparing ? '친구 자랑을 글로 정리하는 중…' : (errorMessage ?? 'Loading your draft…')}
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
  message: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: fontSizes.md },
});
