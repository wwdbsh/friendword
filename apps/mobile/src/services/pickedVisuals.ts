import { localFileByteSize, pickedClipMimeType, pickedPhotoMimeType } from './mediaFiles';
import {
  CLIP_MAX_SOURCE_DURATION_MS,
  FREE_PITCH_CLIP_ALLOWANCE,
  MAX_PITCH_CLIPS,
  MAX_PITCH_PHOTOS,
  MAX_PITCH_VISUALS,
  type PitchClip,
  type PitchPhoto,
} from './types';

/**
 * The fields of `ImagePicker.ImagePickerAsset` this model reads. Declared
 * structurally so the selection rules can be tested without the native picker,
 * and so a picker that leaves an optional field unset is a case the model has to
 * handle rather than a type error.
 */
export type PickedVisualAsset = {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
  readonly type?: 'image' | 'video' | 'livePhoto' | 'pairedVideo' | null;
  readonly mimeType?: string | null;
  /** Video length in milliseconds; null/absent for an image or when unreadable. */
  readonly duration?: number | null;
  readonly fileSize?: number | null;
};

/**
 * The client-side mirror of what the server accepts. Every one of these is
 * enforced again server-side (storage quota, clip entitlement, ingest probe);
 * checking here only keeps the introducer from waiting on an upload that is
 * already known to fail.
 */
export type VisualPickLimits = {
  readonly maxPhotos: number;
  readonly maxClips: number;
  readonly maxVisuals: number;
  readonly clipMaxDurationMs: number;
  readonly clipMaxBytes: number;
};

export type VisualPickRejection =
  | 'unsupported_photo'
  | 'unsupported_clip'
  | 'clip_too_long'
  | 'clip_too_large'
  | 'clip_unmeasured'
  | 'photo_limit'
  | 'clip_limit';

export type VisualPickResult = {
  /** The draft's photos after the pick: what it had, plus what was accepted. */
  readonly photos: readonly PitchPhoto[];
  readonly clips: readonly PitchClip[];
  /** Every reason something was left out, first occurrence order, deduplicated. */
  readonly rejections: readonly VisualPickRejection[];
};

/**
 * Limits from the per-kind caps plus a resolved byte ceiling.
 *
 * `clipAllowance` defaults to the free allowance rather than to the absolute
 * ceiling, because that is what the server applies to an ordinary draft: letting
 * the introducer pick three clips and having the second registration refused
 * would cost them an upload and tell them nothing until it failed. A caller that
 * knows this pitch's campaign holds a Campaign Pass may raise it, and it is
 * clamped to the schema ceiling either way.
 */
export function visualPickLimits(
  clipMaxBytes: number,
  clipAllowance: number = FREE_PITCH_CLIP_ALLOWANCE,
): VisualPickLimits {
  return {
    maxPhotos: MAX_PITCH_PHOTOS,
    maxClips: Math.max(0, Math.min(clipAllowance, MAX_PITCH_CLIPS)),
    maxVisuals: MAX_PITCH_VISUALS,
    clipMaxDurationMs: CLIP_MAX_SOURCE_DURATION_MS,
    clipMaxBytes,
  };
}

/**
 * How many items the picker may return, so the system UI stops the introducer at
 * the cap instead of letting them select twelve photos and silently dropping
 * eight. Zero would mean "no limit" to the picker, so it is never returned.
 */
export function remainingVisualSelection(
  current: { readonly photos: readonly unknown[]; readonly clips: readonly unknown[] },
  limits: VisualPickLimits,
): number {
  const remaining = Math.min(
    limits.maxPhotos - current.photos.length + (limits.maxClips - current.clips.length),
    limits.maxVisuals - current.photos.length - current.clips.length,
  );
  return Math.max(remaining, 1);
}

/** Whether the picker handed back an image, a video, or something to skip. */
function classifyPickedAsset(asset: PickedVisualAsset): 'photo' | 'clip' | 'unknown' {
  if (asset.type === 'image' || asset.type === 'livePhoto') {
    return 'photo';
  }
  if (asset.type === 'video') {
    return 'clip';
  }
  // Some Android content providers report no type; the mime type and then the
  // file extension are the fallbacks. `pairedVideo` lands here too and is only
  // produced for live photos, which this app does not request.
  const declared = typeof asset.mimeType === 'string' ? asset.mimeType.toLowerCase() : '';
  if (declared.startsWith('image/')) {
    return 'photo';
  }
  if (declared.startsWith('video/')) {
    return 'clip';
  }
  if (pickedPhotoMimeType(asset) !== null) {
    return 'photo';
  }
  return pickedClipMimeType(asset) !== null ? 'clip' : 'unknown';
}

/**
 * Turns one picker result into the draft's next photos and clips.
 *
 * Ordering matters: assets are taken in the order the picker returned them (the
 * introducer's selection order), and the first ones that fit are kept, so the
 * caps drop the *last* picks rather than an arbitrary subset.
 *
 * A clip has to be measurable to be accepted. `duration` is what the 15s cap is
 * checked against and `videoMaxDuration` does not bound a library pick, so a
 * video whose length the picker did not report is refused rather than uploaded
 * on the hope that the server's probe agrees. Its byte size may come from the
 * picker or from the local file; when neither can supply one, the same rule
 * applies.
 *
 * Nothing here decides what is publishable or what is allowed: the ingest probe
 * re-reads the real bytes, and the clip count is enforced twice server-side (the
 * entitlement, then the absolute ceiling of three) when the upload is registered.
 * `maxClips` mirrors the allowance so the introducer hears about it before the
 * upload, and is never what grants a clip.
 */
export async function selectPickedVisuals(
  assets: readonly PickedVisualAsset[],
  current: { readonly photos: readonly PitchPhoto[]; readonly clips: readonly PitchClip[] },
  limits: VisualPickLimits,
  readByteSize: (uri: string) => Promise<number | null> = localFileByteSize,
): Promise<VisualPickResult> {
  const photos = [...current.photos];
  const clips = [...current.clips];
  const rejections: VisualPickRejection[] = [];
  const reject = (reason: VisualPickRejection): void => {
    if (!rejections.includes(reason)) {
      rejections.push(reason);
    }
  };

  for (const asset of assets) {
    const kind = classifyPickedAsset(asset);
    const atTotalCap = photos.length + clips.length >= limits.maxVisuals;
    if (kind === 'photo') {
      const mimeType = pickedPhotoMimeType(asset);
      if (mimeType === null) {
        reject('unsupported_photo');
        continue;
      }
      if (photos.length >= limits.maxPhotos || atTotalCap) {
        reject('photo_limit');
        continue;
      }
      photos.push({ uri: asset.uri, width: asset.width, height: asset.height, mimeType });
      continue;
    }
    if (kind === 'clip') {
      const mimeType = pickedClipMimeType(asset);
      if (mimeType === null) {
        reject('unsupported_clip');
        continue;
      }
      if (clips.length >= limits.maxClips || atTotalCap) {
        reject('clip_limit');
        continue;
      }
      const durationMillis =
        typeof asset.duration === 'number' && Number.isFinite(asset.duration)
          ? Math.round(asset.duration)
          : null;
      if (durationMillis === null || durationMillis <= 0) {
        reject('clip_unmeasured');
        continue;
      }
      if (durationMillis > limits.clipMaxDurationMs) {
        reject('clip_too_long');
        continue;
      }
      const declaredSize =
        typeof asset.fileSize === 'number' && Number.isFinite(asset.fileSize) && asset.fileSize > 0
          ? Math.round(asset.fileSize)
          : null;
      const byteSize = declaredSize ?? (await readByteSize(asset.uri));
      if (byteSize === null || byteSize <= 0) {
        reject('clip_unmeasured');
        continue;
      }
      if (byteSize > limits.clipMaxBytes) {
        reject('clip_too_large');
        continue;
      }
      clips.push({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        durationMillis,
        byteSize,
        mimeType,
      });
      continue;
    }
    reject('unsupported_photo');
  }

  return { photos, clips, rejections };
}

/**
 * One honest sentence for what the picker left out, or null when everything was
 * taken. Each message names the file the introducer picked and what to do about
 * it — a generic "some items could not be added" leaves them re-picking blind.
 */
export function visualPickMessage(
  rejections: readonly VisualPickRejection[],
  limits: VisualPickLimits,
): string | null {
  const [first] = rejections;
  if (first === undefined) {
    return null;
  }
  switch (first) {
    case 'unsupported_photo':
      return 'Friendword can publish JPEG, PNG, and WebP photos only. Pick a different one.';
    case 'unsupported_clip':
      return 'Friendword can publish MP4 and MOV videos only. Pick a different one.';
    case 'clip_too_long':
      return `Videos have to be ${Math.floor(limits.clipMaxDurationMs / 1000)} seconds or shorter. Trim it and pick it again.`;
    case 'clip_too_large':
      return `That video is over ${Math.floor(limits.clipMaxBytes / 1_048_576)}MB. Trim it or export it smaller, then pick it again.`;
    case 'clip_unmeasured':
      return 'Friendword could not read that video’s length or size, so it was not added. Trim it to a short clip and pick it again.';
    case 'photo_limit':
      return `You can suggest up to ${limits.maxPhotos} photos, so the extra picks were left out.`;
    case 'clip_limit':
      return limits.maxClips <= FREE_PITCH_CLIP_ALLOWANCE
        ? `Friendword includes ${limits.maxClips === 1 ? 'one video' : `${limits.maxClips} videos`} per pitch; more than that needs a Campaign Pass. The extra picks were left out.`
        : `You can add up to ${limits.maxClips} videos, so the extra picks were left out.`;
    default:
      return null;
  }
}
