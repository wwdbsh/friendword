import { colors, fonts, fontSizes, radii, spacing, strokes } from '@friendword/ui-tokens';
import { PurchasesRepo, trackEvent } from '@friendword/data';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HypeButton, QuietNavAction, StickerCard, TrustCard } from '../../src/components';
import { pitchDraftService } from '../../src/services/draftServiceInstance';
import { hasFinalizedConsent } from '../../src/services/pitchDrafts';
import { getSupabaseClient } from '../../src/services/supabaseClient';
import type { PitchDraft } from '../../src/services/types';
import { buildConsentUrl, getWebOrigin } from '../../src/services/webOrigin';

type CreatorCreditState = 'idle' | 'loading' | 'available' | 'unavailable' | 'error';

export default function SharePitchScreen() {
  const router = useRouter();
  const { draftId, resent } = useLocalSearchParams<{ draftId: string; resent?: string }>();
  const [draft, setDraft] = useState<PitchDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareError, setShareError] = useState<string | null>(null);
  const [kitError, setKitError] = useState<string | null>(null);
  const [creatorCreditState, setCreatorCreditState] = useState<CreatorCreditState>('idle');
  const [creditRefresh, setCreditRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    pitchDraftService
      .getMyDrafts()
      .then(async (drafts) => {
        const candidate = drafts.find((draft) => draft.id === draftId);
        if (
          candidate === undefined ||
          candidate.server === null ||
          !hasFinalizedConsent(candidate) ||
          candidate.relationship === null ||
          candidate.relationship.contact.kind === 'sent'
        ) {
          return candidate ?? null;
        }
        return pitchDraftService.purgeInvitationContact(candidate.id);
      })
      .then((candidate) => {
        if (active) {
          setDraft(candidate);
        }
      })
      .catch(() => {
        if (active) {
          setDraft(null);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [draftId]);

  const friendName = draft?.relationship?.friendFirstName ?? 'your friend';
  const serverDraftId = draft?.server?.draftId ?? null;
  const consentToken = draft?.server?.consentToken ?? null;
  const consentUrl = consentToken === null ? null : buildConsentUrl(consentToken);
  const isResent = resent === '1';
  const isPublished = draft?.status === 'published' && serverDraftId !== null;
  const kitUrl = serverDraftId === null ? null : `${getWebOrigin()}/kit/${serverDraftId}`;

  useFocusEffect(
    useCallback(() => {
      if (!isPublished || serverDraftId === null) {
        setCreatorCreditState('idle');
        return;
      }

      let active = true;
      const client = getSupabaseClient();
      if (client === null) {
        setCreatorCreditState('error');
        return;
      }

      setCreatorCreditState('loading');
      const repo = new PurchasesRepo(client);
      void repo
        .hasConfirmedBenefit({
          productId: 'creator_launch_credit_499',
          pitchDraftId: serverDraftId,
        })
        .then((available) => {
          if (active) {
            setCreatorCreditState(available ? 'available' : 'unavailable');
          }
        })
        .catch(() => {
          if (active) {
            setCreatorCreditState('error');
          }
        });

      return () => {
        active = false;
      };
    }, [creditRefresh, isPublished, serverDraftId]),
  );

  const shareInvite = async (): Promise<void> => {
    if (consentUrl === null) {
      return;
    }
    setShareError(null);
    try {
      const result = await Share.share({
        message: `I recorded a Friendword pitch about you — it only goes live if you approve it. Take a listen: ${consentUrl}`,
      });
      if (result.action === Share.sharedAction) {
        trackEvent(getSupabaseClient(), 'campaign_shared', {
          platform: 'mobile',
          pitch_draft_id: draft?.server?.draftId ?? null,
        });
      }
    } catch {
      setShareError('The share sheet could not open. Please try again.');
    }
  };

  const openKit = async (): Promise<void> => {
    if (kitUrl === null) {
      return;
    }
    setKitError(null);
    try {
      await Linking.openURL(kitUrl);
    } catch {
      setKitError('The social launch kit could not open. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen
        options={{
          title: isPublished
            ? 'Social launch kit'
            : isResent
              ? 'Revision ready'
              : 'Share approval invite',
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>
            {isPublished
              ? 'SOCIAL LAUNCH KIT'
              : isResent
                ? 'LATEST REVISION READY'
                : 'TRACK 6 · RELEASE DAY'}
          </Text>
          <Text style={styles.title}>
            {isPublished
              ? 'Your approved pitch is live'
              : isResent
                ? 'The existing link is up to date'
                : 'Your mix is ready to send!'}
          </Text>
          <Text style={styles.subtitle}>
            {isPublished
              ? 'Create social assets from the approved pitch, or open the kit you already purchased.'
              : isResent
                ? `${friendName} can review the latest revision at the same private link.`
                : `One last move: send ${friendName} the private approval invite. Nothing goes public until they say yes.`}
          </Text>
        </View>

        {loading ? <Text style={styles.subtitle}>Loading your invite…</Text> : null}

        {!loading && !isResent && !isPublished && consentUrl === null ? (
          <TrustCard tone="danger">
            <Text style={styles.cardTitle}>Invite not found</Text>
            <Text style={styles.subtitle}>
              This pitch hasn’t been submitted yet, or the invite link lives on another device.
            </Text>
          </TrustCard>
        ) : null}

        {isResent && !isPublished && draft !== null ? (
          <TrustCard>
            <Text style={styles.cardTitle}>Existing link updated</Text>
            <Text style={styles.subtitle}>
              기존 링크가 최신 수정본으로{`\n`}바뀌었어요.{`\n`}새 링크나 재공유는 필요하지 않아요.
            </Text>
            <Text style={styles.finePrint}>
              {friendName}’s existing private approval link now opens the latest revision. No new
              link was issued.
            </Text>
          </TrustCard>
        ) : null}

        {!isResent && !isPublished && consentUrl !== null ? (
          <>
            <TrustCard>
              <Text style={styles.cardTitle}>{friendName}’s private invite</Text>
              <Text style={styles.finePrint}>
                Invite details sent to Friendword · contact removed from this device.
              </Text>
              <View style={styles.linkBox}>
                <Text numberOfLines={2} style={styles.link}>
                  {consentUrl}
                </Text>
              </View>
              <Text style={styles.finePrint}>
                Only {friendName} should get this link — it’s how they claim, review, and approve
                the pitch in their own words.
              </Text>
              <HypeButton
                label={`Send it to ${friendName}`}
                onPress={() => {
                  void shareInvite();
                }}
                variant="trust"
              />
              {shareError ? <Text style={styles.error}>{shareError}</Text> : null}
            </TrustCard>

            <TrustCard>
              <Text style={styles.cardTitle}>What happens next</Text>
              <Text style={styles.step}>1. {friendName} opens the link and signs in.</Text>
              <Text style={styles.step}>2. They hear your voice and review everything.</Text>
              <Text style={styles.step}>3. When they approve, their page goes live.</Text>
            </TrustCard>
          </>
        ) : null}

        {isPublished && (creatorCreditState === 'idle' || creatorCreditState === 'loading') ? (
          <TrustCard>
            <Text style={styles.cardTitle}>Checking Creator Launch access</Text>
            <Text style={styles.subtitle}>Confirming the credit for this published pitch…</Text>
          </TrustCard>
        ) : null}

        {isPublished && creatorCreditState === 'unavailable' && serverDraftId !== null ? (
          <StickerCard>
            <Text style={styles.cardTitle}>Create social launch kit</Text>
            <Text style={styles.subtitle}>
              Purchase one Creator Launch credit for this pitch, then create its approved social
              assets on the web.
            </Text>
            <HypeButton
              label="Get Creator Launch"
              onPress={() =>
                router.push({
                  pathname: '/paywall',
                  params: { intent: 'creator_launch', draftId: serverDraftId },
                })
              }
            />
          </StickerCard>
        ) : null}

        {isPublished && creatorCreditState === 'available' && kitUrl !== null ? (
          <StickerCard>
            <Text style={styles.cardTitle}>Your social launch kit is ready to unlock</Text>
            <Text style={styles.subtitle}>
              Your Creator Launch credit is available for this pitch. Open the web kit to create and
              share the approved assets.
            </Text>
            <View style={styles.linkBox}>
              <Text numberOfLines={2} style={styles.link}>
                {kitUrl}
              </Text>
            </View>
            <HypeButton
              label="Open social launch kit"
              onPress={() => {
                void openKit();
              }}
            />
            {kitError ? <Text style={styles.error}>{kitError}</Text> : null}
          </StickerCard>
        ) : null}

        {isPublished && creatorCreditState === 'error' ? (
          <TrustCard tone="danger">
            <Text style={styles.cardTitle}>Creator Launch access could not be checked</Text>
            <Text style={styles.subtitle}>
              No purchase was started. Check your connection and try again.
            </Text>
            <QuietNavAction
              label="Try again"
              onPress={() => setCreditRefresh((current) => current + 1)}
            />
          </TrustCard>
        ) : null}

        <QuietNavAction label="Back to my campaigns" onPress={() => router.replace('/campaigns')} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  heading: { gap: spacing.sm },
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
  cardTitle: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.lg },
  linkBox: {
    borderColor: colors.ink,
    borderWidth: strokes.sticker,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
    padding: spacing.md,
  },
  link: { color: colors.ink, fontFamily: 'BricolageGrotesqueSemiBold', fontSize: fontSizes.sm },
  finePrint: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    lineHeight: fontSizes.sm * 1.45,
  },
  error: { color: colors.danger, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.sm },
  step: {
    color: colors.textSecondary,
    fontFamily: 'BricolageGrotesqueSemiBold',
    fontSize: fontSizes.md,
    lineHeight: 24,
  },
});
