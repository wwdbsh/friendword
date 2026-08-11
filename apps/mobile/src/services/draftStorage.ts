import type { PitchDraftStatus } from '@friendword/domain';

import { PitchDraftSchema, type PitchDraft } from './types';

export function purgeInvitationContact(draft: PitchDraft): PitchDraft {
  if (draft.relationship === null || draft.relationship.contact.kind === 'sent') {
    return draft;
  }

  return PitchDraftSchema.parse({
    ...draft,
    relationship: {
      ...draft.relationship,
      contact: { kind: 'sent' },
    },
  });
}

/**
 * True once the current consent request tied to this draft's token is
 * concluded, so the raw bearer token no longer needs to open the dater's
 * approval flow. `consent_pending` (awaiting a response) and
 * `changes_requested` (the introducer re-submits over the *same* private link)
 * deliberately keep the token; every post-approval state drops it.
 */
export function isConsentConcludedStatus(status: PitchDraftStatus): boolean {
  switch (status) {
    case 'approved':
    case 'published':
    case 'paused':
    case 'expired':
    case 'archived':
    case 'deleted':
      return true;
    case 'draft':
    case 'consent_pending':
    case 'changes_requested':
      return false;
    default:
      return false;
  }
}

/** Drops the raw consent bearer token from a draft, leaving everything else. */
export function purgeConsentToken(draft: PitchDraft): PitchDraft {
  if (draft.server === null || draft.server.consentToken === null) {
    return draft;
  }
  return PitchDraftSchema.parse({
    ...draft,
    server: { ...draft.server, consentToken: null },
  });
}

/**
 * Local media URIs that a publish purge would remove — only when the bytes are
 * already on the server (`mediaUploaded`), so an unsent draft never loses its
 * only copy.
 */
export function purgeableMediaUris(draft: PitchDraft): readonly string[] {
  if (draft.server === null || !draft.server.mediaUploaded) {
    return [];
  }
  const uris: string[] = [];
  if (draft.recording !== null) {
    uris.push(draft.recording.uri);
  }
  for (const photo of draft.photos) {
    uris.push(photo.uri);
  }
  // Clips go too: the introducer's phone must not keep a copy of a video the
  // server already holds, and the local file is not the source of anything after
  // publish (the render pipeline works from the server-side proxy).
  for (const clip of draft.clips) {
    uris.push(clip.uri);
  }
  return uris;
}

/**
 * Every on-device media file a draft points at, uploaded or not.
 *
 * Unlike {@link purgeableMediaUris} this does not wait for the server to hold a
 * copy: it exists for account deletion, where "the server has it" is no longer
 * a reason to keep the local file — the server copy is being erased too.
 */
export function localMediaUris(draft: PitchDraft): readonly string[] {
  const uris: string[] = [];
  if (draft.recording !== null) {
    uris.push(draft.recording.uri);
  }
  for (const photo of draft.photos) {
    uris.push(photo.uri);
  }
  for (const clip of draft.clips) {
    uris.push(clip.uri);
  }
  return uris;
}

/**
 * Clears the on-device recording/photo/clip copies once the server holds the
 * originals. A no-op until the media has been uploaded.
 */
export function purgeUploadedMedia(draft: PitchDraft): PitchDraft {
  if (draft.server === null || !draft.server.mediaUploaded) {
    return draft;
  }
  if (draft.recording === null && draft.photos.length === 0 && draft.clips.length === 0) {
    return draft;
  }
  return PitchDraftSchema.parse({
    ...draft,
    recording: null,
    photos: [],
    clips: [],
  });
}
