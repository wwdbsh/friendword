import { trackEvent } from '@friendword/data';
import { colors, fonts, fontSizes, spacing } from '@friendword/ui-tokens';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
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

type FlowState = 'idle' | 'purchasing' | 'confirming' | 'confirmed' | 'timed_out';

export default function PaywallScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    intent?: string | string[];
    draftId?: string | string[];
    campaignId?: string | string[];
  }>();
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
    return <FlowMessage title="결제 확인 중" body="서버에서 혜택 반영을 확인하고 있어요…" />;
  }

  if (flowState === 'confirmed') {
    return (
      <FlowMessage
        title="결제가 확인됐어요"
        body={
          productIntent.intent === 'creator_launch'
            ? 'Creator Launch 크레딧을 이 피치에서 사용할 수 있어요.'
            : '30일 Campaign Pass가 활성화됐어요.'
        }
        onBack={() => router.back()}
      />
    );
  }

  if (flowState === 'timed_out') {
    return (
      <FlowMessage
        title="결제는 접수됐어요"
        body="혜택은 잠시 후 자동 반영됩니다. 계속 보이지 않으면 Friendword 지원팀에 문의해 주세요."
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

        {status?.state === 'ready' && status.package !== null ? (
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
        <TrustCard tone={title === '결제가 확인됐어요' ? 'success' : 'neutral'}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.subtitle}>{body}</Text>
        </TrustCard>
        {onBack === undefined ? null : <QuietNavAction label="Back" onPress={onBack} />}
      </View>
    </SafeAreaView>
  );
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
          'Purchase a Creator Launch credit for the selected pitch. The credit stays scoped to this draft.',
        benefit: 'Create the approved social launch kit for this pitch after it is published.',
      }
    : {
        eyebrow: 'CAMPAIGN PASS',
        title: '30 more days for this campaign',
        subtitle:
          'Purchase Campaign Pass for the selected published campaign. The entitlement is scoped to this campaign.',
        benefit: 'Extend the campaign and access its performance analytics for the pass period.',
      };
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
