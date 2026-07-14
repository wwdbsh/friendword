import { trackEvent } from '@friendword/data';
import { colors, fonts, fontSizes, spacing } from '@friendword/ui-tokens';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HypeButton, QuietNavAction, TrustCard } from '../src/components';
import {
  getPaywallStatus,
  parseProductIntentParams,
  runPurchaseFlow,
  runRestoreFlow,
  type ProductIntent,
  type PurchasesStatus,
} from '../src/services/purchases';
import { getSupabaseClient } from '../src/services/supabaseClient';
import { getWebOrigin } from '../src/services/webOrigin';

type FlowState = 'idle' | 'purchasing' | 'confirming' | 'confirmed' | 'timed_out';
type ExistingBenefit = 'creator_kit' | 'campaign_pass';

export default function PaywallScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    intent?: string | string[];
    draftId?: string | string[];
    campaignId?: string | string[];
    revive?: string | string[];
  }>();
  // Set by the campaigns screen only when the buyer is reviving an expired
  // campaign, so the confirmation stays honest about the pending revival.
  const isRevival = firstParam(params.revive) === 'true';
  const productIntent = useMemo(
    () =>
      parseProductIntentParams({
        intent: params.intent,
        draftId: params.draftId,
        campaignId: params.campaignId,
      }),
    [params.campaignId, params.draftId, params.intent],
  );
  const [status, setStatus] = useState<PurchasesStatus | null>(null);
  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [note, setNote] = useState<string | null>(null);
  const [existingBenefit, setExistingBenefit] = useState<ExistingBenefit | null>(null);
  const flowAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      flowAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (productIntent === null) {
      setStatus(null);
      return;
    }

    trackEvent(
      getSupabaseClient(),
      productIntent.intent === 'creator_launch'
        ? 'creator_launch_paywall_viewed'
        : 'campaign_pass_paywall_viewed',
      { platform: 'mobile' },
    );
    let active = true;
    void getPaywallStatus(productIntent).then((loaded) => {
      if (active) {
        setStatus(loaded);
      }
    });
    return () => {
      active = false;
    };
  }, [productIntent]);

  const run = async (operation: 'purchase' | 'restore', packageIdentifier?: string) => {
    if (productIntent === null) {
      return;
    }

    flowAbortRef.current?.abort();
    const controller = new AbortController();
    flowAbortRef.current = controller;
    setFlowState('purchasing');
    setNote(null);
    setExistingBenefit(null);

    const options = {
      signal: controller.signal,
      onAwaitingConfirmation: () => {
        if (!controller.signal.aborted) {
          setFlowState('confirming');
        }
      },
    };

    try {
      const result =
        operation === 'purchase'
          ? await runPurchaseFlow(
              productIntent,
              requirePackageIdentifier(packageIdentifier),
              options,
            )
          : await runRestoreFlow(productIntent, options);
      if (controller.signal.aborted) {
        return;
      }
      setFlowState(result === 'confirmed' ? 'confirmed' : 'timed_out');
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        return;
      }
      setFlowState('idle');
      const benefit = getExistingBenefitFromRejection(productIntent, error);
      if (benefit !== null) {
        setExistingBenefit(benefit);
        setNote(null);
        return;
      }
      setNote(error instanceof Error ? error.message : 'The purchase did not complete.');
    }
  };

  if (productIntent === null) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <TrustCard tone="danger">
            <Text style={styles.cardTitle}>This paywall link isn’t valid</Text>
            <Text style={styles.subtitle}>
              Open payment from the draft or campaign you want to purchase for. Products are not
              shown without a verified context.
            </Text>
          </TrustCard>
          <QuietNavAction label="Back" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  if (flowState === 'confirming') {
    return (
      <FlowMessage
        title="Confirming your purchase"
        body="Waiting for the server to confirm your benefit…"
      />
    );
  }

  if (flowState === 'confirmed') {
    return (
      <FlowMessage
        title="Purchase confirmed"
        body={getConfirmedBody(productIntent, isRevival)}
        onBack={() => router.back()}
      />
    );
  }

  if (flowState === 'timed_out') {
    return (
      <FlowMessage
        title="Purchase received"
        body="Your benefit should appear shortly. Contact Friendword support if it remains unavailable."
        onBack={() => router.back()}
      />
    );
  }

  const copy = getPaywallCopy(productIntent);
  const busy = flowState === 'purchasing';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.subtitle}>{copy.subtitle}</Text>
        </View>

        {status === null ? <Text style={styles.subtitle}>Loading offering…</Text> : null}

        {status?.state === 'unconfigured' ? (
          <TrustCard>
            <Text style={styles.cardTitle}>Billing isn’t live yet</Text>
            <Text style={styles.subtitle}>{status.reason}</Text>
            <Text style={styles.finePrint}>
              Once this product is configured in RevenueCat, it will appear here automatically.
            </Text>
          </TrustCard>
        ) : null}

        {status?.state === 'ready' && status.package === null ? (
          <TrustCard>
            <Text style={styles.cardTitle}>This offering isn’t available yet</Text>
            <Text style={styles.subtitle}>
              RevenueCat responded, but the product for this paywall context is missing from the
              current offering.
            </Text>
          </TrustCard>
        ) : null}

        {status?.state === 'ready' && status.package !== null && existingBenefit === null ? (
          <TrustCard>
            <Text style={styles.cardTitle}>{status.package.title}</Text>
            <Text style={styles.subtitle}>{copy.benefit}</Text>
            <Text style={styles.purchaseKind}>One-time purchase</Text>
            <Text style={styles.price}>{status.package.priceString}</Text>
            <HypeButton
              disabled={busy}
              label={busy ? 'Starting purchase…' : `Get ${status.package.title}`}
              onPress={() => {
                void run('purchase', status.package?.identifier);
              }}
              variant="trust"
            />
          </TrustCard>
        ) : null}

        {existingBenefit === 'creator_kit' && productIntent.intent === 'creator_launch' ? (
          <TrustCard>
            <Text style={styles.cardTitle}>Creator Kit already available</Text>
            <Text style={styles.subtitle}>
              This pitch already has an available credit or unlocked kit. No new purchase is needed.
            </Text>
            <HypeButton
              label="Open Creator Kit"
              onPress={() => {
                void Linking.openURL(`${getWebOrigin()}/kit/${productIntent.draftId}`).catch(() => {
                  setNote('The Creator Kit could not open. Please try again.');
                });
              }}
              variant="trust"
            />
          </TrustCard>
        ) : null}

        {existingBenefit === 'campaign_pass' && productIntent.intent === 'campaign_pass' ? (
          <TrustCard>
            <Text style={styles.cardTitle}>Campaign Pass is already active</Text>
            <Text style={styles.subtitle}>
              This campaign already has access to its current pass period and funnel analytics. No
              new purchase was started.
            </Text>
          </TrustCard>
        ) : null}

        {note !== null ? (
          <TrustCard tone="danger">
            <Text style={styles.note}>{note}</Text>
          </TrustCard>
        ) : null}

        <QuietNavAction
          disabled={busy}
          label={busy ? 'Working…' : 'Restore purchases'}
          onPress={() => {
            void run('restore');
          }}
        />
        <QuietNavAction label="Back" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

function FlowMessage({
  title,
  body,
  onBack,
}: {
  readonly title: string;
  readonly body: string;
  readonly onBack?: () => void;
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.centeredContent}>
        <TrustCard tone={title === 'Purchase confirmed' ? 'success' : 'neutral'}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.subtitle}>{body}</Text>
        </TrustCard>
        {onBack === undefined ? null : <QuietNavAction label="Back" onPress={onBack} />}
      </View>
    </SafeAreaView>
  );
}

export function getConfirmedBody(intent: ProductIntent, revive: boolean): string {
  if (intent.intent === 'creator_launch') {
    return 'Open this pitch’s Creator Kit to unlock its 9:16 share card and caption pack.';
  }
  if (revive) {
    // Honest revival copy: the entitlement is recorded and the campaign is
    // being revived, but during the private beta the revival can be pending
    // review before it goes live again (DECISIONS 2026-07-14 point 2). We do
    // not claim funnel analytics are live yet.
    return 'Your Campaign Pass is recorded and this campaign is being revived with 30 more days from purchase. During our private beta, the revival can stay pending review for a short while before it is live again — you keep the days you paid for.';
  }
  return 'Campaign Pass added 30 days and unlocked campaign funnel analytics.';
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getPaywallCopy(intent: ProductIntent): {
  readonly eyebrow: string;
  readonly title: string;
  readonly subtitle: string;
  readonly benefit: string;
} {
  return intent.intent === 'creator_launch'
    ? {
        eyebrow: 'CREATOR LAUNCH',
        title: 'One credit for this pitch',
        subtitle:
          'Creator Launch unlocks one static Creator Kit for this published pitch. The kit stays available after unlock.',
        benefit: 'One 9:16 share card and a caption pack.',
      }
    : {
        eyebrow: 'CAMPAIGN PASS',
        title: '30 more days for this campaign',
        subtitle: 'Campaign Pass adds 30 days from purchase for this published campaign.',
        benefit: 'Access campaign funnel analytics during the active pass period.',
      };
}

export function getExistingBenefitFromRejection(
  intent: ProductIntent,
  error: unknown,
): ExistingBenefit | null {
  const message = getErrorChainMessage(error).toLowerCase();
  if (
    intent.intent === 'creator_launch' &&
    (message.includes('unused creator launch credit') || message.includes('unlocked creator kit'))
  ) {
    return 'creator_kit';
  }
  if (
    intent.intent === 'campaign_pass' &&
    message.includes('already has an active campaign pass')
  ) {
    return 'campaign_pass';
  }
  return null;
}

function getErrorChainMessage(error: unknown): string {
  const messages: string[] = [];
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      break;
    }
    if ('message' in current && typeof current.message === 'string') {
      messages.push(current.message);
    }
    current = 'cause' in current ? current.cause : null;
  }
  return messages.join(' ');
}

function requirePackageIdentifier(value: string | undefined): string {
  if (value === undefined) {
    throw new Error('package identifier is required for purchase');
  }
  return value;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  centeredContent: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  heading: { gap: spacing.sm },
  eyebrow: {
    color: colors.pop,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.xs,
    letterSpacing: 1,
  },
  title: {
    color: colors.ink,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.xl,
    lineHeight: 32,
  },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 24,
  },
  cardTitle: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.lg },
  purchaseKind: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
  },
  price: { color: colors.pop, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.xl },
  finePrint: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    lineHeight: fontSizes.sm * 1.45,
  },
  note: { color: colors.ink, fontFamily: 'BricolageGrotesqueSemiBold', fontSize: fontSizes.md },
});
