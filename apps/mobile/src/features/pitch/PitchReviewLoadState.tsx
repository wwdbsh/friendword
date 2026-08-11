import { colors, fonts, fontSizes, spacing } from '@friendword/ui-tokens';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HypeButton, QuietNavAction, TrustCard } from '../../components';

type PitchReviewLoadStateProps = {
  /** The sentence to show. Either "still working" or "this is what failed". */
  readonly message: string;
  /** True while a read is in flight — the message is progress, not a verdict. */
  readonly pending: boolean;
  /** Runs the read again. Offered only when the state is a failure. */
  readonly onRetry: () => void;
  /** Leaves for the list this draft belongs to. */
  readonly onBackToCampaigns: () => void;
};

/**
 * What the review screen shows before it has a draft (T014, audit MUI-5, MUI-13).
 *
 * This state used to be one `<Text>` pinned to the top-left corner of a padded
 * SafeAreaView: no scroll, no card, no spacing, and — when the message was
 * "This draft could not be found." — no way forward except the system back
 * gesture. Every other state on this screen is a centred card in a scroll view,
 * so the one state a person hits when something has gone wrong was also the
 * only one that looked broken.
 *
 * A failure now says so inside a card, offers the read again, and always offers
 * the way back to the list. A pending read stays plain: no error tone, no retry
 * for something that has not failed yet.
 */
export function PitchReviewLoadState({
  message,
  pending,
  onRetry,
  onBackToCampaigns,
}: PitchReviewLoadStateProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        {pending ? (
          <Text accessibilityLiveRegion="polite" style={styles.message}>
            {message}
          </Text>
        ) : (
          <TrustCard tone="danger">
            <Text style={styles.title}>This draft could not be opened</Text>
            <Text style={styles.message}>{message}</Text>
            <HypeButton label="Try again" onPress={onRetry} variant="trust" />
            <QuietNavAction label="Back to my campaigns" onPress={onBackToCampaigns} />
          </TrustCard>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.lg },
  message: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: fontSizes.md * 1.45,
    textAlign: 'center',
  },
});
