import { colors, radii, spacing, strokes } from '@friendword/ui-tokens';
import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';

type TrustCardProps = PropsWithChildren<{
  readonly tone?: 'neutral' | 'success' | 'danger';
}>;

/** Low-expression container for payment, identity, consent, and safety states. */
export function TrustCard({ children, tone = 'neutral' }: TrustCardProps) {
  return (
    <View
      style={[
        styles.card,
        tone === 'success' && styles.success,
        tone === 'danger' && styles.danger,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    // Trust Layer hairline: borderMuted meets WCAG 1.4.11 (3:1) on cream and
    // white; textFaint (2.72/2.92) did not. See docs/DESIGN.md Trust Layer.
    borderColor: colors.borderMuted,
    borderRadius: radii.md,
    borderWidth: strokes.trust,
    backgroundColor: colors.surface,
    padding: spacing.md,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: spacing.xs },
    shadowOpacity: 0.08,
    shadowRadius: spacing.md,
    elevation: 2,
  },
  // borderSuccess (darker teal) passes 3:1 as a boundary; fresh (2.35/2.51)
  // is a fill/icon color only.
  success: { borderColor: colors.borderSuccess },
  danger: { borderColor: colors.danger },
});
