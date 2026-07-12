import { colors, fontSizes, radii, spacing, strokes, tilts } from '@friendword/ui-tokens';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useReducedMotion } from '../../components';

type OptionChipProps = {
  readonly label: string;
  readonly selected: boolean;
  readonly tiltIndex: number;
  readonly onPress: () => void;
};

export function OptionChip({ label, selected, tiltIndex, onPress }: OptionChipProps) {
  const reducedMotion = useReducedMotion();
  const tilt = tilts[tiltIndex % tilts.length] ?? 0;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          transform: [{ rotate: `${tilt}deg` }, { scale: pressed && !reducedMotion ? 0.97 : 1 }],
        },
        selected && styles.selected,
      ]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 48,
    justifyContent: 'center',
    borderColor: colors.ink,
    borderRadius: radii.pill,
    borderWidth: strokes.sticker,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: colors.ink,
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 2,
  },
  selected: { backgroundColor: colors.hype },
  label: {
    color: colors.ink,
    fontFamily: 'BricolageGrotesqueSemiBold',
    fontSize: fontSizes.md,
    textAlign: 'center',
  },
});
