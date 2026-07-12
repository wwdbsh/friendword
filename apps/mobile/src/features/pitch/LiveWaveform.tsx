import { colors, radii, spacing } from '@friendword/ui-tokens';
import { StyleSheet, View } from 'react-native';

const WAVE_WEIGHTS = [0.55, 0.85, 0.68, 1, 0.72, 0.9, 0.6] as const;

type LiveWaveformProps = {
  readonly isRecording: boolean;
  readonly metering: number | undefined;
};

export function LiveWaveform({ isRecording, metering }: LiveWaveformProps) {
  const normalizedLevel = Math.min(1, Math.max(0.08, ((metering ?? -60) + 60) / 60));

  return (
    <View accessibilityLabel="Live microphone level" style={styles.waveform}>
      {WAVE_WEIGHTS.map((weight, index) => (
        <View
          key={`${weight}-${index}`}
          style={[
            styles.waveBar,
            {
              height: isRecording ? 18 + normalizedLevel * weight * 72 : 18 + weight * 18,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  waveform: {
    height: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  waveBar: {
    width: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.flirt,
  },
});
