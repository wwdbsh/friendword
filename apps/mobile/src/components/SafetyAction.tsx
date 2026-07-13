import { colors, fontSizes, radii, spacing } from '@friendword/ui-tokens';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useReducedMotion } from './useReducedMotion';

type SafetyActionProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
};

/** Direct, low-expression destructive action for report, block, and deletion flows. */
export function SafetyAction({ label, onPress, disabled = false }: SafetyActionProps) {
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
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.danger,
    borderRadius: radii.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pressed: { backgroundColor: colors.background },
  pressedMotion: { transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.5 },
  label: {
    color: colors.danger,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.md,
    textAlign: 'center',
  },
});
