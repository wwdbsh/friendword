import { colors, fonts, fontSizes, spacing } from '@friendword/ui-tokens';
import { StyleSheet, Text, View } from 'react-native';

type ScreenHeadingProps = {
  /** Short all-caps kicker. Optional: not every screen has one to say. */
  readonly eyebrow?: string;
  readonly title: string;
  readonly subtitle?: string;
};

/**
 * The top of a list/detail screen (T014, audit MUI-10).
 *
 * Campaigns, interests, account, share and the review editor each drew their
 * own eyebrow/title/subtitle trio, and they had quietly diverged: the title's
 * line height was 32 on three screens and 34 on a fourth, the eyebrow was
 * `pop` everywhere (unreadable — MUI-6), and the subtitle's line height was
 * 24 in some places and `fontSizes.md * 1.45` in others. One component, so the
 * screens cannot drift again, and so the MUI-6 fix lands once.
 *
 * The eyebrow is `keyword`, not `pop`: same tangerine signal, but 4.71:1 on
 * cream instead of 2.89:1.
 */
export function ScreenHeading({ eyebrow, title, subtitle }: ScreenHeadingProps) {
  return (
    <View style={styles.heading}>
      {eyebrow === undefined ? null : <Text style={styles.eyebrow}>{eyebrow}</Text>}
      <Text style={styles.title}>{title}</Text>
      {subtitle === undefined ? null : <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.sm },
  eyebrow: {
    color: colors.keyword,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.xs,
    letterSpacing: 1,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: fontSizes.xl,
    lineHeight: fontSizes.xl * 1.25,
  },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: fontSizes.md * 1.45,
  },
});
