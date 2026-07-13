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
