import type { PitchSceneAnyVersion, PitchStructure } from '@friendword/contracts';
import type { PublishedPitch } from '@friendword/data';

import type { PitchCaption, PitchFixture, PitchPhoto } from '@/fixtures/pitch';

import { distributePhotoScenes, type SceneWindow } from './scenes';
import {
  asPitchSceneV2,
  sceneV2ReferencesText,
  sceneV2ReferencesWords,
  type SceneWord,
} from './sceneV2';

/**
 * The structure the public page is allowed to print.
 *
 * `hard_claims_requiring_confirmation` is deliberately absent (fifth audit,
 * verdict 4): it is the AI's internal safety flag, it is never rendered, and a
 * claim the Dater disposed of as removed must not survive anywhere in the
 * published page — including the RSC flight payload. Dropping it at the read
 * boundary means no downstream component can leak it back.
 */
export type PublicPitchStructure = Omit<PitchStructure, 'hard_claims_requiring_confirmation'>;

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
  readonly structure: PublicPitchStructure | null;
  /**
   * True when the published `structure` is the one the Dater edited and
   * approved section by section (`consent_revisions.structure_reviewed`,
   * migration 0047, copied onto the published draft by
   * approve_and_publish_pitch). Copy that says the Dater reviewed the words on
   * this page MUST branch on this: rows published before the section editor
   * existed carry sections their Dater never saw, so the unconditional claim
   * was false (fifth audit, verdict 4).
   */
  readonly daterReviewedStructure: boolean;
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
  /**
   * The motion timeline the Dater approved, projected onto the published draft
   * (migration 0048), v1 or v2. The player replays it verbatim — it must not
   * recompute it, or the published page would drift from the preview the Dater
   * said yes to. Null for a fixture and for a legacy row: the player then falls
   * back to the runtime distribution (A4).
   */
  readonly scene: PitchSceneAnyVersion | null;
  /**
   * Transcript words with the reference pairs a v2 `wordPop` carries. Needed by
   * the player, not by the page's own copy: an accent resolves to a word here or
   * it is skipped.
   */
  readonly sceneWords: readonly SceneWord[];
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
  // Not an uploaded asset, so no scene can ever reference it.
  assetId: null,
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

/**
 * Drops `hard_claims_requiring_confirmation` at the read boundary. Written out
 * field by field rather than with a rest spread so a future addition to
 * `PitchStructure` has to be admitted here on purpose before it can reach a
 * rendered page or a client component's props.
 */
function publicStructure(structure: PitchStructure | null): PublicPitchStructure | null {
  if (structure === null) {
    return null;
  }
  return {
    hook: structure.hook,
    relationship_context: structure.relationship_context,
    three_specific_qualities: structure.three_specific_qualities,
    evidence_or_anecdote: structure.evidence_or_anecdote,
    good_match_for: structure.good_match_for,
  };
}

/**
 * The subset of the pitch `PitchPlayer` actually renders.
 *
 * `PitchPlayer` is a `'use client'` component, so whatever it receives is
 * serialized into the RSC flight payload embedded in the page source. Handing
 * it the whole `PitchView` shipped `structure` (hard claims included),
 * `approvedBody` and `transcriptText` into the HTML of every public page — text
 * a Dater may have deliberately removed (fifth audit, verdict 4, reproduced
 * with curl). This projection is the boundary: the player gets what it draws
 * and nothing else.
 */
export type PitchPlayerView = Pick<
  PitchView,
  | 'campaignSlug'
  | 'daterName'
  | 'age'
  | 'approximateLocation'
  | 'introducerPseudonym'
  | 'relationship'
  | 'durationMs'
  | 'photos'
  | 'captions'
  | 'audioUrl'
  | 'scene'
  | 'sceneWords'
> & {
  /**
   * The sentences a v2 text card prints, and only those. Admitted into the
   * projection because the player now DRAWS them (a typographic shot IS a
   * reviewed sentence, animated) — which is the bar this type sets, so it is null
   * whenever the approved scene has no card and no badge. It is the
   * `PublicPitchStructure`, so `hard_claims_requiring_confirmation` was already
   * dropped at the read boundary and cannot ride along here either way.
   */
  readonly sceneText: PublicPitchStructure | null;
};

/** Field-by-field on purpose — see `PitchPlayerView`. Never spread here. */
export function toPitchPlayerView(pitch: PitchView): PitchPlayerView {
  // What the approved scene actually references decides what travels. A page whose
  // scene has no text card ships no sentences to the client component, and one
  // with no word accent ships no words — the projection stays "what it draws".
  const sceneV2 = asPitchSceneV2(pitch.scene);
  return {
    campaignSlug: pitch.campaignSlug,
    daterName: pitch.daterName,
    age: pitch.age,
    approximateLocation: pitch.approximateLocation,
    introducerPseudonym: pitch.introducerPseudonym,
    relationship: pitch.relationship,
    durationMs: pitch.durationMs,
    photos: pitch.photos,
    captions: pitch.captions,
    audioUrl: pitch.audioUrl,
    // Asset ids, integer timings and reference tokens only — no copy lives on a
    // scene, so this cannot carry anything the reader is not shown.
    scene: pitch.scene,
    // Transcript words: the same text the page prints in full and runs as
    // captions, indexed so an approved accent resolves.
    sceneWords: sceneV2 !== null && sceneV2ReferencesWords(sceneV2) ? pitch.sceneWords : [],
    sceneText: sceneV2 !== null && sceneV2ReferencesText(sceneV2) ? pitch.structure : null,
  };
}

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
    structure: publicStructure(fixture.structure),
    // Nobody approved a fixture. The demo copy says so in its own words.
    daterReviewedStructure: false,
    // Demo fixtures never fabricate an age; real seed data provides it or not.
    age: null,
    isDemo: true,
    audioUrl: null,
    // Nobody approved a fixture, so there is no approved scene either.
    scene: null,
    sceneWords: [],
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
  // The per-photo window below is legacy metadata only — the player uses
  // `PitchView.scene` when there is one, and recomputes the distribution itself
  // when there is not. Kept so the fixture and the real read share one shape.
  const scenes = distributePhotoScenes(pitch.photos.length, durationMs, segments);
  return [
    {
      assetId: firstPhoto.assetId,
      src: firstPhoto.url,
      alt: `${pitch.daterDisplayName} — approved photo 1`,
      startMs: scenes[0]?.startMs ?? 0,
      endMs: scenes[0]?.endMs ?? durationMs,
    },
    ...remainingPhotos.map((photo, index) => {
      const photoIndex = index + 1;
      const scene = scenes[photoIndex];
      return {
        assetId: photo.assetId,
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
    structure: publicStructure(pitch.structure),
    daterReviewedStructure: pitch.daterReviewedStructure,
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
    // `?? null` on purpose: a read path that predates the scene column yields
    // undefined, and an undefined prop disappears from the client payload
    // instead of arriving as an explicit "no approved motion".
    scene: pitch.scene ?? null,
    // Reference pair plus the word itself, and no timings: an effect carries its
    // own window, so the player never needs the provider's word clock and the
    // page's HTML does not have to hold it.
    sceneWords: (pitch.transcriptWords ?? []).map((word) => ({
      segmentIndex: word.segmentIndex,
      wordIndex: word.wordIndex,
      text: word.text,
    })),
  };
}
