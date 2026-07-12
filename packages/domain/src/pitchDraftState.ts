export const PITCH_DRAFT_STATUSES = [
  'draft',
  'consent_pending',
  'changes_requested',
  'approved',
  'published',
  'paused',
  'expired',
  'archived',
  'deleted',
] as const;
export type PitchDraftStatus = (typeof PITCH_DRAFT_STATUSES)[number];

/**
 * State machine from FRIENDWORD_HANDOFF.md. Nothing is publicly visible
 * before the dater approves; only the dater may publish/pause/delete.
 * Transitions must also be validated server-side — this map is the single
 * client/server-shared source of allowed edges.
 */
const TRANSITIONS: Record<PitchDraftStatus, readonly PitchDraftStatus[]> = {
  draft: ['consent_pending', 'deleted'],
  consent_pending: ['changes_requested', 'approved', 'deleted'],
  changes_requested: ['consent_pending', 'deleted'],
  approved: ['published', 'deleted'],
  published: ['paused', 'expired', 'archived', 'deleted'],
  paused: ['published', 'expired', 'archived', 'deleted'],
  expired: ['archived', 'deleted'],
  archived: ['deleted'],
  deleted: [],
};

export function canTransitionPitchDraft(from: PitchDraftStatus, to: PitchDraftStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses in which the pitch may be visible outside the campaign members. */
export function isPubliclyVisible(status: PitchDraftStatus): boolean {
  return status === 'published';
}
