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
  canDeleteDraft,
  canGetCampaignPass,
  formatDraftMedia,
  countWaitingInterests,
  formatWaitingInterests,
  getCampaignName,
  getIntroducerDraftName,
  getIntroducedShareActions,
  introducerDraftAction,
  isCampaignRevival,
  DRAFT_DELETION_FACTS,
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

describe('Deleting a pitch the introducer started (T010, Issue #47)', () => {
  it('offers the delete on every unpublished status, and never on a live one', () => {
    // 'consent_pending' is the one that matters most: the invite nobody
    // answered is the dead draft ACC-5 is about, and an "only finished drafts"
    // rule would leave it stuck forever. 'published' is excluded because the
    // pitch is the dater's page by then — 0059 refuses it server-side, and
    // showing a button that always fails would be worse than showing none.
    for (const status of [
      'draft',
      'consent_pending',
      'changes_requested',
      'approved',
      'paused',
      'expired',
      'archived',
      'deleted',
    ] as const) {
      expect(canDeleteDraft({ status })).toBe(true);
    }
    expect(canDeleteDraft({ status: 'published' })).toBe(false);
  });

  it('states the safety records that survive rather than promising a clean sweep', () => {
    // §12: the confirmation must not read as "everything about this is erased".
    // The two halves are different facts and docs/PRIVACY_DATA_MAP.md keeps
    // them apart, so the copy has to as well: `reports` are untouched by this
    // path, while a `video_moderation_reviews` row DOES go with the draft and
    // what survives is the ops trace of its deletion (0051, which stays silent
    // only for `friendword.erasure`). Claiming the review itself is "kept"
    // would be the one sentence here that is false.
    const facts = DRAFT_DELETION_FACTS.join(' ');
    expect(facts).toContain('Safety reports are kept');
    expect(facts).toContain('deleting it is recorded for our moderation team');
    expect(facts).not.toMatch(/moderation records are kept/i);
    expect(facts).toContain('This cannot be undone.');
    // No time is promised for the stored copies (docs/OPS.md: daily is a floor,
    // not an SLA).
    expect(facts).toContain('we will not promise you a time for it');
    expect(facts).not.toMatch(/\b(24 hours|immediately|instantly|within)\b/i);
  });
});

// T001 follow-up (issue #70). "Pitches I'm making" gated every CTA on the draft
// having reached the server and always opened /pitch/review, so an unsent pitch
// could end up with no way back into it at all.
describe('the way back into an unsent pitch', () => {
  const baseDraft = {
    id: '10000000-0000-4000-8000-000000000009',
    status: 'draft',
    contextRole: 'INTRODUCER',
    relationship: {
      kind: 'Friend',
      duration: '1–3 years',
      friendFirstName: 'Dahee',
      contact: { kind: 'email', value: 'dahee@example.com' },
    },
    photos: [],
    recording: { uri: 'file:///take.m4a', durationMillis: 36_000, caption: '' },
    server: {
      draftId: '20000000-0000-4000-8000-000000000009',
      consentRequestId: null,
      consentToken: null,
    },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  it('opens a draft that never reached the server in the composer', () => {
    // This card used to carry no button whatsoever, which is how a local draft
    // became unreachable after a failed submit.
    const localOnly = PitchDraftSchema.parse({ ...baseDraft, server: null });

    expect(introducerDraftAction(localOnly)).toEqual({
      label: 'Continue editing',
      pathname: '/pitch/new',
      params: { draftId: localOnly.id, track: '4' },
    });
  });

  it('sends a draft whose refused take was dropped to the recording step', () => {
    // /pitch/review cannot prepare a draft with no voice track, so pointing the
    // only CTA at it left the pitch unfinishable.
    const discarded = PitchDraftSchema.parse({ ...baseDraft, recording: null });

    expect(introducerDraftAction(discarded)).toEqual({
      label: 'Continue editing',
      pathname: '/pitch/new',
      params: { draftId: discarded.id, track: '4' },
    });
  });

  it('still opens a complete server-backed draft at its review screen', () => {
    const ready = PitchDraftSchema.parse(baseDraft);

    expect(introducerDraftAction(ready)).toEqual({
      label: 'Continue editing',
      pathname: '/pitch/review',
      params: { draftId: ready.id },
    });
    expect(
      introducerDraftAction(PitchDraftSchema.parse({ ...baseDraft, status: 'changes_requested' }))
        ?.label,
    ).toBe('Review requested changes');
  });

  it('does not offer to re-record a draft whose media is on another device', () => {
    // A recovered server draft has no local files; the recording step could not
    // accept a replacement take here.
    const recovered = PitchDraftSchema.parse({
      ...baseDraft,
      id: '20000000-0000-4000-8000-000000000009',
      recording: null,
    });

    expect(introducerDraftAction(recovered)).toEqual({
      label: 'Review server draft',
      pathname: '/pitch/review',
      params: { draftId: recovered.id },
    });
  });

  it('offers nothing for a pitch that is no longer editable', () => {
    expect(
      introducerDraftAction(PitchDraftSchema.parse({ ...baseDraft, status: 'consent_pending' })),
    ).toBeNull();
  });
});

// M-8 (T004, Issue #73). A live pitch with two photos and a 54-second take
// described itself as "0 photos · No voice track": the counts are read off the
// LOCAL draft, and a draft recovered from the account has no local media at all.
describe('the media line under a pitch card', () => {
  const BASE = {
    contextRole: 'INTRODUCER' as const,
    relationship: null,
    photos: [],
    recording: null,
    review: {
      headline: 'Sumin',
      body: '',
      structure: {
        hook: '',
        relationship_context: '',
        three_specific_qualities: ['', '', ''],
        evidence_or_anecdote: '',
        good_match_for: '',
        hard_claims_requiring_confirmation: [],
      },
      generationMode: 'manual' as const,
      responseNote: null,
    },
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
  };
  const SERVER_ID = '10000000-0000-4000-8000-000000000001';

  function draft(overrides: Record<string, unknown>) {
    return PitchDraftSchema.parse({ id: SERVER_ID, status: 'published', ...BASE, ...overrides });
  }

  it('never prints a zero for media this device simply cannot see', () => {
    const recovered = draft({
      server: {
        draftId: SERVER_ID,
        consentRequestId: null,
        consentToken: null,
        mediaUploaded: true,
      },
    });

    const line = formatDraftMedia(recovered);

    expect(line).not.toContain('0 photo');
    expect(line).not.toContain('No voice track');
    expect(line).toContain('Friendword');
  });

  // The "Dahee — Live" card: the photo records survived on this device, the take
  // was discarded locally after it was uploaded. A pitch cannot reach a live
  // status without a voice track, so "No voice track" was a claim about the
  // pitch that the server flatly contradicts.
  it('never says a submitted pitch has no voice track', () => {
    const live = draft({
      photos: [
        { uri: 'file://a.jpg', width: 10, height: 10 },
        { uri: 'file://b.jpg', width: 10, height: 10 },
      ],
      recording: null,
      server: {
        draftId: '30000000-0000-4000-8000-000000000003',
        consentRequestId: null,
        consentToken: null,
        mediaUploaded: true,
      },
    });

    const line = formatDraftMedia(live);

    expect(line).toBe('2 photos · voice saved on Friendword');
    expect(line).not.toContain('No voice track');
  });

  it('says the same for every status past the composer, not just published', () => {
    for (const status of ['consent_pending', 'approved', 'paused', 'expired', 'archived']) {
      const submitted = draft({
        status,
        photos: [{ uri: 'file://a.jpg', width: 10, height: 10 }],
        recording: null,
        server: {
          draftId: '30000000-0000-4000-8000-000000000003',
          consentRequestId: null,
          consentToken: null,
          mediaUploaded: true,
        },
      });

      expect(formatDraftMedia(submitted)).toBe('1 photo · voice saved on Friendword');
    }
  });

  // Still in the composer: this device IS the pitch, so its records are the
  // truth and the missing take is the thing the introducer has to go fix.
  it('keeps the local truth while the pitch is still being composed', () => {
    const composing = draft({
      id: 'local-3',
      status: 'changes_requested',
      photos: [{ uri: 'file://a.jpg', width: 10, height: 10 }],
      recording: null,
      server: {
        draftId: '30000000-0000-4000-8000-000000000003',
        consentRequestId: null,
        consentToken: null,
        mediaUploaded: false,
      },
    });

    expect(formatDraftMedia(composing)).toBe('1 photo · No voice track');
  });

  it('still counts the media a locally held draft actually has', () => {
    const local = draft({
      id: 'local-1',
      status: 'draft',
      photos: [{ uri: 'file://a.jpg', width: 10, height: 10 }],
      recording: { uri: 'file://a.m4a', durationMillis: 54_000, caption: '' },
      server: null,
    });

    expect(formatDraftMedia(local)).toBe('1 photo · 54 sec voice track');
  });

  // An empty pitch that never reached the server has genuinely nothing on it,
  // and saying so is the truth that gets the introducer back to recording.
  it('keeps the honest zero for a pitch that has nothing yet', () => {
    expect(formatDraftMedia(draft({ id: 'local-2', status: 'draft', server: null }))).toBe(
      '0 photos · No voice track',
    );
  });
});
