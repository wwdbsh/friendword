import {
  colors,
  fontSizes,
  maxControlFontScale,
  radii,
  spacing,
  strokes,
} from '@friendword/ui-tokens';
import { StyleSheet, Text, View } from 'react-native';

type StatusBadgeProps = {
  readonly label: string;
  /**
   * `campaign` is the sunshine sticker the pitch surfaces use; `trust` is the
   * quiet outlined pill for owned campaigns and interests, where a status is
   * information rather than hype (docs/DESIGN.md expression bands).
   */
  readonly tone?: 'campaign' | 'trust';
};

/**
 * One status pill for every list (T014, audit MUI-10).
 *
 * Three screens drew three different badges for the same idea: the campaigns
 * screen had a square sunshine fill with no radius AND a separate outlined
 * variant bordered in `textSecondary`, and the interests screen had a third
 * copy of the outlined one. They now differ only by tone, both are pill-shaped,
 * and the quiet outline is the Trust Layer's `borderMuted` hairline instead of
 * a text token pressed into service as a boundary.
 *
 * The label is capped at {@link maxControlFontScale}: the pill's height comes
 * from padding around a 12pt label, so an unbounded accessibility size clips it
 * (MUI-14). Scaling is limited here, never switched off.
 */
export function StatusBadge({ label, tone = 'campaign' }: StatusBadgeProps) {
  return (
    <View style={[styles.badge, tone === 'trust' ? styles.trust : styles.campaign]}>
      <Text
        maxFontSizeMultiplier={maxControlFontScale}
        style={[styles.label, tone === 'trust' && styles.trustLabel]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  campaign: {
    borderColor: colors.ink,
    borderWidth: strokes.sticker,
    backgroundColor: colors.hype,
  },
  trust: {
    // borderMuted is the Trust Layer hairline that clears WCAG 1.4.11 on both
    // cream and white; the old badges outlined themselves in a text token.
    borderColor: colors.borderMuted,
    borderWidth: strokes.trust,
    backgroundColor: colors.surface,
  },
  label: {
    color: colors.onHype,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.xs,
  },
  trustLabel: { color: colors.ink },
});
