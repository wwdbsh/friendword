import { colors, fonts, fontSizes, spacing, strokes } from '@friendword/ui-tokens';
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

        {/* T009 (Issue #46): this group is the app's half of the same hub the
            web serves at /me, so it carries the web's names for the same
            areas — "My campaigns" is the campaigns screen's own title, and
            "My interests" is the web tab's. Renaming "Your activity" to "My
            page" is the point: a person looking for their own things looks for
            themselves, not for a log of what they did.

            Interest received and intro rooms are answered on the web (the app
            has no decide or chat screen), and they keep their contextual links
            from the campaign and interest cards that can say what is in them.
            A bare row here would leave the app for a screen this list cannot
            describe. */}
        <View style={styles.navigation}>
          <Text style={styles.navigationLabel}>My page</Text>
          <QuietNavAction label="My campaigns" onPress={() => router.push('/campaigns')} />
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
  // MUI-7: `justifyContent: 'space-between'` with `flexGrow: 1` made the gap
  // between the hero and "My page" a function of the phone's height — flush on
  // a small screen, half a screen apart on a large one, and different again
  // once Dynamic Type grew the hero. The screen now reads top-down with one
  // spacing rule, and short content simply leaves the bottom empty.
  container: {
    flexGrow: 1,
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  eyebrow: {
    color: colors.keyword,
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
    // MUI-6: textFaint is 2.72:1 and fails WCAG 1.4.11 as a boundary;
    // borderMuted is the hairline that passes on cream and on white.
    borderTopColor: colors.borderMuted,
    borderTopWidth: strokes.trust,
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
