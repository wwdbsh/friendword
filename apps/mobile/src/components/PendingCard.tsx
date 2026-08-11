import { colors, fonts, fontSizes, radii, spacing, strokes } from '@friendword/ui-tokens';
import { StyleSheet, Text, View } from 'react-native';

type PendingCardProps = {
  /** What is being waited for, in the words of the section it stands in. */
  readonly label: string;
};

/**
 * The placeholder a section shows while its own read is in flight (T014, audit
 * MUI-8).
 *
 * The campaigns screen loads three independent sections and used to mark each
 * one with a single line of text. Every section that resolved therefore grew
 * from one line to a full card and shoved everything below it down — three
 * jumps on one screen, in an order decided by whichever RPC answered first.
 *
 * This reserves roughly the height a real card will take, so a section landing
 * costs a repaint rather than a re-layout of the whole page. It is a shape, not
 * a promise: it says what is being fetched and claims nothing about the result
 * (an empty section and a failed one both have their own card).
 */
export function PendingCard({ label }: PendingCardProps) {
  return (
    <View accessibilityLabel={label} accessibilityRole="progressbar" style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.line} />
      <View style={[styles.line, styles.shortLine]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    borderColor: colors.borderMuted,
    borderRadius: radii.md,
    borderWidth: strokes.trust,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  label: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: fontSizes.md * 1.45,
  },
  // Two neutral bars stand in for the copy that is coming. textFaint is a
  // placeholder fill, which is exactly what this is — and the one use the token
  // is allowed (it is banned as text and as a boundary, never as a fill).
  line: {
    height: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.textFaint,
    opacity: 0.3,
  },
  shortLine: { width: '60%' },
});
