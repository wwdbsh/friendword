import { describe, expect, it, vi } from 'vitest';

vi.mock('@friendword/data', () => ({
  BenefitsRepo: class {},
  InterestRepo: class {},
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
  QuietNavAction: 'button',
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
// expo-constants cannot load outside a native runtime; the origin itself is
// proven by src/services/webOrigin.test.ts.
vi.mock('../../services/webOrigin', () => ({
  buildInboxUrl: () => 'https://friendword.example/inbox',
}));
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
  countWaitingInterests,
  formatWaitingInterests,
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

// FUN-2: the "Campaigns about me" card said nothing about people waiting, so a
// dater had no signal that anyone had reached out and no route to the web Inbox
// where accepting happens. The count is aggregated client-side from the
// owner-gated list_campaign_interests RPC — no new migration, no new RPC.
describe('Waiting-interest signal on an owned campaign', () => {
  it('counts only the interests still awaiting a decision', () => {
    expect(
      countWaitingInterests([
        { interestStatus: 'submitted' },
        { interestStatus: 'accepted' },
        { interestStatus: 'submitted' },
        { interestStatus: 'declined' },
      ]),
    ).toBe(2);
    expect(countWaitingInterests([])).toBe(0);
  });

  it('never renders an unreadable count as "nobody waiting"', () => {
    // undefined means the read failed for that campaign; zero is a fact.
    expect(formatWaitingInterests(undefined, 'published')).toBe(
      'Interest in this campaign is answered in your Inbox on the web.',
    );
    expect(formatWaitingInterests(0, 'published')).toBe(
      'Nobody is waiting on your answer right now.',
    );
    expect(formatWaitingInterests(1, 'published')).toBe('1 person is waiting for your answer.');
    expect(formatWaitingInterests(3, 'published')).toBe('3 people are waiting for your answer.');
  });

  // decide_interest (0044) refuses an accept unless the campaign is published
  // and inside its window, so "waiting for your answer" on a paused or ended
  // campaign promised an action the server would reject.
  it('does not promise an answer on a campaign that cannot accept one', () => {
    expect(formatWaitingInterests(2, 'paused')).toBe(
      '2 people are waiting — resume your page in your Inbox on the web to answer them.',
    );
    expect(formatWaitingInterests(1, 'expired')).toBe(
      '1 person is waiting, but this campaign has ended — reviving it is what reopens your answer.',
    );
    for (const status of ['paused', 'expired'] as const) {
      expect(formatWaitingInterests(2, status)).not.toContain('waiting for your answer');
      // Zero and unreadable stay status-independent: neither claims an action.
      expect(formatWaitingInterests(0, status)).toBe('Nobody is waiting on your answer right now.');
      expect(formatWaitingInterests(undefined, status)).toBe(
        'Interest in this campaign is answered in your Inbox on the web.',
      );
    }
  });
});
