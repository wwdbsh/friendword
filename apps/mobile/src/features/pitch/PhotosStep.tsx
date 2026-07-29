import { colors, fontSizes, radii, spacing, strokes } from '@friendword/ui-tokens';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { HypeButton, StickerCard } from '../../components';
import { pickedPhotoMimeType } from '../../services/mediaFiles';
import type { PitchPhoto } from '../../services/types';
import { PitchStepFrame } from './PitchStepFrame';

/**
 * Named so the introducer can act on it: the picker hands back formats the
 * server refuses (GIF, BMP, TIFF, AVIF, and any HEIC it could not transcode),
 * and uploading those bytes anyway only fails later with a message about a
 * file they can no longer identify.
 */
const UNSUPPORTED_PHOTO_MESSAGE =
  'Friendword can publish JPEG, PNG, and WebP photos only. Pick a different one.';

type PhotosStepProps = {
  readonly busy: boolean;
  readonly saveErrorMessage: string | null;
  readonly photos: readonly PitchPhoto[];
  readonly onPhotosChange: (photos: readonly PitchPhoto[]) => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
};

export function PhotosStep({
  busy,
  saveErrorMessage,
  photos,
  onPhotosChange,
  onBack,
  onContinue,
}: PhotosStepProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pickPhotos = async (): Promise<void> => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setErrorMessage('Photo access is needed to suggest photos for your friend.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        orderedSelection: true,
        selectionLimit: 4 - photos.length,
        quality: 0.9,
        // iPhone libraries hold HEIC, which the server refuses. Compatible mode
        // makes the picker transcode those to JPEG; PNG/WebP screenshots come
        // back untouched and are uploaded under their own type below.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled) {
        return;
      }

      const selected: PitchPhoto[] = [];
      for (const asset of result.assets) {
        const mimeType = pickedPhotoMimeType(asset);
        if (mimeType === null) {
          continue;
        }
        selected.push({ uri: asset.uri, width: asset.width, height: asset.height, mimeType });
      }
      onPhotosChange([...photos, ...selected].slice(0, 4));
      setErrorMessage(selected.length < result.assets.length ? UNSUPPORTED_PHOTO_MESSAGE : null);
    } catch (error: unknown) {
      if (error instanceof Error) {
        setErrorMessage('Those photos could not be opened. Please try again.');
        return;
      }
      throw error;
    }
  };

  return (
    <PitchStepFrame
      track={3}
      title="Pick their best shots"
      subtitle="Suggest 1–4 photos. Your friend approves, replaces, or removes each one before anything is public."
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

        {photos.length < 4 ? (
          <HypeButton
            label={photos.length === 0 ? 'Choose photos' : 'Add another photo'}
            onPress={() => {
              void pickPhotos();
            }}
            secondary
          />
        ) : null}

        <Text style={styles.count}>{photos.length} of 4 suggested</Text>
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
