import { describe, expect, it, vi } from 'vitest';

vi.mock('@friendword/data', () => ({ PurchasesRepo: class {}, trackEvent: vi.fn() }));
vi.mock('@friendword/ui-tokens', () => ({
  colors: {
    background: '',
    danger: '',
    ink: '',
    pop: '',
    textSecondary: '',
  },
  fonts: { body: '', display: '' },
  fontSizes: { xs: 1, sm: 1, md: 1, lg: 1, xl: 1 },
  radii: { sm: 1 },
  spacing: { xs: 1, sm: 1, md: 1, lg: 1, xxl: 1 },
  strokes: { sticker: 1 },
}));
vi.mock('expo-router', () => ({
  Stack: { Screen: 'screen' },
  useFocusEffect: vi.fn(),
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  ScrollView: 'main',
  Share: { share: vi.fn(), sharedAction: 'sharedAction' },
  StyleSheet: { create: (styles: object) => styles },
  Text: 'span',
  View: 'div',
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'section' }));
vi.mock('../../src/components', () => ({
  HypeButton: 'button',
  QuietNavAction: 'button',
  TrustCard: 'article',
}));
vi.mock('../../src/services/draftServiceInstance', () => ({ pitchDraftService: {} }));
vi.mock('../../src/services/pitchDrafts', () => ({ hasFinalizedConsent: vi.fn() }));
vi.mock('../../src/services/supabaseClient', () => ({ getSupabaseClient: () => null }));
vi.mock('../../src/services/webOrigin', () => ({
  buildConsentUrl: vi.fn(),
  getWebOrigin: () => 'https://friendword.example',
}));

import { getCreatorKitSurface } from './share';

describe('published Creator Kit surface', () => {
  it('maps every benefit state to the safe purchase or re-entry surface', () => {
    expect(getCreatorKitSurface('idle')).toBe('checking');
    expect(getCreatorKitSurface('loading')).toBe('checking');
    expect(getCreatorKitSurface('unavailable')).toBe('purchase');
    expect(getCreatorKitSurface('available')).toBe('open');
    expect(getCreatorKitSurface('error')).toBe('error');
  });
});
