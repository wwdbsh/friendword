import { colors, fonts, fontSizes, spacing } from '@friendword/ui-tokens';
import { trackEvent } from '@friendword/data';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HypeButton, StickerCard } from '../src/components';
import {
  getPaywallStatus,
  purchasePackage,
  restorePurchases,
  type PurchasesStatus,
} from '../src/services/purchases';
import { getSupabaseClient } from '../src/services/supabaseClient';

export default function PaywallScreen() {
  const router = useRouter();
  const { pitchDraftId, campaignId } = useLocalSearchParams<{
    pitchDraftId?: string;
    campaignId?: string;
  }>();
  const [status, setStatus] = useState<PurchasesStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    trackEvent(getSupabaseClient(), 'creator_launch_paywall_viewed', { platform: 'mobile' });
    let active = true;
    void getPaywallStatus().then((loaded) => {
      if (active) {
        setStatus(loaded);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const buy = async (packageIdentifier: string): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      await purchasePackage(packageIdentifier, { pitchDraftId, campaignId });
      trackEvent(getSupabaseClient(), 'creator_launch_purchased', { platform: 'mobile' });
      setNote('Purchase complete — thank you!');
    } catch (error: unknown) {
      setNote(error instanceof Error ? error.message : 'The purchase did not complete.');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      await restorePurchases();
      setNote('Purchases restored.');
    } catch {
      setNote('Nothing to restore on this account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>GIVE THE MIX A BOOST</Text>
          <Text style={styles.title}>Launch it louder.</Text>
          <Text style={styles.subtitle}>
            Friendword is free to start. Boosts help a pitch travel further — nothing here is
            required to introduce a friend.
          </Text>
        </View>

        {status === null ? <Text style={styles.subtitle}>Loading offerings…</Text> : null}

        {status?.state === 'unconfigured' ? (
          <StickerCard>
            <Text style={styles.cardTitle}>Billing isn’t live yet</Text>
            <Text style={styles.subtitle}>{status.reason}</Text>
            <Text style={styles.finePrint}>
              Once the RevenueCat products are configured, Creator Launch ($4.99 one-time) and the
              30-day Campaign Pass ($19.99) appear here automatically.
            </Text>
          </StickerCard>
        ) : null}

        {status?.state === 'ready' && status.packages.length === 0 ? (
          <StickerCard>
            <Text style={styles.cardTitle}>No offerings yet</Text>
            <Text style={styles.subtitle}>
              RevenueCat responded, but the current offering has no packages. Add
              creator_launch_credit_499 and campaign_30d_1999 to the default offering.
            </Text>
          </StickerCard>
        ) : null}

        {status?.state === 'ready'
          ? status.packages.map((pkg) => (
              <StickerCard key={pkg.identifier}>
                <Text style={styles.cardTitle}>{pkg.title}</Text>
                <Text style={styles.price}>{pkg.priceString}</Text>
                <HypeButton
                  disabled={busy}
                  label={busy ? 'Working…' : `Get ${pkg.title}`}
                  onPress={() => {
                    void buy(pkg.identifier);
                  }}
                />
              </StickerCard>
            ))
          : null}

        {note !== null ? <Text style={styles.note}>{note}</Text> : null}

        <HypeButton
          disabled={busy}
          label="Restore purchases"
          onPress={() => {
            void restore();
          }}
          secondary
        />
        <HypeButton label="Back" onPress={() => router.back()} secondary />
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
  price: { color: colors.pop, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.xl },
  finePrint: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    lineHeight: fontSizes.sm * 1.45,
  },
  note: { color: colors.ink, fontFamily: 'BricolageGrotesqueSemiBold', fontSize: fontSizes.md },
});
