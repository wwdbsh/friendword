import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';

import {
  FriendDetailsStep,
  PhotosStep,
  RecordingStep,
  RelationshipStep,
  ReviewStep,
} from '../../src/features/pitch';
import {
  assertNever,
  handleFlowError,
  handleSubmitError,
  PitchFlowStateError,
  requireDraftId,
  requireRecording,
  requireReviewData,
} from '../../src/features/pitch/pitchFlowState';
import { trackEvent } from '@friendword/data';

import { SignInSheet } from '../../src/features/auth/SignInSheet';
import { requestDraftGeneration } from '../../src/services/draftGeneration';
import { pitchDraftService } from '../../src/services/draftServiceInstance';
import { NeedsSignInError } from '../../src/services/pitchDraftsSupabase';
import { getSupabaseClient } from '../../src/services/supabaseClient';
import type {
  InvitationContact,
  PitchDraftId,
  PitchPhoto,
  PitchRecording,
  PitchRelationship,
  RelationshipDuration,
  RelationshipKind,
} from '../../src/services/types';

type PitchTrack = 1 | 2 | 3 | 4 | 5;

export default function NewPitchScreen() {
  const router = useRouter();
  const [track, setTrack] = useState<PitchTrack>(1);
  const [relationshipKind, setRelationshipKind] = useState<RelationshipKind | null>(null);
  const [relationshipDuration, setRelationshipDuration] = useState<RelationshipDuration | null>(
    null,
  );
  const [friendFirstName, setFriendFirstName] = useState('');
  const [contactKind, setContactKind] = useState<InvitationContact['kind']>('phone');
  const [contactValue, setContactValue] = useState('');
  const [photos, setPhotos] = useState<readonly PitchPhoto[]>([]);
  const [recording, setRecording] = useState<PitchRecording | null>(null);
  const [draftId, setDraftId] = useState<PitchDraftId | null>(null);
  const [savedRelationship, setSavedRelationship] = useState<PitchRelationship | null>(null);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [signInVisible, setSignInVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const goBack = useCallback((): void => {
    if (savingRef.current) {
      return;
    }
    switch (track) {
      case 1:
        router.back();
        return;
      case 2:
        setTrack(1);
        return;
      case 3:
        setTrack(2);
        return;
      case 4:
        setTrack(3);
        return;
      case 5:
        setTrack(4);
        return;
      default:
        return assertNever(track);
    }
  }, [router, saving, track]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      goBack();
      return true;
    });
    return () => subscription.remove();
  }, [goBack]);

  useEffect(() => {
    trackEvent(getSupabaseClient(), 'introducer_started', { platform: 'mobile' });
  }, []);

  const saveDetails = async (): Promise<void> => {
    if (savingRef.current) {
      return;
    }
    if (!relationshipKind || !relationshipDuration) {
      throw new PitchFlowStateError();
    }

    const contact: InvitationContact =
      contactKind === 'email'
        ? { kind: 'email', value: contactValue.trim() }
        : { kind: 'phone', value: contactValue.trim() };
    const relationship: PitchRelationship = {
      kind: relationshipKind,
      duration: relationshipDuration,
      friendFirstName: friendFirstName.trim(),
      contact,
    };

    try {
      savingRef.current = true;
      setSaving(true);
      let activeDraftId = draftId;
      if (!activeDraftId) {
        const draft = await pitchDraftService.createDraft();
        activeDraftId = draft.id;
        setDraftId(activeDraftId);
      }
      await pitchDraftService.saveRelationship(activeDraftId, relationship);
      setSavedRelationship(relationship);
      setErrorMessage(null);
      setTrack(3);
    } catch (error: unknown) {
      handleFlowError(error, setErrorMessage);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const savePhotos = async (): Promise<void> => {
    if (savingRef.current) {
      return;
    }
    const activeDraftId = requireDraftId(draftId);
    try {
      savingRef.current = true;
      setSaving(true);
      await pitchDraftService.savePhotos(activeDraftId, photos);
      setErrorMessage(null);
      setTrack(4);
    } catch (error: unknown) {
      handleFlowError(error, setErrorMessage);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const saveRecording = async (): Promise<void> => {
    if (savingRef.current) {
      return;
    }
    const activeDraftId = requireDraftId(draftId);
    const activeRecording = requireRecording(recording);
    try {
      savingRef.current = true;
      setSaving(true);
      await pitchDraftService.saveRecording(activeDraftId, activeRecording);
      trackEvent(getSupabaseClient(), 'voice_recorded', {
        platform: 'mobile',
        duration_ms: activeRecording.durationMillis,
      });
      setErrorMessage(null);
      setTrack(5);
    } catch (error: unknown) {
      handleFlowError(error, setErrorMessage);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

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
      if (submitted.server !== null) {
        router.replace({ pathname: '/pitch/share', params: { draftId: submitted.id } });
      } else {
        router.replace('/campaigns');
      }
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

  switch (track) {
    case 1:
      return (
        <RelationshipStep
          duration={relationshipDuration}
          kind={relationshipKind}
          onBack={goBack}
          onContinue={() => setTrack(2)}
          onDurationChange={setRelationshipDuration}
          onKindChange={setRelationshipKind}
        />
      );
    case 2:
      return (
        <FriendDetailsStep
          busy={saving}
          contactKind={contactKind}
          contactValue={contactValue}
          errorMessage={errorMessage}
          firstName={friendFirstName}
          onBack={goBack}
          onContactKindChange={setContactKind}
          onContactValueChange={setContactValue}
          onContinue={() => {
            void saveDetails();
          }}
          onFirstNameChange={setFriendFirstName}
        />
      );
    case 3:
      return (
        <PhotosStep
          busy={saving}
          photos={photos}
          saveErrorMessage={errorMessage}
          onBack={goBack}
          onContinue={() => {
            void savePhotos();
          }}
          onPhotosChange={setPhotos}
        />
      );
    case 4:
      return (
        <RecordingStep
          busy={saving}
          recording={recording}
          saveErrorMessage={errorMessage}
          onBack={goBack}
          onContinue={() => {
            void saveRecording();
          }}
          onRecordingChange={setRecording}
        />
      );
    case 5: {
      const review = requireReviewData(savedRelationship, recording);
      return (
        <>
          <ReviewStep
            errorMessage={errorMessage}
            onBack={goBack}
            onRerecord={() => setTrack(4)}
            onSubmit={() => {
              void submit();
            }}
            photos={photos}
            recording={review.recording}
            relationship={review.relationship}
            submitting={submitting}
          />
          <SignInSheet
            visible={signInVisible}
            onClose={() => setSignInVisible(false)}
            onSignedIn={() => {
              setSignInVisible(false);
              void submit();
            }}
          />
        </>
      );
    }
    default:
      return assertNever(track);
  }
}
