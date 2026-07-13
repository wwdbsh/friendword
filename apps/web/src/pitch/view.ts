import type { PublishedPitch } from '@friendword/data';

import type { PitchCaption, PitchFixture, PitchPhoto, PitchVouch } from '@/fixtures/pitch';

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

const ABSTRACT_PHOTO: PitchPhoto = {
  src: `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1200">
      <rect width="900" height="1200" fill="#221B15"/>
      <circle cx="735" cy="210" r="270" fill="#FFC63F" opacity=".92"/>
      <circle cx="110" cy="1040" r="310" fill="#FF5B2E" opacity=".88"/>
      <path d="M90 630c70-250 140 210 210-30s140 210 210-20 140 180 300-80" fill="none" stroke="#FF3D8A" stroke-width="38" stroke-linecap="round"/>
    </svg>
  `)}`,
  alt: 'Friendword abstract voice waveform pattern',
  startMs: 0,
  endMs: 60_001,
};

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
  const [firstPhoto, ...remainingPhotos] = pitch.photos;
  if (firstPhoto === undefined) {
    return null;
  }

  const windowMs = 60_000 / pitch.photos.length;
  return [
    {
      src: firstPhoto.url,
      alt: `${pitch.daterDisplayName} — approved photo 1`,
      startMs: 0,
      endMs: pitch.photos.length === 1 ? 60_001 : Math.round(windowMs),
    },
    ...remainingPhotos.map((photo, index) => {
      const photoIndex = index + 1;
      return {
        src: photo.url,
        alt: `${pitch.daterDisplayName} — approved photo ${photoIndex + 1}`,
        startMs: Math.round(photoIndex * windowMs),
        endMs:
          photoIndex === pitch.photos.length - 1 ? 60_001 : Math.round((photoIndex + 1) * windowMs),
      };
    }),
  ];
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
    photos: realPhotos(pitch) ?? [ABSTRACT_PHOTO],
    captions: [{ startMs: 0, endMs: Number.MAX_SAFE_INTEGER, text: captionText }],
    waveform: PLACEHOLDER_WAVEFORM,
    vouches: [],
    audioUrl: pitch.voiceUrl,
  };
}
