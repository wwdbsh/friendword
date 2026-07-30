import { colors, fontSizes, radii, spacing, strokes } from '@friendword/ui-tokens';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { HypeButton, StickerCard } from '../../components';
import { clipIngestLabel } from '../../services/clipIngest';
import { getClipMaxBytes } from '../../services/clipUploadLimits';
import {
  remainingVisualSelection,
  selectPickedVisuals,
  visualPickLimits,
  visualPickMessage,
} from '../../services/pickedVisuals';
import { CLIP_MAX_SOURCE_DURATION_MS, type PitchClip, type PitchPhoto } from '../../services/types';
import { PitchStepFrame } from './PitchStepFrame';

type PhotosStepProps = {
  readonly busy: boolean;
  readonly saveErrorMessage: string | null;
  readonly photos: readonly PitchPhoto[];
  readonly clips: readonly PitchClip[];
  readonly onPhotosChange: (photos: readonly PitchPhoto[]) => void;
  readonly onClipsChange: (clips: readonly PitchClip[]) => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
  /** Injectable so a test can drive the mirror without expo-constants. */
  readonly clipMaxBytes?: number;
};

export function PhotosStep({
  busy,
  saveErrorMessage,
  photos,
  clips,
  onPhotosChange,
  onClipsChange,
  onBack,
  onContinue,
  clipMaxBytes,
}: PhotosStepProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const limits = visualPickLimits(clipMaxBytes ?? getClipMaxBytes());
  const maxClipSeconds = Math.floor(CLIP_MAX_SOURCE_DURATION_MS / 1000);
  const clipAllowanceCopy =
    limits.maxClips === 1 ? 'one short video clip' : `up to ${limits.maxClips} short video clips`;

  const pickVisuals = async (): Promise<void> => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setErrorMessage('Photo access is needed to suggest photos and videos for your friend.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        orderedSelection: true,
        selectionLimit: remainingVisualSelection({ photos, clips }, limits),
        quality: 0.9,
        // Only bounds a video the picker *records*; a library pick of any length
        // still comes back, which is why selectPickedVisuals measures it.
        videoMaxDuration: maxClipSeconds,
        // iPhone libraries hold HEIC, which the server refuses. Compatible mode
        // makes the picker transcode those to JPEG; PNG/WebP screenshots come
        // back untouched and are uploaded under their own type below.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled) {
        return;
      }

      const selection = await selectPickedVisuals(result.assets, { photos, clips }, limits);
      onPhotosChange(selection.photos);
      onClipsChange(selection.clips);
      setErrorMessage(visualPickMessage(selection.rejections, limits));
    } catch (error: unknown) {
      if (error instanceof Error) {
        setErrorMessage('Those files could not be opened. Please try again.');
        return;
      }
      throw error;
    }
  };

  const full = photos.length >= limits.maxPhotos && clips.length >= limits.maxClips;

  return (
    <PitchStepFrame
      track={3}
      title="Pick their best shots"
      subtitle={`Suggest 1–${limits.maxPhotos} photos, plus ${clipAllowanceCopy} of ${maxClipSeconds} seconds or less. Your friend approves, replaces, or removes each one before anything is public.`}
      onBack={onBack}
      footer={
        <HypeButton
          disabled={photos.length === 0 || busy}
          label={busy ? 'Saving…' : 'Lock the photo picks'}
          onPress={onContinue}
        />
      }
    >
      <StickerCard>
        <View style={styles.photoGrid}>
          {photos.map((photo, index) => (
            <View key={photo.uri} style={styles.photoFrame}>
              <Image
                accessibilityLabel={`Suggested photo ${index + 1}`}
                source={{ uri: photo.uri }}
                style={styles.photo}
              />
              <Pressable
                accessibilityLabel={`Remove suggested photo ${index + 1}`}
                accessibilityRole="button"
                onPress={() =>
                  onPhotosChange(photos.filter((candidate) => candidate.uri !== photo.uri))
                }
                style={styles.remove}
              >
                <Text style={styles.removeLabel}>Remove</Text>
              </Pressable>
            </View>
          ))}
        </View>

        {clips.map((clip, index) => (
          <View key={clip.uri} style={styles.clipRow}>
            <Text style={styles.clipTitle}>{`Video ${index + 1}`}</Text>
            <Text style={styles.clipMeta}>
              {`${(clip.durationMillis / 1000).toFixed(1)}s · ${Math.max(1, Math.round(clip.byteSize / 1_048_576))}MB · ${clipIngestLabel(clip.ingest)}`}
            </Text>
            <Pressable
              accessibilityLabel={`Remove suggested video ${index + 1}`}
              accessibilityRole="button"
              onPress={() => onClipsChange(clips.filter((candidate) => candidate.uri !== clip.uri))}
              style={styles.remove}
            >
              <Text style={styles.removeLabel}>Remove</Text>
            </Pressable>
          </View>
        ))}

        {!full ? (
          <HypeButton
            label={
              photos.length === 0 && clips.length === 0
                ? 'Choose photos or videos'
                : 'Add another photo or video'
            }
            onPress={() => {
              void pickVisuals();
            }}
            secondary
          />
        ) : null}

        <Text style={styles.count}>
          {`${photos.length} of ${limits.maxPhotos} photos · ${clips.length} of ${limits.maxClips} video${limits.maxClips === 1 ? '' : 's'}`}
        </Text>
        {clips.length > 0 ? (
          <Text style={styles.count}>
            Videos go through automated safety checks after you send the pitch, and are not
            published until those finish.
          </Text>
        ) : null}
        {errorMessage ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {errorMessage}
          </Text>
        ) : null}
        {saveErrorMessage ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {saveErrorMessage}
          </Text>
        ) : null}
      </StickerCard>
    </PitchStepFrame>
  );
}

const styles = StyleSheet.create({
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photoFrame: {
    width: '48%',
    overflow: 'hidden',
    borderColor: colors.ink,
    borderRadius: radii.sm,
    borderWidth: strokes.sticker,
    backgroundColor: colors.background,
  },
  photo: { width: '100%', aspectRatio: 1, resizeMode: 'cover' },
  clipRow: {
    gap: spacing.xs,
    borderColor: colors.ink,
    borderRadius: radii.sm,
    borderWidth: strokes.sticker,
    backgroundColor: colors.background,
    padding: spacing.sm,
  },
  clipTitle: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.md },
  clipMeta: {
    color: colors.textSecondary,
    fontFamily: 'BricolageGrotesqueSemiBold',
    fontSize: fontSizes.sm,
  },
  remove: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  removeLabel: {
    color: colors.danger,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.sm,
  },
  count: {
    color: colors.textSecondary,
    fontFamily: 'BricolageGrotesqueSemiBold',
    fontSize: fontSizes.sm,
    textAlign: 'center',
  },
  error: {
    color: colors.danger,
    fontFamily: 'BricolageGrotesqueSemiBold',
    fontSize: fontSizes.sm,
  },
});
