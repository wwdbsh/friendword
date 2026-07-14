import { describe, expect, it, vi } from 'vitest';

vi.mock('./webOrigin', () => ({
  getWebOrigin: () => 'https://friendword.example',
}));
vi.mock('./supabaseClient', () => ({ getSupabaseClient: vi.fn(() => null) }));

import {
  buildIntroducerShareUrl,
  canShareIntroducedCampaign,
  formatIntroducedCampaignStatus,
  getIntroducerLiveHeadline,
  mapIntroducedCampaignRow,
} from './introducedCampaigns';

describe('introduced campaign row mapping', () => {
  it('maps a published RPC row (snake_case) to the camelCase view model', () => {
    const campaign = mapIntroducedCampaignRow({
      campaign_id: '20000000-0000-4000-8000-000000000001',
      campaign_slug: 'blair-and-friends',
      campaign_status: 'published',
      published_at: '2026-07-14T00:00:00.000Z',
      ends_at: '2026-08-13T00:00:00.000Z',
      dater_display_name: 'Blair',
    });

    expect(campaign).toEqual({
      campaignId: '20000000-0000-4000-8000-000000000001',
      slug: 'blair-and-friends',
      status: 'published',
      publishedAt: '2026-07-14T00:00:00.000Z',
      endsAt: '2026-08-13T00:00:00.000Z',
      daterDisplayName: 'Blair',
    });
  });

  it('keeps a null slug for a non-shareable status so no link can leak', () => {
    const campaign = mapIntroducedCampaignRow({
      campaign_id: '20000000-0000-4000-8000-000000000002',
      campaign_slug: null,
      campaign_status: 'paused',
      published_at: null,
      ends_at: null,
      dater_display_name: null,
    });

    expect(campaign.slug).toBeNull();
    expect(campaign.status).toBe('paused');
    expect(campaign.daterDisplayName).toBeNull();
  });

  it('rejects an unknown status rather than surfacing a mystery state', () => {
    expect(() =>
      mapIntroducedCampaignRow({
        campaign_id: '20000000-0000-4000-8000-000000000003',
        campaign_slug: null,
        campaign_status: 'draft',
        published_at: null,
        ends_at: null,
        dater_display_name: null,
      }),
    ).toThrow();
  });
});

describe('introducer free share link', () => {
  it('carries introducer attribution (src + ref) on the public URL', () => {
    expect(buildIntroducerShareUrl('blair-and-friends')).toBe(
      'https://friendword.example/p/blair-and-friends?src=introducer-share&ref=blair-and-friends',
    );
  });
});

describe('who can share an introduced campaign', () => {
  it('shares only a published campaign that carries a slug', () => {
    expect(canShareIntroducedCampaign({ status: 'published', slug: 'blair-and-friends' })).toBe(
      true,
    );
    // Slug NULL (link-leak guard) blocks the share CTA even if status says published.
    expect(canShareIntroducedCampaign({ status: 'published', slug: null })).toBe(false);
    expect(canShareIntroducedCampaign({ status: 'paused', slug: 'blair-and-friends' })).toBe(false);
    expect(canShareIntroducedCampaign({ status: 'expired', slug: null })).toBe(false);
    expect(canShareIntroducedCampaign({ status: 'archived', slug: null })).toBe(false);
  });
});

describe('introducer status + confirmation copy', () => {
  it('labels every introduced status honestly', () => {
    expect(formatIntroducedCampaignStatus('published')).toBe('Live');
    expect(formatIntroducedCampaignStatus('paused')).toBe('Paused');
    expect(formatIntroducedCampaignStatus('expired')).toBe('Ended');
    expect(formatIntroducedCampaignStatus('archived')).toBe('Archived');
  });

  it('confirms the live pitch with the dater name, falling back gracefully', () => {
    expect(getIntroducerLiveHeadline('Blair')).toBe("Blair's pitch is live");
    expect(getIntroducerLiveHeadline(null)).toBe('Your friend’s pitch is live');
    expect(getIntroducerLiveHeadline('  ')).toBe('Your friend’s pitch is live');
  });
});
