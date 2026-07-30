import { colors, fonts, fontSizes, spacing } from '@friendword/ui-tokens';
import { StyleSheet, Text, View } from 'react-native';

import { HypeButton, StickerCard } from '../../components';
import { clipIngestLabel, clipIngestMessage, type ClipIngestPoll } from '../../services/clipIngest';
import type { PitchClip } from '../../services/types';

type ClipIngestNoticeProps = {
  readonly clips: readonly PitchClip[];
  readonly poll: ClipIngestPoll;
  readonly checking: boolean;
  readonly onCheckNow: () => void;
};

/**
 * What the introducer is told about the videos on this pitch.
 *
 * Only rendered for clips whose bytes are on the server — a clip that is still
 * only on this device has no review to report. The copy stays inside what the
 * pipeline actually does: container/codec probe, silent proxy, poster frame, and
 * automated frame moderation. No claim about who is in the video.
 */
export function ClipIngestNotice({ clips, poll, checking, onCheckNow }: ClipIngestNoticeProps) {
  const uploaded = clips.filter((clip) => clip.upload !== undefined);
  if (uploaded.length === 0) {
    return null;
  }
  return (
    <StickerCard>
      <Text style={styles.title}>{uploaded.length === 1 ? 'Your video' : 'Your videos'}</Text>
      {uploaded.map((clip, index) => (
        <View key={clip.upload?.objectName ?? clip.uri} style={styles.clip}>
          <Text style={styles.label}>{`Video ${index + 1} — ${clipIngestLabel(clip.ingest)}`}</Text>
          <Text style={styles.message}>{clipIngestMessage(clip.ingest, poll.phase)}</Text>
        </View>
      ))}
      {poll.phase === 'settled' ? null : (
        <HypeButton
          disabled={checking}
          label={checking ? 'Checking…' : 'Check again'}
          onPress={onCheckNow}
          secondary
        />
      )}
    </StickerCard>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.lg },
  clip: { gap: spacing.xs },
  label: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.sm },
  message: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 22,
  },
});
