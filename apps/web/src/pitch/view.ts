import type { PitchStructure } from '@friendword/contracts';
import type { PublishedPitch } from '@friendword/data';

import type { PitchCaption, PitchFixture, PitchPhoto } from '@/fixtures/pitch';

import { distributePhotoScenes, type SceneWindow } from './scenes';

export type PitchView = {
  readonly campaignSlug: string;
  readonly daterName: string;
  /** Dater-approved structured body, rendered below the player (CP-2). */
  readonly approvedBody: string | null;
  /** Full transcript text for the accessible transcript section (CP-2). */
  readonly transcriptText: string | null;
  /**
   * Structured breakdown of the pitch (CP-2). When present the page renders
   * hook / qualities / anecdote / good-match scenes instead of one generic
   * body blob. Null when the published draft carries no structure snapshot.
   */
  readonly structure: PitchStructure | null;
  /**
   * Dater's age in whole years, surfaced ONLY from the server-derived
   * `PublishedPitch.age` (a value the dater confirmed at consent). Null → the
   * header shows the name alone. The demo fixture carries no age, so a seeded
   * demo shows one only when real data actually provides it (GP-P0-3).
   */
  readonly age: number | null;
  readonly approximateLocation: string | null;
  readonly introducerPseudonym: string;
  readonly relationship: string;
  readonly durationMs: number;
  readonly description: string;
  /** True for seeded demo data so the UI can label it honestly (GP-P0-3). */
  readonly isDemo: boolean;
  readonly photos: readonly [PitchPhoto, ...PitchPhoto[]];
  /**
   * Segment-level captions carrying the provider's REAL timestamps (CP-2).
   * Empty when the recording has no transcript segments — the player then
   * shows the written body statically instead of a fabricated timeline.
   */
  readonly captions: readonly PitchCaption[];
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
  endMs: 1,
};

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
  return {
    ...fixture,
    approvedBody: null,
    transcriptText: null,
    structure: fixture.structure,
    // Demo fixtures never fabricate an age; real seed data provides it or not.
    age: null,
    isDemo: true,
    audioUrl: null,
  };
}

/** Segment windows (ms) derived from the provider's real segment timestamps. */
function segmentWindows(pitch: PublishedPitch): readonly SceneWindow[] {
  return (pitch.transcript?.segments ?? []).map((segment) => ({
    startMs: Math.max(0, Math.round(segment.start * 1000)),
    endMs: Math.max(1, Math.round(segment.end * 1000)),
  }));
}

function realPhotos(
  pitch: PublishedPitch,
  durationMs: number,
  segments: readonly SceneWindow[],
): readonly [PitchPhoto, ...PitchPhoto[]] | null {
  const [firstPhoto, ...remainingPhotos] = pitch.photos;
  if (firstPhoto === undefined) {
    return null;
  }
  // CP-2: distribute scenes across the REAL duration, snapping to real segment
  // boundaries when available — never a hardcoded 60s grid.
  const scenes = distributePhotoScenes(pitch.photos.length, durationMs, segments);
  return [
    {
      src: firstPhoto.url,
      alt: `${pitch.daterDisplayName} — approved photo 1`,
      startMs: scenes[0]?.startMs ?? 0,
      endMs: scenes[0]?.endMs ?? durationMs,
    },
    ...remainingPhotos.map((photo, index) => {
      const photoIndex = index + 1;
      const scene = scenes[photoIndex];
      return {
        src: photo.url,
        alt: `${pitch.daterDisplayName} — approved photo ${photoIndex + 1}`,
        startMs: scene?.startMs ?? 0,
        endMs: scene?.endMs ?? durationMs,
      };
    }),
  ];
}

function realCaptions(
  segments: readonly SceneWindow[],
  pitch: PublishedPitch,
): readonly PitchCaption[] {
  const source = pitch.transcript?.segments ?? [];
  // CP-2: captions carry the provider's real segment timestamps. When there
  // are no segments we return an EMPTY list — no fabricated timestamp.
  return source.map((segment, index) => ({
    startMs: segments[index]?.startMs ?? 0,
    endMs: segments[index]?.endMs ?? 1,
    text: segment.text,
  }));
}

export function fromPublishedPitch(pitch: PublishedPitch): PitchView {
  const segments = segmentWindows(pitch);
  const lastSegmentEnd = segments.at(-1)?.endMs ?? 0;
  // Real duration comes from the last segment; the <audio> element corrects it
  // to the exact media duration once metadata loads. 0 when unknown.
  const durationMs = lastSegmentEnd;

  return {
    campaignSlug: pitch.campaignSlug,
    daterName: pitch.daterDisplayName,
    approvedBody: pitch.body,
    transcriptText: pitch.transcript?.text ?? null,
    structure: pitch.structure,
    // CP-1/GP-P0-3: surface the dater-confirmed age (server-derived), null-safe.
    age: pitch.age,
    approximateLocation: pitch.approximateLocation,
    introducerPseudonym: pitch.introducerDisplayName,
    relationship: relationshipLabel(pitch),
    durationMs,
    description: `Meet ${pitch.daterDisplayName} through ${pitch.introducerDisplayName}'s original voice pitch, shared with ${pitch.daterDisplayName}'s approval.`,
    isDemo: false,
    photos: realPhotos(pitch, durationMs, segments) ?? [ABSTRACT_PHOTO],
    captions: realCaptions(segments, pitch),
    audioUrl: pitch.voiceUrl,
  };
}
