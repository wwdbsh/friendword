import {
  BenefitsRepo,
  trackEvent,
  UnauthenticatedError,
  type OwnedCampaignBenefit,
} from '@friendword/data';
import { colors, fonts, fontSizes, radii, spacing, strokes } from '@friendword/ui-tokens';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  HypeButton,
  QuietNavAction,
  SignInPromptCard,
  StickerCard,
  TrustCard,
} from '../../src/components';
import { SignInSheet } from '../../src/features/auth/SignInSheet';
import { pitchDraftService } from '../../src/services/draftServiceInstance';
import {
  buildIntroducerShareUrl,
  canShareIntroducedCampaign,
  formatIntroducedCampaignStatus,
  getIntroducerLiveHeadline,
  listMyIntroducedCampaigns,
  type IntroducedCampaign,
} from '../../src/services/introducedCampaigns';
import type { DraftSyncState } from '../../src/services/pitchDrafts';
import { isRecoveredServerDraft } from '../../src/services/pitchDraftsSupabase';
import { getSupabaseClient } from '../../src/services/supabaseClient';
import type { PitchDraft } from '../../src/services/types';

type OwnedCampaignLoadState = 'loading' | 'ready' | 'signed_out' | 'error';

// The owned-campaign feed may surface statuses the Pass CTA reasons about even
// before the data layer's row type is widened, so eligibility is checked
// against the full status space rather than only the currently-fetched subset.
type CampaignPassStatus = OwnedCampaignBenefit['status'] | 'expired' | 'archived';

export function canGetCampaignPass(campaign: {
  readonly status: CampaignPassStatus;
  readonly pass: OwnedCampaignBenefit['pass'];
}): boolean {
  if (campaign.pass.active) {
    return false;
  }
  // A live campaign extends its window; an expired campaign is revived — a paid
  // Campaign Pass is the only revival path (DECISIONS 2026-07-14 point 2).
  // `archived` is excluded (the DB refuses to grant to it) and `paused` keeps
  // its voluntary hold and is handled with its own message below.
  return campaign.status === 'published' || campaign.status === 'expired';
}

// An expired campaign purchase is a revival, so the paywall must speak honestly
// about the campaign coming back (and, during the private beta, possibly
// pending) rather than promising live analytics.
export function isCampaignRevival(status: CampaignPassStatus): boolean {
  return status === 'expired';
}

export function getCampaignName(campaign: Pick<OwnedCampaignBenefit, 'headline' | 'slug'>): string {
  const headline = campaign.headline?.trim();
  if (headline !== undefined && headline.length > 0) {
    return headline;
  }
  return campaign.slug ?? 'Untitled campaign';
}

export type IntroducedShareActions = {
  readonly canShare: boolean;
  readonly shareUrl: string | null;
};

// Free sharing is the introducer's default growth action. A live campaign with a
// slug yields the attributed public URL; anything else (paused/expired/archived,
// or a withheld slug) exposes no link and no share CTA — status only.
export function getIntroducedShareActions(campaign: {
  readonly status: IntroducedCampaign['status'];
  readonly slug: string | null;
}): IntroducedShareActions {
  if (!canShareIntroducedCampaign(campaign) || campaign.slug === null) {
    return { canShare: false, shareUrl: null };
  }
  return { canShare: true, shareUrl: buildIntroducerShareUrl(campaign.slug) };
}

type IntroducedLoadState = 'loading' | 'ready' | 'signed_out' | 'error';

export default function CampaignsScreen() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<readonly PitchDraft[]>([]);
  const [draftSync, setDraftSync] = useState<DraftSyncState>('confirmed');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ownedCampaigns, setOwnedCampaigns] = useState<readonly OwnedCampaignBenefit[]>([]);
  const [ownedCampaignState, setOwnedCampaignState] = useState<OwnedCampaignLoadState>('loading');
  const [introduced, setIntroduced] = useState<readonly IntroducedCampaign[]>([]);
  const [introducedState, setIntroducedState] = useState<IntroducedLoadState>('loading');
  const [copiedCampaignId, setCopiedCampaignId] = useState<string | null>(null);
  const [introducerShareError, setIntroducerShareError] = useState<string | null>(null);
  const [signInVisible, setSignInVisible] = useState(false);

  const shareIntroducedPitch = useCallback(
    async (campaign: IntroducedCampaign, shareUrl: string): Promise<void> => {
      setIntroducerShareError(null);
      try {
        const result = await Share.share({
          message: `${getIntroducerLiveHeadline(campaign.daterDisplayName)} — take a look and pass it on: ${shareUrl}`,
        });
        if (result.action === Share.sharedAction) {
          trackEvent(getSupabaseClient(), 'campaign_shared', {
            platform: 'mobile',
            source: 'introducer-share',
          });
        }
      } catch {
        setIntroducerShareError('The share sheet could not open. Please try again.');
      }
    },
    [],
  );

  const copyIntroducedPitch = useCallback(
    async (campaign: IntroducedCampaign, shareUrl: string): Promise<void> => {
      setIntroducerShareError(null);
      try {
        await Clipboard.setStringAsync(shareUrl);
        setCopiedCampaignId(campaign.campaignId);
      } catch {
        setIntroducerShareError('The link could not be copied. Please try again.');
      }
    },
    [],
  );

  const openIntroducedPitch = useCallback(async (shareUrl: string): Promise<void> => {
    setIntroducerShareError(null);
    try {
      await Linking.openURL(shareUrl);
    } catch {
      setIntroducerShareError('The pitch could not open. Please try again.');
    }
  }, []);

  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setOwnedCampaigns([]);
    setOwnedCampaignState('loading');
    setIntroduced([]);
    setIntroducedState('loading');
    setCopiedCampaignId(null);
    setIntroducerShareError(null);
    pitchDraftService
      .listMyDrafts()
      .then((listing) => {
        if (active) {
          setDrafts(listing.drafts);
          setDraftSync(listing.sync);
          setErrorMessage(null);
        }
      })
      // Only a local storage failure reaches here now — a failing server refresh
      // resolves with this device's drafts and an unconfirmed sync state.
      .catch(() => {
        if (active) {
          setDrafts([]);
          setDraftSync('unconfirmed');
          setErrorMessage('Your saved pitches could not be loaded.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    const client = getSupabaseClient();
    if (client === null) {
      setOwnedCampaigns([]);
      setOwnedCampaignState('signed_out');
      setIntroduced([]);
      setIntroducedState('signed_out');
    } else {
      const benefits = new BenefitsRepo(client);
      void benefits
        .listMyOwnedCampaigns()
        .then((campaigns) => {
          if (active) {
            setOwnedCampaigns(campaigns);
            setOwnedCampaignState('ready');
          }
        })
        .catch((error: unknown) => {
          if (!active) {
            return;
          }
          setOwnedCampaigns([]);
          setOwnedCampaignState(error instanceof UnauthenticatedError ? 'signed_out' : 'error');
        });

      void listMyIntroducedCampaigns()
        .then((campaigns) => {
          if (active) {
            setIntroduced(campaigns);
            setIntroducedState('ready');
          }
        })
        .catch(() => {
          if (active) {
            setIntroduced([]);
            setIntroducedState('error');
          }
        });
    }

    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(load);

  // The introduced-campaigns RPC collapses every failure (including "no session")
  // into one generic error, so on its own it can't tell signed-out from a real
  // outage. The owned feed's repo IS session-aware (throws UnauthenticatedError),
  // so when it reports signed_out we treat the introduced error as the same
  // signed-out state — a sign-in prompt, not a scary "could not load" card.
  const introducerSignedOut =
    introducedState === 'signed_out' ||
    (introducedState === 'error' && ownedCampaignState === 'signed_out');

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>CAMPAIGN HOME</Text>
          <Text style={styles.title}>My dating campaigns</Text>
          <Text style={styles.subtitle}>
            Manage campaigns where you are the dater, then revisit pitches you are making for
            friends.
          </Text>
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Campaigns about me</Text>
          <Text style={styles.message}>
            Campaign Pass adds 30 days to a campaign’s live window and unlocks its funnel analytics.
          </Text>
        </View>

        {ownedCampaignState === 'loading' ? (
          <Text style={styles.message}>Loading your campaigns…</Text>
        ) : null}

        {ownedCampaignState === 'signed_out' ? (
          <SignInPromptCard
            title="Sign in to see your campaigns"
            message="Campaign Pass is only shown for published campaigns you own."
            onSignIn={() => setSignInVisible(true)}
          />
        ) : null}

        {ownedCampaignState === 'error' ? (
          <TrustCard tone="danger">
            <Text style={styles.emptyTitle}>Campaigns could not be loaded</Text>
            <Text style={styles.message}>Check your connection and reopen this screen.</Text>
          </TrustCard>
        ) : null}

        {ownedCampaignState === 'ready' && ownedCampaigns.length === 0 ? (
          <TrustCard>
            <Text style={styles.emptyTitle}>No published campaigns yet</Text>
            <Text style={styles.message}>
              When a pitch about you is approved and published, its campaign will appear here.
            </Text>
          </TrustCard>
        ) : null}

        {ownedCampaigns.map((campaign) => (
          <TrustCard key={campaign.id}>
            <View style={styles.draftHeader}>
              <Text style={styles.friendName}>{getCampaignName(campaign)}</Text>
              <View style={styles.quietStatusBadge}>
                <Text style={styles.quietStatus}>{formatCampaignStatus(campaign.status)}</Text>
              </View>
            </View>
            <Text style={styles.meta}>/{campaign.slug ?? 'campaign'}</Text>
            {campaign.pass.active ? (
              <Text style={styles.message}>{formatActivePass(campaign.pass.expiresAt)}</Text>
            ) : campaign.status === 'paused' ? (
              <Text style={styles.message}>
                Resume this campaign before getting a Campaign Pass.
              </Text>
            ) : campaign.status === 'expired' ? (
              <Text style={styles.message}>
                This campaign has ended. A Campaign Pass revives it with 30 days from purchase and
                reopens its funnel analytics.
              </Text>
            ) : (
              <Text style={styles.message}>
                Get 30 more days and access to campaign funnel analytics.
              </Text>
            )}
            {canGetCampaignPass(campaign) ? (
              <HypeButton
                label={
                  isCampaignRevival(campaign.status)
                    ? 'Revive with Campaign Pass'
                    : 'Get Campaign Pass'
                }
                onPress={() =>
                  router.push({
                    pathname: '/paywall',
                    params: {
                      intent: 'campaign_pass',
                      campaignId: campaign.id,
                      // Only the expired→revive path flags the paywall so its
                      // confirmation copy stays honest about the pending revival.
                      ...(isCampaignRevival(campaign.status) ? { revive: 'true' } : {}),
                    },
                  })
                }
                variant="trust"
              />
            ) : null}
          </TrustCard>
        ))}

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Pitches you got live</Text>
          <Text style={styles.message}>
            Campaigns you introduced that are now public. Sharing the live link is free — the
            Creator Kit is only an optional add-on.
          </Text>
        </View>

        {introducedState === 'loading' ? (
          <Text style={styles.message}>Loading your live pitches…</Text>
        ) : null}

        {introducerSignedOut ? (
          <SignInPromptCard
            title="Sign in to see your live pitches"
            message="Your live pitches and their free share links appear here once you sign in."
            onSignIn={() => setSignInVisible(true)}
          />
        ) : null}

        {introducedState === 'error' && !introducerSignedOut ? (
          <StickerCard>
            <Text style={styles.emptyTitle}>Live pitches could not be loaded</Text>
            <Text style={styles.message}>Check your connection and reopen this screen.</Text>
          </StickerCard>
        ) : null}

        {introducedState === 'ready' && introduced.length === 0 ? (
          <StickerCard>
            <Text style={styles.emptyTitle}>No live pitches yet</Text>
            <Text style={styles.message}>
              When a friend approves a pitch you made, it goes public here and you can share it.
            </Text>
          </StickerCard>
        ) : null}

        {introduced.map((campaign) => {
          const { canShare, shareUrl } = getIntroducedShareActions(campaign);
          return (
            <StickerCard key={campaign.campaignId}>
              <View style={styles.draftHeader}>
                <Text style={styles.friendName}>
                  {getIntroducerLiveHeadline(campaign.daterDisplayName)}
                </Text>
                <View style={styles.statusBadge}>
                  <Text style={styles.status}>
                    {formatIntroducedCampaignStatus(campaign.status)}
                  </Text>
                </View>
              </View>
              {canShare && shareUrl !== null ? (
                <>
                  <Text style={styles.message}>
                    Your free public pitch link is live. Share it anywhere to bring people in.
                  </Text>
                  <View style={styles.linkBox}>
                    <Text numberOfLines={2} style={styles.link}>
                      {shareUrl}
                    </Text>
                  </View>
                  <HypeButton
                    label="Share the pitch"
                    onPress={() => {
                      void shareIntroducedPitch(campaign, shareUrl);
                    }}
                  />
                  <HypeButton
                    label={copiedCampaignId === campaign.campaignId ? 'Link copied' : 'Copy link'}
                    onPress={() => {
                      void copyIntroducedPitch(campaign, shareUrl);
                    }}
                    secondary
                  />
                  <QuietNavAction
                    label="View live pitch"
                    onPress={() => {
                      void openIntroducedPitch(shareUrl);
                    }}
                  />
                  {introducerShareError ? (
                    <Text style={styles.error}>{introducerShareError}</Text>
                  ) : null}
                </>
              ) : (
                <Text style={styles.message}>
                  {campaign.status === 'paused'
                    ? 'This campaign is paused, so its public link is off for now.'
                    : campaign.status === 'expired'
                      ? 'This campaign has ended, so its public link is closed.'
                      : campaign.status === 'archived'
                        ? 'This campaign is archived and no longer public.'
                        : 'This campaign’s public link isn’t available right now.'}
                </Text>
              )}
            </StickerCard>
          );
        })}

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Pitches I’m making</Text>
          <Text style={styles.message}>Drafts and approval requests you started for friends.</Text>
        </View>

        {loading ? <Text style={styles.message}>Loading your mixes…</Text> : null}
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        {/* The draft read falls back to this device's copies rather than failing,
            so a broken sync has no other way to become visible. */}
        {!loading && errorMessage === null && draftSync === 'unconfirmed' ? (
          <TrustCard tone="danger">
            <Text style={styles.emptyTitle}>Showing this device’s copies</Text>
            <Text style={styles.message}>
              Friendword could not be reached, so these are the pitches saved on this device. Your
              friends’ latest answers may be missing, and pitches saved to your account that this
              device has never synced are not listed.
            </Text>
            <HypeButton
              label="Try again"
              onPress={() => {
                load();
              }}
              secondary
            />
          </TrustCard>
        ) : null}

        {!loading && errorMessage === null && draftSync === 'signed_out' ? (
          <SignInPromptCard
            title="Sign in to sync your pitches"
            message="These are the pitches saved on this device. Sign in to check your friends’ latest answers and to see pitches saved to your account."
            onSignIn={() => setSignInVisible(true)}
          />
        ) : null}

        {!loading && errorMessage === null && draftSync === 'confirmed' && drafts.length === 0 ? (
          <StickerCard>
            <Text style={styles.emptyTitle}>No mixes on deck yet.</Text>
            <Text style={styles.message}>
              Think of a friend whose story deserves to be told by someone who knows it.
            </Text>
            <HypeButton label="Pitch a friend" onPress={() => router.push('/pitch/new')} />
          </StickerCard>
        ) : null}

        {drafts.map((draft) => (
          <StickerCard key={draft.id}>
            <View style={styles.draftHeader}>
              <Text style={styles.friendName}>{getIntroducerDraftName(draft)}</Text>
              <View style={styles.statusBadge}>
                <Text style={styles.status}>{formatStatus(draft.status)}</Text>
              </View>
            </View>
            <Text style={styles.message}>
              {draft.relationship
                ? `${draft.relationship.kind} · ${draft.relationship.duration}`
                : 'Relationship details still in progress'}
            </Text>
            <Text style={styles.meta}>
              {draft.photos.length} photo{draft.photos.length === 1 ? '' : 's'} ·{' '}
              {draft.recording ? formatDuration(draft.recording.durationMillis) : 'No voice track'}
            </Text>
            {isRecoveredServerDraft(draft) ? (
              <View style={styles.recoveredNotice}>
                <Text style={styles.recoveredTitle}>Recovered from your account</Text>
                <Text style={styles.message}>
                  Local voice and photo files are not on this device. You can review the server
                  copy; rerecording or replacing media requires the original device.
                </Text>
              </View>
            ) : null}
            {draft.status === 'changes_requested' && draft.review.responseNote ? (
              <View style={styles.changeNote}>
                <Text style={styles.changeNoteTitle}>Requested update</Text>
                <Text style={styles.message}>{draft.review.responseNote}</Text>
              </View>
            ) : null}
            {draft.server !== null &&
            (draft.status === 'draft' || draft.status === 'changes_requested') ? (
              <HypeButton
                label={
                  isRecoveredServerDraft(draft) && draft.status === 'draft'
                    ? 'Review server draft'
                    : draft.status === 'changes_requested'
                      ? 'Review requested changes'
                      : 'Continue editing'
                }
                onPress={() =>
                  router.push({ pathname: '/pitch/review', params: { draftId: draft.id } })
                }
              />
            ) : null}
            {draft.server !== null && draft.status === 'consent_pending' ? (
              <HypeButton
                label="Share the approval invite"
                onPress={() =>
                  router.push({ pathname: '/pitch/share', params: { draftId: draft.id } })
                }
                secondary
              />
            ) : null}
            {draft.server !== null && draft.status === 'published' ? (
              <HypeButton
                label="Open Creator Kit"
                onPress={() =>
                  router.push({
                    pathname: '/pitch/share',
                    params: { draftId: draft.id },
                  })
                }
                secondary
              />
            ) : null}
          </StickerCard>
        ))}
      </ScrollView>
      <SignInSheet
        visible={signInVisible}
        onClose={() => setSignInVisible(false)}
        onSignedIn={() => {
          setSignInVisible(false);
          load();
        }}
      />
    </SafeAreaView>
  );
}

export function getIntroducerDraftName(draft: PitchDraft): string {
  const friendName = draft.relationship?.friendFirstName.trim();
  if (friendName !== undefined && friendName.length > 0) {
    return friendName;
  }
  const headline = draft.review.headline.trim();
  return headline.length > 0 ? headline : 'Untitled server pitch';
}

function formatStatus(status: PitchDraft['status']): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'consent_pending':
      return 'Waiting for approval';
    case 'changes_requested':
      return 'Changes requested';
    case 'approved':
      return 'Approved';
    case 'published':
      return 'Live';
    case 'paused':
      return 'Paused';
    case 'expired':
      return 'Expired';
    case 'archived':
      return 'Archived';
    case 'deleted':
      return 'Deleted';
    default:
      return assertNever(status);
  }
}

function formatCampaignStatus(status: OwnedCampaignBenefit['status']): string {
  switch (status) {
    case 'published':
      return 'Live';
    case 'paused':
      return 'Paused';
    case 'expired':
      return 'Ended';
    default:
      return assertNever(status);
  }
}

function formatActivePass(expiresAt: string | null): string {
  if (expiresAt === null) {
    return 'Campaign Pass is active. Funnel analytics are available.';
  }
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) {
    return 'Campaign Pass is active. Funnel analytics are available.';
  }
  const date = expires.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `Campaign Pass active through ${date}. Funnel analytics are available.`;
}

function formatDuration(durationMillis: number): string {
  return `${Math.floor(durationMillis / 1000)} sec voice track`;
}

function assertNever(value: never): never {
  return value;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  heading: { gap: spacing.sm },
  sectionHeading: { gap: spacing.xs, marginTop: spacing.sm },
  sectionTitle: {
    color: colors.ink,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.lg,
  },
  eyebrow: {
    color: colors.pop,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.xs,
    letterSpacing: 1,
  },
  title: { color: colors.ink, fontFamily: fonts.display, fontSize: fontSizes.xl, lineHeight: 32 },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 24,
  },
  emptyTitle: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.lg },
  message: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 24,
  },
  error: { color: colors.danger, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.md },
  draftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  friendName: {
    flex: 1,
    color: colors.ink,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.lg,
  },
  statusBadge: {
    backgroundColor: colors.hype,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  status: { color: colors.onHype, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.xs },
  quietStatusBadge: {
    borderColor: colors.textSecondary,
    borderWidth: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  quietStatus: {
    color: colors.ink,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.xs,
  },
  meta: { color: colors.fresh, fontFamily: 'BricolageGrotesqueSemiBold', fontSize: fontSizes.sm },
  linkBox: {
    borderColor: colors.ink,
    borderWidth: strokes.sticker,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
    padding: spacing.md,
  },
  link: { color: colors.ink, fontFamily: 'BricolageGrotesqueSemiBold', fontSize: fontSizes.sm },
  changeNote: {
    gap: spacing.xs,
    borderLeftColor: colors.fresh,
    borderLeftWidth: spacing.xs,
    paddingLeft: spacing.md,
  },
  changeNoteTitle: {
    color: colors.fresh,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.sm,
  },
  recoveredNotice: {
    gap: spacing.xs,
    borderLeftColor: colors.textSecondary,
    borderLeftWidth: 1,
    paddingLeft: spacing.md,
  },
  recoveredTitle: {
    color: colors.ink,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.sm,
  },
});
