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
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('../../components', () => ({
  HypeButton: 'button',
  QuietNavAction: 'button',
  TrustCard: 'article',
}));
vi.mock('../../services/draftServiceInstance', () => ({ pitchDraftService: {} }));
vi.mock('../../services/supabaseClient', () => ({ getSupabaseClient: () => null }));
vi.mock('../../services/webOrigin', () => ({
  buildConsentUrl: (token: string) => `https://friendword.example/consent/${token}`,
  getWebOrigin: () => 'https://friendword.example',
}));
vi.mock('../../services/introducedCampaigns', () => ({
  buildIntroducerShareUrl: (slug: string) => `https://friendword.example/p/${slug}`,
}));

import { resolveShareDraft, type ShareDraftUpdate } from '../../../app/pitch/share';
import { EMPTY_PITCH_STRUCTURE, PitchDraftSchema, type PitchDraft } from '../../services/types';

const CONSENT_TOKEN = 'pWnhpdxKfdZx9-XwDwQ23MrZ0e0thzvn';

const RELATIONSHIP = {
  kind: 'Friend',
  duration: '3–10 years',
  friendFirstName: 'Jordan',
} as const;

const SUBMITTED_DRAFT: PitchDraft = PitchDraftSchema.parse({
  id: 'draft-ms5xxk26-r5gyeq',
  status: 'consent_pending',
  contextRole: 'INTRODUCER',
  relationship: { ...RELATIONSHIP, contact: { kind: 'email', value: 'friend@example.com' } },
  photos: [],
  recording: null,
  review: {
    headline: 'Jordan makes ordinary days memorable',
    body: 'Jordan is thoughtful, curious, and always ready with a good story.',
    structure: EMPTY_PITCH_STRUCTURE,
    generationMode: 'generated',
    responseNote: null,
  },
  server: {
    draftId: '10000000-0000-4000-8000-000000000001',
    consentRequestId: '30000000-0000-4000-8000-000000000001',
    consentToken: CONSENT_TOKEN,
    mediaUploaded: true,
  },
  createdAt: '2026-07-29T10:29:49.341Z',
  updatedAt: '2026-07-29T10:33:25.490Z',
});

const PURGED_DRAFT: PitchDraft = PitchDraftSchema.parse({
  ...SUBMITTED_DRAFT,
  relationship: { ...RELATIONSHIP, contact: { kind: 'sent' } },
});

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);
const neverPurge = (): Promise<PitchDraft> => never<PitchDraft>();

describe('share screen draft resolution', () => {
  it('renders the locally held invite and then the purged copy', async () => {
    const purged: string[] = [];
    const updates: ShareDraftUpdate[] = [];

    await resolveShareDraft({
      draftId: SUBMITTED_DRAFT.id,
      listDrafts: async () => [SUBMITTED_DRAFT],
      purgeInvitationContact: async (id) => {
        purged.push(id);
        return PURGED_DRAFT;
      },
      publish: (update) => updates.push(update),
    });

    expect(purged).toEqual([SUBMITTED_DRAFT.id]);
    expect(updates).toEqual([
      { draft: SUBMITTED_DRAFT, loading: false },
      { draft: PURGED_DRAFT, loading: false },
    ]);
  });

  it('stops loading and keeps the invite when the contact purge never settles', async () => {
    const updates: ShareDraftUpdate[] = [];

    await resolveShareDraft({
      draftId: SUBMITTED_DRAFT.id,
      listDrafts: async () => [SUBMITTED_DRAFT],
      purgeInvitationContact: neverPurge,
      publish: (update) => updates.push(update),
      purgeTimeoutMs: 20,
    });

    // The raw contact stays for the next visit to retry, but the introducer can
    // already reach the approval link.
    expect(updates[0]).toEqual({ draft: SUBMITTED_DRAFT, loading: false });
    expect(updates.every((update) => !update.loading)).toBe(true);
    expect(updates.at(-1)?.draft?.server?.consentToken).toBe(CONSENT_TOKEN);
  });

  it('stops loading and keeps the invite when the contact purge fails', async () => {
    const updates: ShareDraftUpdate[] = [];

    await resolveShareDraft({
      draftId: SUBMITTED_DRAFT.id,
      listDrafts: async () => [SUBMITTED_DRAFT],
      purgeInvitationContact: async () => {
        throw new Error('Saved pitch drafts could not be read.');
      },
      publish: (update) => updates.push(update),
    });

    expect(updates).toEqual([{ draft: SUBMITTED_DRAFT, loading: false }]);
  });

  it('stops loading when the draft list never settles', async () => {
    const updates: ShareDraftUpdate[] = [];

    await resolveShareDraft({
      draftId: SUBMITTED_DRAFT.id,
      listDrafts: never,
      purgeInvitationContact: neverPurge,
      publish: (update) => updates.push(update),
      loadTimeoutMs: 20,
    });

    expect(updates).toEqual([{ draft: null, loading: false }]);
  });

  it('stops loading when the draft list fails', async () => {
    const updates: ShareDraftUpdate[] = [];

    await resolveShareDraft({
      draftId: SUBMITTED_DRAFT.id,
      listDrafts: async () => {
        throw new Error('Saved pitch drafts could not be read.');
      },
      purgeInvitationContact: neverPurge,
      publish: (update) => updates.push(update),
    });

    expect(updates).toEqual([{ draft: null, loading: false }]);
  });

  it('skips the purge once the contact has already been handed over', async () => {
    const updates: ShareDraftUpdate[] = [];
    const purgeInvitationContact = vi.fn(neverPurge);

    await resolveShareDraft({
      draftId: PURGED_DRAFT.id,
      listDrafts: async () => [PURGED_DRAFT],
      purgeInvitationContact,
      publish: (update) => updates.push(update),
    });

    expect(purgeInvitationContact).not.toHaveBeenCalled();
    expect(updates).toEqual([{ draft: PURGED_DRAFT, loading: false }]);
  });
});
