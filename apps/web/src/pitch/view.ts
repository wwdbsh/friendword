import type { PublishedPitch } from '@friendword/data';

import type { PitchCaption, PitchFixture, PitchPhoto, PitchVouch } from '@/fixtures/pitch';

/**
 * What the public pitch page renders — a published campaign mapped for
 * display, or the demo fixture. Real campaigns start without photos,
 * captions, vouches, or a known duration; the audio element supplies timing
 * and the placeholders keep the stage art on-brand until photo upload ships.
 */
export type PitchView = {
  readonly campaignSlug: string;
  readonly daterName: string;
  readonly age: number | null;
  readonly approximateLocation: string | null;
  readonly introducerPseudonym: string;
  readonly relationship: string;
  readonly durationMs: number;
  readonly description: string;
  readonly photos: readonly [PitchPhoto, ...PitchPhoto[]];
  readonly captions: readonly [PitchCaption, ...PitchCaption[]];
  readonly waveform: readonly number[];
  readonly vouches: readonly PitchVouch[];
  /** Signed playback URL; when set the player drives a real audio element. */
  readonly audioUrl: string | null;
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  friend: 'Friends',
  coworker: 'Coworkers',
  family: 'Family',
  roommate: 'Roommates',
  other: 'Close since forever',
};

const DURATION_LABELS: Record<string, string> = {
  lt1y: 'for under a year',
  y1to3: 'for 1–3 years',
  y3to10: 'for 3–10 years',
  gt10y: 'for 10+ years',
};

const PLACEHOLDER_PHOTOS: readonly [PitchPhoto, ...PitchPhoto[]] = [
  {
    src: '/fixtures/blair-portrait-1.svg',
    alt: 'Illustrated placeholder portrait in a tangerine jacket',
    startMs: 0,
    endMs: 20_000,
  },
  {
    src: '/fixtures/blair-portrait-2.svg',
    alt: 'Illustrated placeholder portrait holding a record',
    startMs: 20_000,
    endMs: 40_000,
  },
  {
    src: '/fixtures/blair-portrait-3.svg',
    alt: 'Illustrated placeholder portrait on a sunny city walk',
    startMs: 40_000,
    endMs: 60_001,
  },
];

const PLACEHOLDER_WAVEFORM: readonly number[] = [
  38, 56, 74, 49, 66, 90, 61, 42, 76, 95, 70, 51, 84, 59, 34, 67, 92, 78, 46, 72, 88, 54, 40, 81,
  97, 64, 48, 75, 91, 57, 37, 69, 85, 62, 43, 79, 94, 68, 50, 86, 60, 36, 73, 89, 65, 47, 82, 93,
];

export function relationshipLabel(pitch: PublishedPitch): string {
  const kind =
    pitch.relationshipType === null
      ? 'Friends'
      : (RELATIONSHIP_LABELS[pitch.relationshipType] ?? 'Friends');
  const duration =
    pitch.relationshipDuration === null
      ? null
      : (DURATION_LABELS[pitch.relationshipDuration] ?? null);

  return duration === null ? kind : `${kind} ${duration}`;
}

export function fromFixture(fixture: PitchFixture): PitchView {
  return { ...fixture, audioUrl: null };
}

function realPhotos(pitch: PublishedPitch): readonly [PitchPhoto, ...PitchPhoto[]] | null {
  if (pitch.photos.length === 0) {
    return null;
  }

  const windowMs = 60_000 / pitch.photos.length;
  const mapped = pitch.photos.map((photo, index) => ({
    src: photo.url,
    alt: `${pitch.daterDisplayName} — approved photo ${index + 1}`,
    startMs: Math.round(index * windowMs),
    endMs: index === pitch.photos.length - 1 ? 60_001 : Math.round((index + 1) * windowMs),
  }));

  return mapped as unknown as readonly [PitchPhoto, ...PitchPhoto[]];
}

export function fromPublishedPitch(pitch: PublishedPitch): PitchView {
  const captionText =
    pitch.headline ??
    `${pitch.introducerDisplayName} says it best — press play and hear it in their own voice.`;

  return {
    campaignSlug: pitch.campaignSlug,
    daterName: pitch.daterDisplayName,
    age: null,
    approximateLocation: null,
    introducerPseudonym: pitch.introducerDisplayName,
    relationship: relationshipLabel(pitch),
    durationMs: 60_000,
    description: `Meet ${pitch.daterDisplayName} through ${pitch.introducerDisplayName}'s original voice pitch, shared with ${pitch.daterDisplayName}'s approval.`,
    photos: realPhotos(pitch) ?? PLACEHOLDER_PHOTOS,
    captions: [{ startMs: 0, endMs: Number.MAX_SAFE_INTEGER, text: captionText }],
    waveform: PLACEHOLDER_WAVEFORM,
    vouches: [],
    audioUrl: pitch.voiceUrl,
  };
}
