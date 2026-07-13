import { describe, expect, it } from '../../../../packages/data/node_modules/vitest';

import { purgeInvitationContact } from './draftStorage';
import { MockPitchDraftService, type PitchDraftStorage } from './pitchDrafts';
import { PitchDraftSchema } from './types';

describe('pitch draft contact purge', () => {
  it('removes the raw contact while retaining the friend name and sent state', () => {
    const draft = PitchDraftSchema.parse({
      id: 'draft-private-contact',
      status: 'consent_pending',
      contextRole: 'INTRODUCER',
      relationship: {
        kind: 'Friend',
        duration: '3–10 years',
        friendFirstName: 'Jordan',
        contact: { kind: 'email', value: 'friend@example.com' },
      },
      photos: [],
      recording: null,
      server: {
        draftId: '10000000-0000-4000-8000-000000000001',
        consentRequestId: '30000000-0000-4000-8000-000000000001',
        consentToken: 'a'.repeat(32),
      },
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    });

    const purged = purgeInvitationContact(draft);
    const serialized = JSON.stringify(purged);

    expect(purged.relationship?.friendFirstName).toBe('Jordan');
    expect(purged.relationship?.contact).toEqual({ kind: 'sent' });
    expect(serialized).not.toContain('friend@example.com');
  });

  it('persists the sent state without the raw contact in AsyncStorage', async () => {
    const values = new Map<string, string>();
    const storage: PitchDraftStorage = {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value);
      },
    };
    const service = new MockPitchDraftService(storage);
    const draft = await service.createDraft();
    await service.saveRelationship(draft.id, {
      kind: 'Friend',
      duration: '3–10 years',
      friendFirstName: 'Jordan',
      contact: { kind: 'email', value: 'friend@example.com' },
    });

    await service.purgeInvitationContact(draft.id);

    const serialized = values.get('@friendword/pitch-drafts');
    expect(serialized).toBeDefined();
    expect(serialized).not.toContain('friend@example.com');
    expect(await service.getMyDrafts()).toEqual([
      expect.objectContaining({
        relationship: expect.objectContaining({
          friendFirstName: 'Jordan',
          contact: { kind: 'sent' },
        }),
      }),
    ]);
  });
});
