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
  PitchFlowStateError,
  requireDraftId,
  requireRecording,
  requireReviewData,
} from '../../src/features/pitch/pitchFlowState';
import { usePitchSubmission } from '../../src/features/pitch/usePitchSubmission';
import { trackEvent } from '@friendword/data';

import { SignInSheet } from '../../src/features/auth/SignInSheet';
import { pitchDraftService } from '../../src/services/draftServiceInstance';
import { getSupabaseClient } from '../../src/services/supabaseClient';
import type {
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
  const [contactValue, setContactValue] = useState('');
  const [photos, setPhotos] = useState<readonly PitchPhoto[]>([]);
  const [recording, setRecording] = useState<PitchRecording | null>(null);
  const [draftId, setDraftId] = useState<PitchDraftId | null>(null);
  const [savedRelationship, setSavedRelationship] = useState<PitchRelationship | null>(null);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submission = usePitchSubmission(draftId, setErrorMessage);

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

    const relationship: PitchRelationship = {
      kind: relationshipKind,
      duration: relationshipDuration,
      friendFirstName: friendFirstName.trim(),
      contact: { kind: 'email', value: contactValue.trim() },
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
          contactValue={contactValue}
          errorMessage={errorMessage}
          firstName={friendFirstName}
          onBack={goBack}
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
              void submission.submit();
            }}
            photos={photos}
            recording={review.recording}
            relationship={review.relationship}
            submitting={submission.submitting}
          />
          <SignInSheet
            visible={submission.signInVisible}
            onClose={submission.closeSignIn}
            onSignedIn={() => {
              submission.closeSignIn();
              void submission.submit();
            }}
          />
        </>
      );
    }
    default:
      return assertNever(track);
  }
}
