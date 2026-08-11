import {
  colors,
  fonts,
  fontSizes,
  maxControlFontScale,
  radii,
  spacing,
  strokes,
} from '@friendword/ui-tokens';
import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { useReducedMotion } from './useReducedMotion';

type HypeButtonProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly secondary?: boolean;
  readonly variant?: 'campaign' | 'trust';
};

/** Campaign-expression action by default; trust removes the sticker shadow and outline weight. */
export function HypeButton({
  label,
  onPress,
  disabled = false,
  secondary = false,
  variant = 'campaign',
}: HypeButtonProps) {
  const reducedMotion = useReducedMotion();

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        variant === 'trust' && styles.trust,
        disabled && styles.disabled,
        pressed &&
          !disabled &&
          (variant === 'trust'
            ? styles.trustPressed
            : secondary
              ? styles.secondaryPressed
              : styles.pressed),
        pressed && !disabled && !reducedMotion && styles.pressedScale,
      ]}
    >
      {/* MUI-14: the button's height is fixed at 52pt, so its own label is
          capped rather than allowed to scale out of the box. Nothing here sets
          allowFontScaling={false} — see `maxControlFontScale`. */}
      <Text
        maxFontSizeMultiplier={maxControlFontScale}
        style={[styles.label, secondary && styles.secondaryLabel]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const stickerShadow: ViewStyle = {
  shadowColor: colors.ink,
  shadowOffset: { width: spacing.xs, height: spacing.xs },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: spacing.xs,
};

const styles = StyleSheet.create({
  button: {
    ...stickerShadow,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.ink,
    borderRadius: radii.md,
    borderWidth: strokes.sticker,
    backgroundColor: colors.pop,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.popPressed,
    shadowOffset: { width: 2, height: 2 },
  },
  pressedScale: {
    transform: [{ scale: 0.97 }],
  },
  secondary: {
    backgroundColor: colors.surface,
  },
  secondaryPressed: {
    backgroundColor: colors.hype,
    shadowOffset: { width: 2, height: 2 },
  },
  trust: {
    borderWidth: strokes.trust,
    shadowOpacity: 0,
    elevation: 0,
  },
  trustPressed: {
    backgroundColor: colors.popPressed,
  },
  disabled: {
    backgroundColor: colors.textFaint,
    opacity: 0.62,
    shadowOpacity: 0,
  },
  label: {
    color: colors.onPop,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.md,
    textAlign: 'center',
  },
  secondaryLabel: {
    color: colors.ink,
    fontFamily: fonts.body,
  },
});
