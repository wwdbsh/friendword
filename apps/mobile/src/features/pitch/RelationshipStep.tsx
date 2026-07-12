import { fontSizes, spacing } from '@friendword/ui-tokens';
import { StyleSheet, Text, View } from 'react-native';

import { HypeButton, StickerCard } from '../../components';
import {
  RELATIONSHIP_DURATIONS,
  RELATIONSHIP_KINDS,
  type RelationshipDuration,
  type RelationshipKind,
} from '../../services/types';
import { OptionChip } from './OptionChip';
import { PitchStepFrame } from './PitchStepFrame';

type RelationshipStepProps = {
  readonly kind: RelationshipKind | null;
  readonly duration: RelationshipDuration | null;
  readonly onKindChange: (kind: RelationshipKind) => void;
  readonly onDurationChange: (duration: RelationshipDuration) => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
};

export function RelationshipStep({
  kind,
  duration,
  onKindChange,
  onDurationChange,
  onBack,
  onContinue,
}: RelationshipStepProps) {
  return (
    <PitchStepFrame
      track={1}
      title="How do you know them?"
      subtitle="Give their future matches the context only a real friend can bring."
      onBack={onBack}
      footer={<HypeButton disabled={!kind || !duration} label="Next track" onPress={onContinue} />}
    >
      <StickerCard>
        <Text style={styles.label}>Your relationship</Text>
        <View style={styles.chips}>
          {RELATIONSHIP_KINDS.map((option, index) => (
            <OptionChip
              key={option}
              label={option}
              selected={kind === option}
              tiltIndex={index}
              onPress={() => onKindChange(option)}
            />
          ))}
        </View>
      </StickerCard>

      <StickerCard>
        <Text style={styles.label}>How long have you known them?</Text>
        <View style={styles.chips}>
          {RELATIONSHIP_DURATIONS.map((option, index) => (
            <OptionChip
              key={option}
              label={option}
              selected={duration === option}
              tiltIndex={index + 1}
              onPress={() => onDurationChange(option)}
            />
          ))}
        </View>
      </StickerCard>
    </PitchStepFrame>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.lg,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
