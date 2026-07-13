import { colors, fonts, fontSizes, radii, spacing, strokes } from '@friendword/ui-tokens';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { trackEvent } from '@friendword/data';

import { HypeButton, StickerCard } from '../../src/components';
import { pitchDraftService } from '../../src/services/draftServiceInstance';
import { getSupabaseClient } from '../../src/services/supabaseClient';
import type { PitchDraft } from '../../src/services/types';
import { buildConsentUrl } from '../../src/services/webOrigin';

export default function SharePitchScreen() {
  const router = useRouter();
  const { draftId } = useLocalSearchParams<{ draftId: string }>();
  const [draft, setDraft] = useState<PitchDraft | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    pitchDraftService
      .getMyDrafts()
      .then(async (drafts) => {
        const candidate = drafts.find((draft) => draft.id === draftId);
        if (
          candidate === undefined ||
          candidate.server === null ||
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
  const consentUrl =
    draft?.server === null || draft === null ? null : buildConsentUrl(draft.server.consentToken);

  const shareInvite = async (): Promise<void> => {
    if (consentUrl === null) {
      return;
    }
    trackEvent(getSupabaseClient(), 'campaign_shared', {
      platform: 'mobile',
      pitch_draft_id: draft?.server?.draftId ?? null,
    });
    await Share.share({
      message: `I recorded a Friendword pitch about you — it only goes live if you approve it. Take a listen: ${consentUrl}`,
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ title: 'Share approval invite' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>TRACK 6 · RELEASE DAY</Text>
          <Text style={styles.title}>Your mix is on its way!</Text>
          <Text style={styles.subtitle}>
            One last move: send {friendName} the private approval invite. Nothing goes public until
            they say yes.
          </Text>
        </View>

        {loading ? <Text style={styles.subtitle}>Loading your invite…</Text> : null}

        {!loading && consentUrl === null ? (
          <StickerCard>
            <Text style={styles.cardTitle}>Invite not found</Text>
            <Text style={styles.subtitle}>
              This pitch hasn’t been submitted yet, or the invite link lives on another device.
            </Text>
          </StickerCard>
        ) : null}

        {consentUrl !== null ? (
          <>
            <StickerCard>
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
              />
            </StickerCard>

            <StickerCard>
              <Text style={styles.cardTitle}>What happens next</Text>
              <Text style={styles.step}>1. {friendName} opens the link and signs in.</Text>
              <Text style={styles.step}>2. They hear your voice and review everything.</Text>
              <Text style={styles.step}>3. When they approve, their page goes live.</Text>
            </StickerCard>
          </>
        ) : null}

        <HypeButton
          label="Back to my campaigns"
          onPress={() => router.replace('/campaigns')}
          secondary
        />
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
  step: {
    color: colors.textSecondary,
    fontFamily: 'BricolageGrotesqueSemiBold',
    fontSize: fontSizes.md,
    lineHeight: 24,
  },
});
