import { colors, fonts, fontSizes, spacing } from '@friendword/ui-tokens';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HypeButton, QuietNavAction, StickerCard } from '../src/components';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <StickerCard>
          <Text style={styles.eyebrow}>YOUR FRIEND IS YOUR HYPE PERSON</Text>
          <Text style={styles.title}>Friendword</Text>
          <Text style={styles.subtitle}>Dating, in your friends&apos; words.</Text>
          <View style={styles.intro}>
            <Text style={styles.introTitle}>Put your best friend on the record.</Text>
            <Text style={styles.introBody}>
              Five quick tracks. One voice note. A dating pitch only a real friend could make.
            </Text>
          </View>
          <HypeButton label="Pitch a friend" onPress={() => router.push('/pitch/new')} />
        </StickerCard>

        <View style={styles.navigation}>
          <Text style={styles.navigationLabel}>Your activity</Text>
          <QuietNavAction label="My dating campaigns" onPress={() => router.push('/campaigns')} />
          <QuietNavAction label="My interests" onPress={() => router.push('/interests')} />
          {/* App Store guideline 5.1.1(v): account deletion has to be reachable
              from inside the app, not only from the web. This is the only
              account surface the app has today — sign-out and the rest of "my
              profile" are separate tasks. */}
          <QuietNavAction label="Account" onPress={() => router.push('/account')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: {
    flexGrow: 1,
    justifyContent: 'space-between',
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  eyebrow: {
    color: colors.pop,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.xs,
    letterSpacing: 1,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: fontSizes.hero,
    letterSpacing: -1.5,
  },
  subtitle: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: fontSizes.lg },
  intro: {
    gap: spacing.sm,
    borderTopColor: colors.textFaint,
    borderTopWidth: 1,
    paddingTop: spacing.md,
  },
  introTitle: {
    color: colors.ink,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.xl,
    lineHeight: 31,
  },
  introBody: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 24,
  },
  navigation: { gap: spacing.xs },
  navigationLabel: {
    color: colors.textSecondary,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.sm,
  },
});
