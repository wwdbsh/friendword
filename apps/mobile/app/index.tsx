import { colors, fonts, fontSizes, spacing, tilts } from '@friendword/ui-tokens';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HypeButton, StickerCard } from '../src/components';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.hero}>
          <View style={styles.hypeBadge}>
            <Text style={styles.hypeBadgeText}>YOUR FRIEND IS YOUR HYPE PERSON</Text>
          </View>
          <Text style={styles.title}>Friendword</Text>
          <Text style={styles.subtitle}>Dating, in your friends&apos; words.</Text>
        </View>

        <StickerCard>
          <Text style={styles.cardEyebrow}>START A NEW MIX</Text>
          <Text style={styles.cardTitle}>Put your best friend on the record.</Text>
          <Text style={styles.cardBody}>
            Five quick tracks. One voice note. A dating pitch only a real friend could make.
          </Text>
          <HypeButton label="Pitch a friend" onPress={() => router.push('/pitch/new')} />
        </StickerCard>

        <View style={styles.actions}>
          <HypeButton
            label="My dating campaigns"
            onPress={() => router.push('/campaigns')}
            secondary
          />
          <HypeButton label="My interests" onPress={() => router.push('/interests')} secondary />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, justifyContent: 'space-between', gap: spacing.lg, padding: spacing.lg },
  hero: { gap: spacing.sm, paddingTop: spacing.md },
  hypeBadge: {
    alignSelf: 'flex-start',
    transform: [{ rotate: `${tilts[0]}deg` }],
    backgroundColor: colors.hype,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  hypeBadgeText: {
    color: colors.onHype,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.xs,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: fontSizes.hero,
    letterSpacing: -1.5,
  },
  subtitle: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: fontSizes.lg },
  cardEyebrow: {
    color: colors.pop,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.xs,
    letterSpacing: 1,
  },
  cardTitle: {
    color: colors.ink,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.xl,
    lineHeight: 31,
  },
  cardBody: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 24,
  },
  actions: { gap: spacing.md },
});
