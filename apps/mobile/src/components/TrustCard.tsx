import { colors, radii, spacing } from '@friendword/ui-tokens';
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
    borderColor: colors.textFaint,
    borderRadius: radii.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
    padding: spacing.md,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: spacing.xs },
    shadowOpacity: 0.08,
    shadowRadius: spacing.md,
    elevation: 2,
  },
  success: { borderColor: colors.fresh },
  danger: { borderColor: colors.danger },
});
