import { describe, expect, it, vi } from 'vitest';

vi.mock('@friendword/data', () => ({
  BenefitsRepo: class {},
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
  spacing: { xs: 1, sm: 1, md: 1, lg: 1, xxl: 1 },
}));
vi.mock('expo-router', () => ({
  useFocusEffect: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('react-native', () => ({
  ScrollView: 'main',
  StyleSheet: { create: (styles: object) => styles },
  Text: 'span',
  View: 'div',
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'section' }));
vi.mock('../../src/components', () => ({
  HypeButton: 'button',
  StickerCard: 'article',
  TrustCard: 'article',
}));
vi.mock('../../src/services/draftServiceInstance', () => ({ pitchDraftService: {} }));
vi.mock('../../src/services/pitchDraftsSupabase', () => ({
  isRecoveredServerDraft: (draft: {
    readonly id: string;
    readonly server: { readonly draftId: string } | null;
  }) => draft.server !== null && draft.id === draft.server.draftId,
}));
vi.mock('../../src/services/supabaseClient', () => ({ getSupabaseClient: () => null }));

import { PitchDraftSchema } from '../../src/services/types';
import {
  canGetCampaignPass,
  getCampaignName,
  getIntroducerDraftName,
  isCampaignRevival,
} from './index';

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
