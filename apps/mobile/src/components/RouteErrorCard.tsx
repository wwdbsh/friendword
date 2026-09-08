import { colors, spacing } from '@friendword/ui-tokens';
import { StyleSheet, View } from 'react-native';

import { formatErrorForDisplay } from '../services/errorDiagnostics';
import { LoadFailureCard } from './LoadFailureCard';

type RouteErrorCardProps = {
  readonly error: Error;
  /** Re-renders the route that threw. Required — a dead end is what this replaces. */
  readonly onRetry: () => void;
};

/**
 * What a route shows instead of nothing when its render throws.
 *
 * T001 follow-up (issue #70): device QA saw a screen render correctly and then
 * go blank white with no tap. A React tree that throws with no boundary above it
 * unmounts, and a released build has no red box — so the whole failure reaches
 * the introducer as an empty screen and reaches us as no information at all.
 *
 * This does not make any particular crash go away. It makes one visible: the
 * error's class and the frame it came from, in the same reduced form the submit
 * failures already use (see `formatErrorForDisplay` for what it may and may not
 * carry), plus the retry that re-renders the route.
 */
export function RouteErrorCard({ error, onRetry }: RouteErrorCardProps) {
  return (
    <View style={styles.screen}>
      <LoadFailureCard
        title="This screen stopped"
        message={formatErrorForDisplay(error)}
        onRetry={onRetry}
        retryLabel="Try this screen again"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
});
