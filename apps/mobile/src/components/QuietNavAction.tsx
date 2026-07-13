import { colors, fontSizes, spacing } from '@friendword/ui-tokens';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useReducedMotion } from './useReducedMotion';

type QuietNavActionProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
};

/** Secondary navigation that stays visually subordinate to page content. */
export function QuietNavAction({ label, onPress, disabled = false }: QuietNavActionProps) {
  const reducedMotion = useReducedMotion();

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        pressed && !disabled && !reducedMotion && styles.pressedMotion,
      ]}
    >
      <Text style={styles.label}>{label}</Text>
      <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.arrow}>
        →
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderBottomColor: colors.textFaint,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  pressed: { opacity: 0.72 },
  pressedMotion: { transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.5 },
  label: {
    flex: 1,
    color: colors.ink,
    fontFamily: 'BricolageGrotesqueSemiBold',
    fontSize: fontSizes.md,
  },
  arrow: {
    color: colors.textSecondary,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.lg,
  },
});
