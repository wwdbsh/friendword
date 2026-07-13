import { BenefitsRepo, UnauthenticatedError, type OwnedCampaignBenefit } from '@friendword/data';
import { colors, fonts, fontSizes, spacing } from '@friendword/ui-tokens';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HypeButton, StickerCard, TrustCard } from '../../src/components';
import { pitchDraftService } from '../../src/services/draftServiceInstance';
import { isRecoveredServerDraft } from '../../src/services/pitchDraftsSupabase';
import { getSupabaseClient } from '../../src/services/supabaseClient';
import type { PitchDraft } from '../../src/services/types';

type OwnedCampaignLoadState = 'loading' | 'ready' | 'signed_out' | 'error';

export function canGetCampaignPass(
  campaign: Pick<OwnedCampaignBenefit, 'status' | 'pass'>,
): boolean {
  return campaign.status === 'published' && !campaign.pass.active;
}

export function getCampaignName(campaign: Pick<OwnedCampaignBenefit, 'headline' | 'slug'>): string {
  const headline = campaign.headline?.trim();
  if (headline !== undefined && headline.length > 0) {
    return headline;
  }
  return campaign.slug ?? 'Untitled campaign';
}

export default function CampaignsScreen() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<readonly PitchDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ownedCampaigns, setOwnedCampaigns] = useState<readonly OwnedCampaignBenefit[]>([]);
  const [ownedCampaignState, setOwnedCampaignState] = useState<OwnedCampaignLoadState>('loading');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setOwnedCampaigns([]);
      setOwnedCampaignState('loading');
      pitchDraftService
        .getMyDrafts()
        .then((savedDrafts) => {
          if (active) {
            setDrafts(savedDrafts);
            setErrorMessage(null);
          }
        })
        .catch(() => {
          if (active) {
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
      }

      return () => {
        active = false;
      };
    }, []),
  );

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
            Campaign Pass adds 30 days from purchase and unlocks campaign funnel analytics.
          </Text>
        </View>

        {ownedCampaignState === 'loading' ? (
          <Text style={styles.message}>Loading your campaigns…</Text>
        ) : null}

        {ownedCampaignState === 'signed_out' ? (
          <TrustCard>
            <Text style={styles.emptyTitle}>Sign in to see your campaigns</Text>
            <Text style={styles.message}>
              Campaign Pass is only shown for published campaigns you own.
            </Text>
          </TrustCard>
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
            ) : (
              <Text style={styles.message}>
                Get 30 more days and access to campaign funnel analytics.
              </Text>
            )}
            {canGetCampaignPass(campaign) ? (
              <HypeButton
                label="Get Campaign Pass"
                onPress={() =>
                  router.push({
                    pathname: '/paywall',
                    params: { intent: 'campaign_pass', campaignId: campaign.id },
                  })
                }
                variant="trust"
              />
            ) : null}
          </TrustCard>
        ))}

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Pitches I’m making</Text>
          <Text style={styles.message}>Drafts and approval requests you started for friends.</Text>
        </View>

        {loading ? <Text style={styles.message}>Loading your mixes…</Text> : null}
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        {!loading && !errorMessage && drafts.length === 0 ? (
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
  return status === 'published' ? 'Live' : 'Paused';
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
