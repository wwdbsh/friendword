import { colors, fonts, fontSizes, spacing } from '@friendword/ui-tokens';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HypeButton, StickerCard } from '../../src/components';
import { pitchDraftService } from '../../src/services/draftServiceInstance';
import type { PitchDraft } from '../../src/services/types';

export default function CampaignsScreen() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<readonly PitchDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      pitchDraftService
        .getMyDrafts()
        .then((savedDrafts) => {
          if (active) {
            setDrafts(savedDrafts);
            setErrorMessage(null);
          }
        })
        .catch((error: unknown) => {
          if (!active) {
            return;
          }
          if (error instanceof Error) {
            setErrorMessage('Your saved pitches could not be loaded.');
            return;
          }
          throw error;
        })
        .finally(() => {
          if (active) {
            setLoading(false);
          }
        });

      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>THE FRIENDWORD CATALOG</Text>
          <Text style={styles.title}>My dating campaigns</Text>
          <Text style={styles.subtitle}>Drafts and approval requests you started for friends.</Text>
        </View>

        {loading ? <Text style={styles.message}>Loading your mixes…</Text> : null}
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        {!loading && !errorMessage && drafts.length === 0 ? (
          <StickerCard>
            <Text style={styles.emptyTitle}>No mixes on deck yet.</Text>
            <Text style={styles.message}>
              Think of a friend whose story deserves to be told by someone who knows it.
            </Text>
            <HypeButton label="Pitch a friend" onPress={() => router.push('/pitch/new')} />
          </StickerCard>
        ) : null}

        {drafts.map((draft) => (
          <StickerCard key={draft.id}>
            <View style={styles.draftHeader}>
              <Text style={styles.friendName}>
                {draft.relationship?.friendFirstName ?? 'Untitled pitch'}
              </Text>
              <View style={styles.statusBadge}>
                <Text style={styles.status}>{formatStatus(draft.status)}</Text>
              </View>
            </View>
            <Text style={styles.message}>
              {draft.relationship
                ? `${draft.relationship.kind} · ${draft.relationship.duration}`
                : 'Relationship details still in progress'}
            </Text>
            <Text style={styles.meta}>
              {draft.photos.length} photo{draft.photos.length === 1 ? '' : 's'} ·{' '}
              {draft.recording ? formatDuration(draft.recording.durationMillis) : 'No voice track'}
            </Text>
          </StickerCard>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function formatStatus(status: PitchDraft['status']): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'consent_pending':
      return 'Approval queued (mock)';
    case 'changes_requested':
      return 'Changes requested';
    case 'approved':
      return 'Approved';
    case 'published':
      return 'Live';
    case 'paused':
      return 'Paused';
    case 'expired':
      return 'Expired';
    case 'archived':
      return 'Archived';
    case 'deleted':
      return 'Deleted';
    default:
      return assertNever(status);
  }
}

function formatDuration(durationMillis: number): string {
  return `${Math.floor(durationMillis / 1000)} sec voice track`;
}

function assertNever(value: never): never {
  return value;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  heading: { gap: spacing.sm },
  eyebrow: {
    color: colors.pop,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.xs,
    letterSpacing: 1,
  },
  title: { color: colors.ink, fontFamily: fonts.display, fontSize: fontSizes.xl, lineHeight: 32 },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 24,
  },
  emptyTitle: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.lg },
  message: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 24,
  },
  error: { color: colors.danger, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.md },
  draftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  friendName: {
    flex: 1,
    color: colors.ink,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.lg,
  },
  statusBadge: {
    backgroundColor: colors.hype,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  status: { color: colors.onHype, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.xs },
  meta: { color: colors.fresh, fontFamily: 'BricolageGrotesqueSemiBold', fontSize: fontSizes.sm },
});
