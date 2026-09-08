import { UnauthenticatedError } from '@friendword/data';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, fontSizes, spacing } from '@friendword/ui-tokens';

import { DisplayNameSheet } from '../../src/features/auth/DisplayNameSheet';
import { SignInSheet } from '../../src/features/auth/SignInSheet';
import {
  confirmAndRecheckDisplayName,
  readDisplayNameGate,
} from '../../src/features/auth/displayNameConfirmation';
import {
  AiConsentDisclosure,
  type AiConsentUiState,
} from '../../src/features/pitch/AiConsentDisclosure';
import { ClipIngestNotice } from '../../src/features/pitch/ClipIngestNotice';
import { PitchReviewEditor } from '../../src/features/pitch/PitchReviewEditor';
import { PitchReviewLoadState } from '../../src/features/pitch/PitchReviewLoadState';
import { useClipIngestStatus } from '../../src/features/pitch/useClipIngestStatus';
import {
  getAiDraftFailureMessage,
  isAiConsentRequiredFailure,
  isInsufficientSpeechFailure,
  preparePitchReview,
  type PitchReviewPreparationChoice,
} from '../../src/features/pitch/preparePitchReview';
import { sendBackToRecordAgain } from '../../src/features/pitch/rerecordRecovery';
import { HypeButton, QuietNavAction, TrustCard } from '../../src/components';
import { pitchDraftService } from '../../src/services/draftServiceInstance';
import { getSupabaseClient } from '../../src/services/supabaseClient';
import {
  isUnconfirmedSubmission,
  unconfirmedDraftMessage,
  type DraftSyncState,
} from '../../src/services/pitchDrafts';
import {
  ManualPitchNeedsAiReviewError,
  NeedsSignInError,
} from '../../src/services/pitchDraftsSupabase';
import type { PitchClip, PitchDraft, PitchDraftId, PitchReview } from '../../src/services/types';

/** Shown when the name sheet is dismissed instead of answered — the pitch did not go. */
export const NAME_REQUIRED_TO_SEND_MESSAGE =
  'Your pitch was not sent. Your friend sees your name on it, so pick one first — you can also set it on your account screen.';

/** Stable identity, so a draft-less render does not restart the ingest poll. */
const EMPTY_CLIPS: readonly PitchClip[] = [];

export default function PitchReviewScreen() {
  const router = useRouter();
  const { draftId } = useLocalSearchParams<{ draftId: string }>();
  const [draft, setDraft] = useState<PitchDraft | null>(null);
  const [draftSync, setDraftSync] = useState<DraftSyncState>('confirmed');
  const [review, setReview] = useState<PitchReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signInVisible, setSignInVisible] = useState(false);
  const [nameSheetVisible, setNameSheetVisible] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [aiConsentState, setAiConsentState] = useState<AiConsentUiState>('checking');
  const [needsAiReview, setNeedsAiReview] = useState(false);
  const finalizeInFlight = useRef(false);
  const pendingPreparation = useRef<PitchReviewPreparationChoice | null>(null);
  const friendName = draft?.relationship?.friendFirstName ?? 'your friend';
  // The clips were uploaded by the preparation step above, so this screen is the
  // first place their ingest verdict can be shown.
  const clipIngest = useClipIngestStatus(draft?.id ?? null, draft?.clips ?? EMPTY_CLIPS);

  /**
   * T001 follow-up (issue #70): the server refused to draft from a take nobody
   * can hear and deleted the stored object. This screen cannot fix that — it has
   * no recorder — so the refused take is dropped and the introducer is sent back
   * to the composer's recording step for THIS draft, which is exactly where the
   * wizard's own copy of this failure leaves them. Returns false when the take
   * could not be dropped, so the caller shows the failure instead of sending
   * them to a step that would refuse the new recording.
   */
  const recoverByRerecording = useCallback(
    async (id: PitchDraftId): Promise<boolean> => {
      // REPLACE, inside the helper: the review screen for a draft with no take
      // is not somewhere a back gesture should return to.
      const recovery = await sendBackToRecordAgain(pitchDraftService, id, router);
      if (recovery.kind === 'blocked') {
        setAiConsentState('error');
        setErrorMessage(recovery.message);
        return false;
      }
      return true;
    },
    [router],
  );

  const loadReview = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErrorMessage(null);
    setAiConsentState('checking');
    // The draft this read is preparing, once it is known. Carried out of the
    // `try` so a failure can name the draft without asserting that the route
    // param is one.
    let preparingDraftId: PitchDraftId | null = null;
    try {
      const listing = await pitchDraftService.listMyDrafts();
      const candidate = listing.drafts.find((savedDraft) => savedDraft.id === draftId);
      if (candidate === undefined) {
        setDraft(null);
        setReview(null);
        setErrorMessage('This draft could not be found.');
        return;
      }
      preparingDraftId = candidate.id;
      setDraft(candidate);
      setDraftSync(listing.sync);
      setReview(candidate.review);
      // A submitted draft this device could not confirm may already carry a
      // change request or an approval the introducer has never seen. Editing it
      // stops here rather than preparing a revision of a superseded copy.
      if (isUnconfirmedSubmission(candidate, listing.sync)) {
        return;
      }
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
      if (isInsufficientSpeechFailure(error) && preparingDraftId !== null) {
        await recoverByRerecording(preparingDraftId);
        return;
      }
      setAiConsentState('error');
      setErrorMessage(getAiDraftFailureMessage(error));
    } finally {
      setPreparing(false);
      setLoading(false);
    }
  }, [draftId, recoverByRerecording]);

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
      if (isInsufficientSpeechFailure(error)) {
        await recoverByRerecording(draft.id);
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
    // The editor is not rendered in this state; this also covers the sign-in
    // sheet resuming a finalize that was queued before the block was known.
    if (isUnconfirmedSubmission(draft, draftSync)) {
      setErrorMessage(unconfirmedDraftMessage(draftSync, friendName));
      return;
    }
    finalizeInFlight.current = true;
    setBusy(true);
    try {
      // T002 (Issue #71): the introducer's name is printed on the pitch and on
      // the page it becomes, and `handle_new_auth_user` (0011) filled that
      // field with their email local-part. Ask BEFORE anything is sent, so the
      // dater never receives an invite from "sanghyun.lee92". `unavailable`
      // (no session, no server, failed read) proceeds: the public surfaces
      // withhold an unconfirmed name on their own.
      if ((await readDisplayNameGate(getSupabaseClient())) === 'needs_confirmation') {
        setNameError(null);
        setNameSheetVisible(true);
        return;
      }
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
      // Honest manual→AI trade-off: the server refused a no-AI draft while
      // safety review is on. Surface the reason and offer the AI review path
      // instead of a generic "submission failed".
      if (error instanceof ManualPitchNeedsAiReviewError) {
        setAiConsentState('required');
        setNeedsAiReview(true);
        setErrorMessage(error.message);
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

  /**
   * Saves the name, re-reads the server's answer, and only then resumes the
   * submit. `finalize` is re-entered from the top, so the draft state and the
   * unconfirmed-submission block are re-checked rather than assumed.
   */
  const confirmNameThenFinalize = async (name: string): Promise<void> => {
    setNameSaving(true);
    setNameError(null);
    try {
      const gate = await confirmAndRecheckDisplayName(getSupabaseClient(), name);
      if (gate === 'needs_confirmation') {
        setNameError('That name was not saved. Try again.');
        return;
      }
      setNameSheetVisible(false);
      setErrorMessage(null);
      await finalize();
    } catch {
      setNameError('We could not save that name. Check your connection and try again.');
    } finally {
      setNameSaving(false);
    }
  };

  // Reuses the existing AI-consent disclosure flow: recording consent for the
  // current revision regenerates the draft through AI, which runs the voice
  // moderation the manual path skipped, so the media-validation gate can pass.
  const switchToAiReview = async (): Promise<void> => {
    setNeedsAiReview(false);
    await preparePendingReview('affirm_ai_consent');
  };

  // An unconfirmed submitted draft is presented as what it is — this device's
  // copy — instead of as an editable current state. Ahead of every other branch,
  // so it cannot be regenerated or resent either. Not a dead end: checking again
  // is one tap, and resending needs the network in any case.
  if (draft !== null && !loading && isUnconfirmedSubmission(draft, draftSync)) {
    return (
      <>
        <SafeAreaView style={styles.safeArea}>
          <Stack.Screen options={{ title: 'Review your draft' }} />
          <ScrollView contentContainerStyle={styles.disclosureContent}>
            <TrustCard tone="danger">
              <Text style={styles.blockedTitle}>This pitch has not been checked</Text>
              <Text style={styles.blockedNotice}>
                {unconfirmedDraftMessage(draftSync, friendName)}
              </Text>
              {draftSync === 'signed_out' ? (
                <HypeButton label="Sign in" onPress={() => setSignInVisible(true)} />
              ) : (
                <HypeButton
                  label="Check again"
                  onPress={() => {
                    void loadReview();
                  }}
                />
              )}
              <QuietNavAction
                label="Back to my campaigns"
                onPress={() => router.replace('/campaigns')}
              />
            </TrustCard>
          </ScrollView>
        </SafeAreaView>
        <SignInSheet
          visible={signInVisible}
          purpose="send-pitch"
          onClose={() => setSignInVisible(false)}
          onSignedIn={() => {
            setSignInVisible(false);
            void loadReview();
          }}
        />
      </>
    );
  }

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
          purpose="send-pitch"
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
    // A read is still in flight while `preparing` or `loading`; anything else
    // that lands here is a failure, and PitchReviewLoadState is what turns that
    // distinction into a card with a way out (MUI-5).
    const pending = preparing || loading;
    return (
      <>
        <Stack.Screen options={{ title: 'Review your draft' }} />
        <PitchReviewLoadState
          message={
            preparing
              ? 'Preparing your draft…'
              : loading
                ? 'Loading your draft…'
                : (errorMessage ?? 'This draft could not be found.')
          }
          pending={pending}
          onRetry={() => {
            void loadReview();
          }}
          onBackToCampaigns={() => router.replace('/campaigns')}
        />
      </>
    );
  }

  if (needsAiReview) {
    return (
      <>
        <SafeAreaView style={styles.safeArea}>
          <Stack.Screen options={{ title: 'Review your draft' }} />
          <ScrollView contentContainerStyle={styles.disclosureContent}>
            <Text style={styles.blockedNotice}>{errorMessage}</Text>
            <AiConsentDisclosure
              busy={preparing}
              errorMessage={null}
              onCreateAiDraft={() => {
                void switchToAiReview();
              }}
              onRetry={() => {
                void loadReview();
              }}
              onWriteManually={() => {
                setNeedsAiReview(false);
                setErrorMessage(null);
              }}
              state="required"
            />
          </ScrollView>
        </SafeAreaView>
        <SignInSheet
          visible={signInVisible}
          purpose="send-pitch"
          onClose={() => setSignInVisible(false)}
          onSignedIn={() => {
            setSignInVisible(false);
            void switchToAiReview();
          }}
        />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Review your draft' }} />
      <PitchReviewEditor
        busy={busy}
        errorMessage={errorMessage}
        friendName={friendName}
        notice={
          <ClipIngestNotice
            checking={clipIngest.checking}
            clips={clipIngest.clips}
            onCheckNow={clipIngest.checkNow}
            poll={clipIngest.poll}
          />
        }
        onChange={setReview}
        onSubmit={() => {
          void finalize();
        }}
        review={review}
      />
      <SignInSheet
        visible={signInVisible}
        purpose="send-pitch"
        onClose={() => setSignInVisible(false)}
        onSignedIn={() => {
          setSignInVisible(false);
          void finalize();
        }}
      />
      <DisplayNameSheet
        visible={nameSheetVisible}
        busy={nameSaving}
        errorMessage={nameError}
        onClose={() => {
          setNameError(null);
          setNameSheetVisible(false);
          // Dismissing the sheet cancels the submit. Saying so is the whole
          // point: the previous screen looks identical either way, and a
          // pitch silently not sent is the worst outcome here.
          setErrorMessage(NAME_REQUIRED_TO_SEND_MESSAGE);
        }}
        onConfirm={(name) => {
          void confirmNameThenFinalize(name);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  disclosureContent: { flexGrow: 1, justifyContent: 'center' },
  blockedTitle: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.lg },
  blockedNotice: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: fontSizes.md * 1.45,
    marginBottom: spacing.md,
  },
});
