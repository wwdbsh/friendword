import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSession: vi.fn(),
  campaignsSelect: vi.fn(),
  campaignsEq: vi.fn(),
  campaignsIn: vi.fn(),
  campaignsOrder: vi.fn(),
  draftsSelect: vi.fn(),
  draftsIn: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

import { BenefitsRepo } from './benefitsRepo';
import { createBrowserClient } from './client';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const PUBLISHED_ID = '10000000-0000-4000-8000-000000000001';
const PAUSED_ID = '20000000-0000-4000-8000-000000000002';
const EXPIRED_ID = '50000000-0000-4000-8000-000000000005';
const PUBLISHED_DRAFT_ID = '30000000-0000-4000-8000-000000000003';
const PAUSED_DRAFT_ID = '40000000-0000-4000-8000-000000000004';
const EXPIRED_DRAFT_ID = '60000000-0000-4000-8000-000000000006';

describe('BenefitsRepo owned campaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue({
      auth: { getSession: mocks.getSession },
      from: (table: string) =>
        table === 'campaigns' ? { select: mocks.campaignsSelect } : { select: mocks.draftsSelect },
      rpc: mocks.rpc,
    });
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: USER_ID } } },
      error: null,
    });
    mocks.campaignsSelect.mockReturnValue({ eq: mocks.campaignsEq });
    mocks.campaignsEq.mockReturnValue({ in: mocks.campaignsIn });
    mocks.campaignsIn.mockReturnValue({ order: mocks.campaignsOrder });
    mocks.campaignsOrder.mockResolvedValue({
      data: [
        {
          id: PUBLISHED_ID,
          pitch_draft_id: PUBLISHED_DRAFT_ID,
          slug: 'summer-intro',
          status: 'published',
        },
        {
          id: PAUSED_ID,
          pitch_draft_id: PAUSED_DRAFT_ID,
          slug: 'paused-intro',
          status: 'paused',
        },
        {
          id: EXPIRED_ID,
          pitch_draft_id: EXPIRED_DRAFT_ID,
          slug: 'lapsed-intro',
          status: 'expired',
        },
      ],
      error: null,
    });
    mocks.draftsSelect.mockReturnValue({ in: mocks.draftsIn });
    mocks.draftsIn.mockResolvedValue({
      data: [
        { id: PUBLISHED_DRAFT_ID, headline: 'Summer intro' },
        { id: PAUSED_DRAFT_ID, headline: null },
        { id: EXPIRED_DRAFT_ID, headline: 'Lapsed intro' },
      ],
      error: null,
    });
    mocks.rpc.mockImplementation(async (_name: string, args: { target_campaign_id: string }) => ({
      data: [
        args.target_campaign_id === PAUSED_ID
          ? { pass_active: true, pass_expires_at: '2026-08-12T00:00:00Z' }
          : { pass_active: false, pass_expires_at: null },
      ],
      error: null,
    }));
  });

  it('surfaces published, paused, and expired campaigns owned by the dater with pass state', async () => {
    // Expired campaigns are surfaced so the owner can revive them with a paid
    // Campaign Pass (the only revival path — DECISIONS 2026-07-14 point 2).
    // archived stays excluded: the DB refuses to grant a pass to it.
    const repo = new BenefitsRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.listMyOwnedCampaigns()).resolves.toEqual([
      {
        id: PUBLISHED_ID,
        pitchDraftId: PUBLISHED_DRAFT_ID,
        slug: 'summer-intro',
        headline: 'Summer intro',
        status: 'published',
        pass: { active: false, expiresAt: null },
      },
      {
        id: PAUSED_ID,
        pitchDraftId: PAUSED_DRAFT_ID,
        slug: 'paused-intro',
        headline: null,
        status: 'paused',
        pass: { active: true, expiresAt: '2026-08-12T00:00:00Z' },
      },
      {
        id: EXPIRED_ID,
        pitchDraftId: EXPIRED_DRAFT_ID,
        slug: 'lapsed-intro',
        headline: 'Lapsed intro',
        status: 'expired',
        pass: { active: false, expiresAt: null },
      },
    ]);
    expect(mocks.campaignsEq).toHaveBeenCalledWith('owner_user_id', USER_ID);
    expect(mocks.campaignsIn).toHaveBeenCalledWith('status', ['published', 'paused', 'expired']);
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });
});
