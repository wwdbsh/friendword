import { describe, expect, it, vi } from 'vitest';

vi.mock('@friendword/data', () => ({
  BenefitsRepo: class {},
  trackEvent: vi.fn(),
  UnauthenticatedError: class extends Error {},
}));
vi.mock('@friendword/ui-tokens', () => ({
  colors: {
    background: '',
    danger: '',
    fresh: '',
    hype: '',
    ink: '',
    onHype: '',
    surface: '',
    textSecondary: '',
  },
  fonts: { body: '', display: '' },
  fontSizes: { xs: 1, sm: 1, md: 1, lg: 1, xl: 1 },
  radii: { sm: 1 },
  spacing: { xs: 1, sm: 1, md: 1, lg: 1, xxl: 1 },
  strokes: { sticker: 1 },
}));
vi.mock('expo-router', () => ({
  useFocusEffect: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  ScrollView: 'main',
  Share: { share: vi.fn(), sharedAction: 'sharedAction' },
  StyleSheet: { create: (styles: object) => styles },
  Text: 'span',
  View: 'div',
}));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'section' }));
vi.mock('../../components', () => ({
  HypeButton: 'button',
  SignInPromptCard: 'article',
  StickerCard: 'article',
  TrustCard: 'article',
}));
// CampaignsScreen mounts the sign-in sheet; this suite only exercises the
// module's pure helpers, so stub the sheet to avoid loading its deps.
vi.mock('../../features/auth/SignInSheet', () => ({ SignInSheet: () => null }));
vi.mock('../../services/draftServiceInstance', () => ({ pitchDraftService: {} }));
vi.mock('../../services/pitchDraftsSupabase', () => ({
  isRecoveredServerDraft: (draft: {
    readonly id: string;
    readonly server: { readonly draftId: string } | null;
  }) => draft.server !== null && draft.id === draft.server.draftId,
}));
vi.mock('../../services/supabaseClient', () => ({ getSupabaseClient: () => null }));
vi.mock('../../services/introducedCampaigns', () => ({
  buildIntroducerShareUrl: (slug: string) =>
    `https://friendword.example/p/${slug}?src=introducer-share&ref=${slug}`,
  canShareIntroducedCampaign: (campaign: { status: string; slug: string | null }) =>
    campaign.status === 'published' && campaign.slug !== null,
  formatIntroducedCampaignStatus: (status: string) => status,
  getIntroducerLiveHeadline: (name: string | null) => `${name ?? 'Your friend'} live`,
  listMyIntroducedCampaigns: vi.fn(),
}));

import { PitchDraftSchema } from '../../services/types';
import {
  canGetCampaignPass,
  getCampaignName,
  getIntroducerDraftName,
  getIntroducedShareActions,
  isCampaignRevival,
} from '../../../app/campaigns/index';

describe('Dater-owned Campaign Pass surface', () => {
  it('offers the pass for a live campaign or an expired campaign the owner can revive', () => {
    // Published campaigns extend; expired campaigns revive — a paid Campaign
    // Pass is the only revival path (DECISIONS 2026-07-14 point 2). An active
    // pass, a paused (voluntary hold), or an archived campaign show no CTA.
    expect(
      canGetCampaignPass({ status: 'published', pass: { active: false, expiresAt: null } }),
    ).toBe(true);
    expect(
      canGetCampaignPass({ status: 'expired', pass: { active: false, expiresAt: null } }),
    ).toBe(true);
    expect(
      canGetCampaignPass({ status: 'published', pass: { active: true, expiresAt: null } }),
    ).toBe(false);
    expect(canGetCampaignPass({ status: 'paused', pass: { active: false, expiresAt: null } })).toBe(
      false,
    );
    expect(
      canGetCampaignPass({ status: 'archived', pass: { active: false, expiresAt: null } }),
    ).toBe(false);
  });

  it('marks only expired campaigns as a revival so the paywall can be honest', () => {
    expect(isCampaignRevival('expired')).toBe(true);
    expect(isCampaignRevival('published')).toBe(false);
    expect(isCampaignRevival('paused')).toBe(false);
  });

  it('uses the draft headline, then slug, for the campaign name', () => {
    expect(getCampaignName({ headline: '  Summer intro  ', slug: 'summer-intro' })).toBe(
      'Summer intro',
    );
    expect(getCampaignName({ headline: ' ', slug: 'summer-intro' })).toBe('summer-intro');
    expect(getCampaignName({ headline: null, slug: null })).toBe('Untitled campaign');
  });

  it('uses recovered server copy when local friend context is unavailable', () => {
    const draft = PitchDraftSchema.parse({
      id: '10000000-0000-4000-8000-000000000001',
      status: 'draft',
      contextRole: 'INTRODUCER',
      relationship: null,
      photos: [],
      recording: null,
      review: {
        headline: 'A server-saved introduction',
        body: 'Saved copy',
        structure: {
          hook: '',
          relationship_context: '',
          three_specific_qualities: ['', '', ''],
          evidence_or_anecdote: '',
          good_match_for: '',
          hard_claims_requiring_confirmation: [],
        },
        generationMode: 'manual',
        responseNote: null,
      },
      server: {
        draftId: '10000000-0000-4000-8000-000000000001',
        consentRequestId: null,
        consentToken: null,
      },
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    });

    expect(getIntroducerDraftName(draft)).toBe('A server-saved introduction');
  });
});

describe('Introducer live-campaign share surface', () => {
  it('exposes the free public URL with attribution and all three actions when live', () => {
    const actions = getIntroducedShareActions({
      status: 'published',
      slug: 'blair-and-friends',
    });
    expect(actions).toEqual({
      canShare: true,
      shareUrl:
        'https://friendword.example/p/blair-and-friends?src=introducer-share&ref=blair-and-friends',
    });
  });

  it('offers no share CTA and no URL when the slug is withheld or the status is not live', () => {
    // Slug NULL is the server's link-leak guard for non-public campaigns.
    expect(getIntroducedShareActions({ status: 'published', slug: null })).toEqual({
      canShare: false,
      shareUrl: null,
    });
    expect(getIntroducedShareActions({ status: 'paused', slug: 'blair-and-friends' })).toEqual({
      canShare: false,
      shareUrl: null,
    });
    expect(getIntroducedShareActions({ status: 'expired', slug: null })).toEqual({
      canShare: false,
      shareUrl: null,
    });
  });
});
