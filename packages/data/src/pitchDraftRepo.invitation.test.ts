import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserClient } from './client';
import { PitchDraftRepo } from './pitchDraftRepo';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSession: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

describe('PitchDraftRepo consent invitation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue({
      auth: { getSession: mocks.getSession },
      rpc: mocks.rpc,
    });
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: '00000000-0000-0000-0000-000000000001' } } },
      error: null,
    });
    mocks.rpc.mockResolvedValue({
      data: [
        {
          consent_request_id: '30000000-0000-0000-0000-000000000001',
          consent_token: 'a'.repeat(32),
        },
      ],
      error: null,
    });
  });

  it('passes the email invitation to the consent RPC with the brief 10 parameter names', async () => {
    const client = createBrowserClient('https://project.example', 'anon-key');
    const repo = new PitchDraftRepo(client);

    await repo.submitForConsent('10000000-0000-0000-0000-000000000001', {
      channel: 'email',
      contact: '  friend@example.com  ',
      friendName: '  Jordan  ',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('submit_pitch_for_consent', {
      draft_id: '10000000-0000-0000-0000-000000000001',
      invite_channel: 'email',
      invite_contact: 'friend@example.com',
      invite_friend_name: 'Jordan',
    });
  });
});
