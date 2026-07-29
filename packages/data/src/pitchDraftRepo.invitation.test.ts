import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PitchSceneV1 } from '@friendword/contracts';

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

  it('sends the scene the dater will be asked to approve as new_scene', async () => {
    const client = createBrowserClient('https://project.example', 'anon-key');
    const repo = new PitchDraftRepo(client);
    const scene: PitchSceneV1 = {
      schemaVersion: 1,
      canvas: { width: 1080, height: 1920, fps: 30 },
      durationMs: 4_000,
      scenes: [{ assetId: '40000000-0000-0000-0000-000000000001', startMs: 0, endMs: 4_000 }],
    };

    await repo.submitForConsent(
      '10000000-0000-0000-0000-000000000001',
      { channel: 'email', contact: 'friend@example.com', friendName: 'Jordan' },
      scene,
    );

    expect(mocks.rpc).toHaveBeenCalledWith('submit_pitch_for_consent', {
      draft_id: '10000000-0000-0000-0000-000000000001',
      invite_channel: 'email',
      invite_contact: 'friend@example.com',
      invite_friend_name: 'Jordan',
      new_scene: scene,
    });
  });

  it('sends an explicit null scene when this pitch cannot carry one', async () => {
    const client = createBrowserClient('https://project.example', 'anon-key');
    const repo = new PitchDraftRepo(client);

    await repo.submitForConsent('10000000-0000-0000-0000-000000000001', undefined, null);

    expect(mocks.rpc).toHaveBeenCalledWith('submit_pitch_for_consent', {
      draft_id: '10000000-0000-0000-0000-000000000001',
      new_scene: null,
    });
  });

  it('omits new_scene for a caller that never had a scene to send', async () => {
    const client = createBrowserClient('https://project.example', 'anon-key');
    const repo = new PitchDraftRepo(client);

    await repo.submitForConsent('10000000-0000-0000-0000-000000000001');

    expect(mocks.rpc).toHaveBeenCalledWith('submit_pitch_for_consent', {
      draft_id: '10000000-0000-0000-0000-000000000001',
    });
  });
});
