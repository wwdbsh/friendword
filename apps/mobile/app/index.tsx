import { colors, radii, spacing } from '@friendword/ui-tokens';
import { Link } from 'expo-router';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.heading}>
          <Text style={styles.title}>Friendword</Text>
          <Text style={styles.subtitle}>Dating, in your friends&apos; words.</Text>
        </View>

        <View style={styles.actions}>
          <Link href="/pitch/new" asChild>
            <Pressable accessibilityRole="button" style={styles.primaryAction}>
              <Text style={styles.primaryActionText}>Pitch a friend</Text>
            </Pressable>
          </Link>

          <Link href="/campaigns" asChild>
            <Pressable accessibilityRole="button" style={styles.secondaryAction}>
              <Text style={styles.secondaryActionText}>My dating campaigns</Text>
            </Pressable>
          </Link>

          <Link href="/interests" asChild>
            <Pressable accessibilityRole="button" style={styles.secondaryAction}>
              <Text style={styles.secondaryActionText}>My interests</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  heading: {
    gap: spacing.sm,
    paddingTop: spacing.xl,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 40,
    fontWeight: '700',
    letterSpacing: -1,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 18,
    lineHeight: 26,
  },
  actions: {
    gap: spacing.md,
  },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  primaryActionText: {
    color: colors.background,
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryAction: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  secondaryActionText: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '600',
  },
});
