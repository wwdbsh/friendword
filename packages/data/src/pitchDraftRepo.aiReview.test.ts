import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserClient } from './client';
import { PitchDraftRepo } from './pitchDraftRepo';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSession: vi.fn(),
  rpc: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

describe('PitchDraftRepo AI review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue({
      auth: { getSession: mocks.getSession },
      from: vi.fn(() => ({ update: mocks.update })),
      rpc: mocks.rpc,
    });
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: '00000000-0000-0000-0000-000000000001' } } },
      error: null,
    });
    mocks.update.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ single: mocks.single });
    mocks.single.mockResolvedValue({
      data: {
        id: '10000000-0000-0000-0000-000000000001',
        headline: 'Jordan brings the room to life',
      },
      error: null,
    });
  });

  it('writes the reviewed headline, body, and full structure before finalize', async () => {
    const repo = new PitchDraftRepo(createBrowserClient('https://project.example', 'anon-key'));
    const structure = {
      hook: 'Jordan brings the room to life',
      relationship_context: 'We met at work.',
      three_specific_qualities: ['Kind', 'Curious', 'Dependable'],
      evidence_or_anecdote: 'Jordan always checks in.',
      good_match_for: 'Someone thoughtful',
      hard_claims_requiring_confirmation: ['Owns a home'],
    };

    await repo.updateDraft('10000000-0000-0000-0000-000000000001', {
      headline: structure.hook,
      body: 'A thoughtful friend with a great story.',
      structure,
    });

    expect(mocks.update).toHaveBeenCalledWith({
      headline: structure.hook,
      body: 'A thoughtful friend with a great story.',
      structure,
    });
  });

  it('rejects an unauthenticated review update before touching the draft', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const repo = new PitchDraftRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(
      repo.updateDraft('10000000-0000-0000-0000-000000000001', { headline: 'Updated' }),
    ).rejects.toMatchObject({ name: 'UnauthenticatedError' });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('accepts the nullable token returned by a changes-requested re-finalize', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          consent_request_id: '30000000-0000-0000-0000-000000000001',
          consent_token: null,
        },
      ],
      error: null,
    });
    const repo = new PitchDraftRepo(createBrowserClient('https://project.example', 'anon-key'));

    const result = await repo.submitForConsent('10000000-0000-0000-0000-000000000001');

    expect(result).toEqual({
      consentRequestId: '30000000-0000-0000-0000-000000000001',
      consentToken: null,
    });
  });
});
