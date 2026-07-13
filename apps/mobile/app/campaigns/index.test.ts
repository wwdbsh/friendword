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
vi.mock('../../src/services/supabaseClient', () => ({ getSupabaseClient: () => null }));

import { canGetCampaignPass, getCampaignName } from './index';

describe('Dater-owned Campaign Pass surface', () => {
  it('shows the purchase CTA only for a published campaign without an active pass', () => {
    expect(
      canGetCampaignPass({ status: 'published', pass: { active: false, expiresAt: null } }),
    ).toBe(true);
    expect(
      canGetCampaignPass({ status: 'published', pass: { active: true, expiresAt: null } }),
    ).toBe(false);
    expect(canGetCampaignPass({ status: 'paused', pass: { active: false, expiresAt: null } })).toBe(
      false,
    );
  });

  it('uses the draft headline, then slug, for the campaign name', () => {
    expect(getCampaignName({ headline: '  Summer intro  ', slug: 'summer-intro' })).toBe(
      'Summer intro',
    );
    expect(getCampaignName({ headline: ' ', slug: 'summer-intro' })).toBe('summer-intro');
    expect(getCampaignName({ headline: null, slug: null })).toBe('Untitled campaign');
  });
});
