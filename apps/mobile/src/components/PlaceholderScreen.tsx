import { colors, fonts, fontSizes, spacing } from '@friendword/ui-tokens';
import { StyleSheet, Text, View } from 'react-native';

type PlaceholderScreenProps = {
  readonly title: string;
};

export function PlaceholderScreen({ title }: PlaceholderScreenProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Coming soon</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>
        This flow is ready for the next Friendword build slice.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  eyebrow: {
    color: colors.pop,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.sm,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: fontSizes.xl,
  },
  description: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 24,
  },
});
