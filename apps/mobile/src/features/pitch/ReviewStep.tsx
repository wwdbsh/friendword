import { colors, fontSizes, radii, spacing, strokes } from '@friendword/ui-tokens';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image, StyleSheet, Text, View } from 'react-native';

import { HypeButton, StickerCard } from '../../components';
import type {
  InvitationContact,
  PitchPhoto,
  PitchRecording,
  PitchRelationship,
} from '../../services/types';
import { PitchStepFrame } from './PitchStepFrame';
import { AiConsentDisclosure, type AiConsentUiState } from './AiConsentDisclosure';

type ReviewStepProps = {
  readonly relationship: PitchRelationship;
  readonly photos: readonly PitchPhoto[];
  readonly recording: PitchRecording;
  readonly submitting: boolean;
  readonly errorMessage: string | null;
  readonly progressMessage: string | null;
  readonly aiConsentState: AiConsentUiState;
  readonly onBack: () => void;
  readonly onCreateAiDraft: () => void;
  readonly onRerecord: () => void;
  readonly onRetryAiConsent: () => void;
  readonly onWriteManually: () => void;
};

export function ReviewStep({
  relationship,
  photos,
  recording,
  submitting,
  errorMessage,
  progressMessage,
  aiConsentState,
  onBack,
  onCreateAiDraft,
  onRerecord,
  onRetryAiConsent,
  onWriteManually,
}: ReviewStepProps) {
  const player = useAudioPlayer(recording.uri);
  const playerStatus = useAudioPlayerStatus(player);
  const isLongEnough = recording.durationMillis >= 30_000;

  return (
    <PitchStepFrame
      track={5}
      title="Your mix is ready"
      subtitle={`One last listen before ${relationship.friendFirstName} gets the private approval invite.`}
      onBack={onBack}
      footer={null}
    >
      <StickerCard>
        <Text style={styles.sectionTitle}>The setup</Text>
        <Text style={styles.detail}>
          {relationship.kind} for {relationship.duration.toLowerCase()}
        </Text>
        <Text style={styles.detail}>{formatInvitationContact(relationship.contact)}</Text>
      </StickerCard>

      <StickerCard>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>The voice track</Text>
          <Text style={styles.duration}>{formatDuration(recording.durationMillis)}</Text>
        </View>
        <HypeButton
          label={playerStatus.playing ? 'Pause recording' : 'Play recording'}
          onPress={() => (playerStatus.playing ? player.pause() : player.play())}
          secondary
        />
        <HypeButton label="Record it again" onPress={onRerecord} secondary />
        <View style={styles.caption}>
          <Text style={styles.captionLabel}>Caption</Text>
          <Text style={styles.detail}>{recording.caption}</Text>
        </View>
        {!isLongEnough ? (
          <Text style={styles.error}>This take is under 30 seconds. Record it again to send.</Text>
        ) : null}
      </StickerCard>

      <StickerCard>
        <Text style={styles.sectionTitle}>Photo suggestions</Text>
        <View style={styles.photos}>
          {photos.map((photo, index) => (
            <Image
              key={photo.uri}
              accessibilityLabel={`Suggested photo ${index + 1}`}
              source={{ uri: photo.uri }}
              style={styles.photo}
            />
          ))}
        </View>
        <Text style={styles.consentCopy}>
          Nothing goes public until your friend approves or replaces every photo.
        </Text>
      </StickerCard>

      <AiConsentDisclosure
        busy={!isLongEnough || submitting}
        errorMessage={errorMessage}
        onCreateAiDraft={onCreateAiDraft}
        onRetry={onRetryAiConsent}
        onWriteManually={onWriteManually}
        state={aiConsentState}
      />

      {progressMessage ? <Text style={styles.progress}>{progressMessage}</Text> : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
    </PitchStepFrame>
  );
}

function formatDuration(durationMillis: number): string {
  const seconds = Math.floor(durationMillis / 1000);
  return `0:${seconds.toString().padStart(2, '0')}`;
}

function formatInvitationContact(contact: InvitationContact): string {
  switch (contact.kind) {
    case 'email':
      return `Invite by email: ${contact.value}`;
    case 'phone':
      return `Invite by phone: ${contact.value}`;
    case 'sent':
      return 'Approval contact sent';
  }
}

const styles = StyleSheet.create({
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.lg },
  detail: { color: colors.textSecondary, fontFamily: 'BricolageGrotesque', fontSize: fontSizes.md },
  caption: {
    gap: spacing.xs,
    borderLeftColor: colors.flirt,
    borderLeftWidth: spacing.xs,
    paddingLeft: spacing.md,
  },
  captionLabel: {
    color: colors.flirt,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.sm,
  },
  duration: {
    borderColor: colors.ink,
    borderRadius: radii.pill,
    borderWidth: strokes.sticker,
    backgroundColor: colors.hype,
    color: colors.onHype,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photo: { width: '47%', aspectRatio: 1, borderRadius: radii.sm },
  consentCopy: {
    color: colors.textSecondary,
    fontFamily: 'BricolageGrotesqueSemiBold',
    fontSize: fontSizes.sm,
    lineHeight: fontSizes.sm * 1.45,
  },
  error: { color: colors.danger, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.sm },
  progress: { color: colors.fresh, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.md },
});
