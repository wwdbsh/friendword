import {
  colors,
  fontSizes,
  gradients,
  motion,
  radii,
  spacing,
  strokes,
} from '@friendword/ui-tokens';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { HypeButton, StickerCard, useReducedMotion } from '../../components';
import type { PitchRecording } from '../../services/types';
import { LiveWaveform } from './LiveWaveform';
import { PitchStepFrame } from './PitchStepFrame';
import { usePitchRecorder } from './usePitchRecorder';

type RecordingStepProps = {
  readonly busy: boolean;
  readonly saveErrorMessage: string | null;
  readonly recording: PitchRecording | null;
  readonly onRecordingChange: (recording: PitchRecording | null) => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
};

export function RecordingStep({
  busy,
  saveErrorMessage,
  recording,
  onRecordingChange,
  onBack,
  onContinue,
}: RecordingStepProps) {
  const reducedMotion = useReducedMotion();
  const [caption, setCaption] = useState(recording?.caption ?? '');
  const idleScale = useRef(new Animated.Value(1)).current;
  const { recorderState, errorMessage, startRecording, stopRecording } = usePitchRecorder(
    recording,
    onRecordingChange,
    caption,
  );

  useEffect(() => {
    if (reducedMotion || recorderState.isRecording) {
      idleScale.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(idleScale, {
          toValue: 1.04,
          duration: motion.slow,
          useNativeDriver: true,
        }),
        Animated.timing(idleScale, {
          toValue: 1,
          duration: motion.slow,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [idleScale, recorderState.isRecording, reducedMotion]);

  const durationMillis = recorderState.isRecording
    ? recorderState.durationMillis
    : (recording?.durationMillis ?? 0);
  const isLongEnough = durationMillis >= 30_000;

  return (
    <PitchStepFrame
      track={4}
      title="Say it like only you can"
      subtitle="Record 30–60 seconds in your own voice. Tell one vivid story, not a résumé."
      onBack={onBack}
      footer={
        <View style={styles.footerContent}>
          {!isLongEnough ? (
            <Text style={styles.minimum}>Record at least 30 seconds to continue.</Text>
          ) : null}
          <HypeButton
            disabled={!recording || !isLongEnough || recorderState.isRecording || busy}
            label={busy ? 'Saving…' : 'Review the mix'}
            onPress={onContinue}
          />
        </View>
      }
    >
      <StickerCard>
        <View style={styles.recorderStage}>
          <LiveWaveform isRecording={recorderState.isRecording} metering={recorderState.metering} />

          <Animated.View style={{ transform: [{ scale: idleScale }] }}>
            <Pressable
              accessibilityLabel={recorderState.isRecording ? 'Stop recording' : 'Start recording'}
              accessibilityRole="button"
              onPress={() => {
                if (recorderState.isRecording) {
                  void stopRecording();
                } else {
                  void startRecording();
                }
              }}
              style={({ pressed }) => [
                styles.recordButton,
                pressed && !reducedMotion && styles.recordPressed,
              ]}
            >
              <LinearGradient colors={gradients.sunset} style={styles.gradient}>
                <Text style={styles.recordLabel}>
                  {recorderState.isRecording ? 'STOP' : recording ? 'RETAKE' : 'RECORD'}
                </Text>
              </LinearGradient>
            </Pressable>
          </Animated.View>

          <Text style={styles.timer}>{formatDuration(durationMillis)}</Text>
          <Text style={styles.limit}>Auto-stops at 1:00</Text>
        </View>
        <View style={styles.captionField}>
          <Text style={styles.captionLabel}>Text recap (optional)</Text>
          <Text style={styles.captionHint}>
            Say it once — AI writes your captions from the recording. Add a recap only if you plan
            to publish without AI captions.
          </Text>
          <TextInput
            accessibilityLabel="Optional text recap for the voice recording"
            multiline
            onChangeText={(value) => {
              setCaption(value);
              if (recording) {
                onRecordingChange({ ...recording, caption: value.trim() });
              }
            }}
            placeholder="Optional: the key story, used only if you publish without AI captions."
            placeholderTextColor={colors.textFaint}
            style={styles.captionInput}
            value={caption}
          />
        </View>
        {errorMessage ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {errorMessage}
          </Text>
        ) : null}
        {saveErrorMessage ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {saveErrorMessage}
          </Text>
        ) : null}
      </StickerCard>
    </PitchStepFrame>
  );
}

function formatDuration(durationMillis: number): string {
  const totalSeconds = Math.min(60, Math.floor(durationMillis / 1000));
  return `0:${totalSeconds.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  footerContent: { gap: spacing.sm },
  minimum: {
    color: colors.danger,
    fontFamily: 'BricolageGrotesqueSemiBold',
    fontSize: fontSizes.sm,
    textAlign: 'center',
  },
  recorderStage: {
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.stage,
    padding: spacing.lg,
  },
  recordButton: {
    width: 132,
    height: 132,
    overflow: 'hidden',
    borderColor: colors.stageText,
    borderRadius: radii.pill,
    borderWidth: strokes.sticker,
  },
  recordPressed: { transform: [{ scale: 0.97 }] },
  gradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  recordLabel: {
    color: colors.onPop,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.md,
  },
  timer: { color: colors.stageText, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.xl },
  limit: {
    color: colors.stageTextSecondary,
    fontFamily: 'BricolageGrotesque',
    fontSize: fontSizes.sm,
  },
  captionField: { gap: spacing.sm },
  captionLabel: {
    color: colors.ink,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.md,
  },
  captionHint: {
    // MUI-6: textFaint is the placeholder/disabled fill (2.72:1). A hint people
    // are meant to read is textSecondary.
    color: colors.textSecondary,
    fontFamily: 'BricolageGrotesque',
    fontSize: fontSizes.sm,
  },
  captionInput: {
    minHeight: 112,
    borderColor: colors.ink,
    borderRadius: radii.sm,
    borderWidth: strokes.sticker,
    backgroundColor: colors.background,
    color: colors.ink,
    fontFamily: 'BricolageGrotesque',
    fontSize: fontSizes.md,
    padding: spacing.md,
    textAlignVertical: 'top',
  },
  error: { color: colors.danger, fontFamily: 'BricolageGrotesqueSemiBold', fontSize: fontSizes.sm },
});
