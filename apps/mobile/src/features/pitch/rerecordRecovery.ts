import type { PitchDraftService } from '../../services/pitchDrafts';
import type {
  PitchClip,
  PitchDraft,
  PitchDraftId,
  PitchPhoto,
  PitchRecording,
  PitchRelationship,
  RelationshipDuration,
  RelationshipKind,
} from '../../services/types';
import { getAiDraftFailureMessage } from './preparePitchReview';

/** The five tracks of the composer at `app/pitch/new.tsx`. */
export type PitchTrack = 1 | 2 | 3 | 4 | 5;

/** The recording track — where a refused take has to be replaced. */
export const RECORDING_TRACK: PitchTrack = 4;

/**
 * Marks a composer entry that follows the server refusing to draft from an
 * inaudible take, so the recording step can say why it is being shown again.
 * A code, never the sentence itself: route params end up in logs and deep
 * links, and the wording belongs to the app.
 */
export const INSUFFICIENT_SPEECH_NOTICE = 'insufficient_speech';

type DiscardService = Pick<PitchDraftService, 'discardStoredRecording'>;

/**
 * T001 follow-up (issue #70): the outcome of dropping the take the server
 * refused. `rerecord` means the local ledger no longer claims a stored voice
 * object, so the recording step can accept a new take; `blocked` means it still
 * does, and sending the introducer to that step would be a worse dead end than
 * the message they get instead.
 */
export type RerecordRecovery =
  { readonly kind: 'rerecord' } | { readonly kind: 'blocked'; readonly message: string };

/**
 * Drops the refused take from this device. The server already deleted the
 * stored object before answering 422, so leaving the local upload record in
 * place would make {@link PitchDraftService.saveRecording} refuse the next take
 * and turn "record it again" into advice nobody can follow.
 */
export async function discardRefusedTake(
  service: DiscardService,
  draftId: PitchDraftId,
): Promise<RerecordRecovery> {
  try {
    await service.discardStoredRecording(draftId);
    return { kind: 'rerecord' };
  } catch (error: unknown) {
    return { kind: 'blocked', message: getAiDraftFailureMessage(error) };
  }
}

/**
 * Where an introducer goes after the refusal when they are not already in the
 * composer. The same draft, at its recording step — not a new pitch, and not
 * the review screen, which cannot prepare a draft with no take.
 */
export function rerecordRoute(draftId: PitchDraftId): {
  readonly pathname: '/pitch/new';
  readonly params: {
    readonly draftId: string;
    readonly track: string;
    readonly notice: string;
  };
} {
  return {
    pathname: '/pitch/new',
    params: {
      draftId,
      track: String(RECORDING_TRACK),
      notice: INSUFFICIENT_SPEECH_NOTICE,
    },
  };
}

/** The one navigation this recovery performs, kept narrow on purpose. */
export type RerecordNavigator = {
  replace(href: ReturnType<typeof rerecordRoute>): void;
};

/**
 * The whole recovery for a screen that is NOT the composer (today: the review
 * screen, which has no recorder): drop the refused take, then hand the
 * introducer to the composer's recording step for the same draft. Navigation
 * happens only after the discard succeeds, so they are never sent to a step
 * that would refuse the new take.
 */
export async function sendBackToRecordAgain(
  service: DiscardService,
  draftId: PitchDraftId,
  router: RerecordNavigator,
): Promise<RerecordRecovery> {
  const recovery = await discardRefusedTake(service, draftId);
  if (recovery.kind === 'rerecord') {
    router.replace(rerecordRoute(draftId));
  }
  return recovery;
}

/** Reads a `track` route param, ignoring anything that is not a real track. */
export function parseRequestedTrack(raw: string | undefined): PitchTrack | null {
  switch (raw) {
    case '1':
      return 1;
    case '2':
      return 2;
    case '3':
      return 3;
    case '4':
      return 4;
    case '5':
      return 5;
    default:
      return null;
  }
}

/**
 * Whether the recording step still owes the introducer the reason it is showing
 * again.
 *
 * Shown until they START a new take, not until they finish one: the moment the
 * recorder is running the notice has done its job, and leaving it up would read
 * as a complaint about the take being recorded right now. A take already in hand
 * means they acted on it, so it goes then too.
 */
export function shouldShowRerecordNotice(
  notice: string | null,
  recording: PitchRecording | null,
  isRecording: boolean,
): boolean {
  return notice !== null && recording === null && !isRecording;
}

/** The composer state a stored draft is reopened with. */
export type ResumedComposerState = {
  readonly track: PitchTrack;
  readonly relationshipKind: RelationshipKind | null;
  readonly relationshipDuration: RelationshipDuration | null;
  readonly friendFirstName: string;
  readonly contactValue: string;
  readonly photos: readonly PitchPhoto[];
  readonly clips: readonly PitchClip[];
  readonly recording: PitchRecording | null;
  readonly savedRelationship: PitchRelationship | null;
};

/**
 * The furthest track a stored draft can actually be shown at. Track 5 reads the
 * saved relationship AND the take, and tracks past 1 read the relationship, so
 * a requested track beyond what the draft holds is capped rather than honoured
 * — rendering a step from state that is not there is what turned the refusal
 * into a blank screen.
 */
export function furthestResumableTrack(draft: PitchDraft): PitchTrack {
  if (draft.relationship === null) {
    return 1;
  }
  return draft.recording === null ? RECORDING_TRACK : 5;
}

export function resumeComposerState(
  draft: PitchDraft,
  requestedTrack: PitchTrack | null,
): ResumedComposerState {
  const furthest = furthestResumableTrack(draft);
  const relationship = draft.relationship;
  return {
    track: requestedTrack === null ? furthest : (Math.min(requestedTrack, furthest) as PitchTrack),
    relationshipKind: relationship?.kind ?? null,
    relationshipDuration: relationship?.duration ?? null,
    friendFirstName: relationship?.friendFirstName ?? '',
    contactValue: relationship?.contact.kind === 'email' ? relationship.contact.value : '',
    photos: draft.photos,
    clips: draft.clips,
    recording: draft.recording,
    // Track 5 renders from this, not from the pickers above, so a resumed draft
    // that never re-saves its relationship still has a complete review step.
    savedRelationship: relationship,
  };
}
