import type { PitchStructure } from '@friendword/contracts';
import { colors, fonts, fontSizes, radii, spacing, strokes } from '@friendword/ui-tokens';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HypeButton, StickerCard } from '../../components';
import type { PitchReview } from '../../services/types';

type PitchReviewEditorProps = {
  readonly friendName: string;
  readonly review: PitchReview;
  readonly busy: boolean;
  readonly errorMessage: string | null;
  readonly onChange: (review: PitchReview) => void;
  readonly onSubmit: () => void;
};

export function PitchReviewEditor({
  friendName,
  review,
  busy,
  errorMessage,
  onChange,
  onSubmit,
}: PitchReviewEditorProps) {
  const complete = review.headline.trim() !== '' && review.body.trim() !== '';
  const updateStructure = (structure: PitchStructure): void => {
    onChange({ ...review, structure });
  };
  const updateQuality = (index: 0 | 1 | 2, value: string): void => {
    const qualities = [...review.structure.three_specific_qualities];
    qualities[index] = value;
    updateStructure({ ...review.structure, three_specific_qualities: qualities });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>REVIEW BEFORE SENDING</Text>
          <Text style={styles.title}>Shape {friendName}’s story</Text>
          <Text style={styles.subtitle}>
            This is your draft, not a final verdict. Edit every line before asking {friendName} to
            review it.
          </Text>
        </View>

        {review.generationMode === 'manual' ? (
          <StickerCard>
            <Text style={styles.cardTitle}>Write it in your own words</Text>
            <Text style={styles.message}>
              AI drafting unlocks once an OpenAI key is set.{`\n`}You can write it yourself.
            </Text>
          </StickerCard>
        ) : null}

        {review.responseNote ? (
          <StickerCard>
            <Text style={styles.noteTitle}>{friendName} asked for changes</Text>
            <Text style={styles.message}>{review.responseNote}</Text>
          </StickerCard>
        ) : null}

        <StickerCard>
          <Field
            label="Headline"
            value={review.headline}
            onChangeText={(headline) => onChange({ ...review, headline })}
          />
          <Field
            label="Pitch body"
            value={review.body}
            multiline
            onChangeText={(body) => onChange({ ...review, body })}
          />
        </StickerCard>

        <StickerCard>
          <Text style={styles.cardTitle}>Structured story notes</Text>
          <Field
            label="Hook"
            value={review.structure.hook}
            onChangeText={(hook) => updateStructure({ ...review.structure, hook })}
          />
          <Field
            label="Relationship context"
            value={review.structure.relationship_context}
            multiline
            onChangeText={(relationship_context) =>
              updateStructure({ ...review.structure, relationship_context })
            }
          />
          {review.structure.three_specific_qualities.map((quality, index) => (
            <Field
              key={`quality-${index + 1}`}
              label={`Specific quality ${index + 1}`}
              value={quality}
              onChangeText={(value) => {
                if (index === 0 || index === 1 || index === 2) {
                  updateQuality(index, value);
                }
              }}
            />
          ))}
          <Field
            label="Evidence or anecdote"
            value={review.structure.evidence_or_anecdote}
            multiline
            onChangeText={(evidence_or_anecdote) =>
              updateStructure({ ...review.structure, evidence_or_anecdote })
            }
          />
          <Field
            label="A good match for"
            value={review.structure.good_match_for}
            multiline
            onChangeText={(good_match_for) =>
              updateStructure({ ...review.structure, good_match_for })
            }
          />
        </StickerCard>

        <StickerCard>
          <Text style={styles.cardTitle}>Claims for {friendName} to confirm</Text>
          <Text style={styles.message}>
            Remove anything that is private, uncertain, or unnecessary before sending.
          </Text>
          {review.structure.hard_claims_requiring_confirmation.length === 0 ? (
            <Text style={styles.empty}>No hard claims included.</Text>
          ) : null}
          {review.structure.hard_claims_requiring_confirmation.map((claim, index) => (
            <View key={`${claim}-${index}`} style={styles.claim}>
              <Text style={styles.claimText}>{claim}</Text>
              <HypeButton
                label={`Remove claim ${index + 1}`}
                onPress={() =>
                  updateStructure({
                    ...review.structure,
                    hard_claims_requiring_confirmation:
                      review.structure.hard_claims_requiring_confirmation.filter(
                        (_, claimIndex) => claimIndex !== index,
                      ),
                  })
                }
                secondary
              />
            </View>
          ))}
        </StickerCard>

        {!complete ? (
          <Text style={styles.error}>Add both a headline and body before sending.</Text>
        ) : null}
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
        <HypeButton
          disabled={!complete || busy}
          label={busy ? 'Sending…' : 'Send for approval'}
          onPress={onSubmit}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

type FieldProps = {
  readonly label: string;
  readonly value: string;
  readonly multiline?: boolean;
  readonly onChangeText: (value: string) => void;
};

function Field({ label, value, multiline = false, onChangeText }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={`Add ${label.toLowerCase()}`}
        placeholderTextColor={colors.textFaint}
        style={[styles.input, multiline && styles.multiline]}
        value={value}
      />
    </View>
  );
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
  title: { color: colors.ink, fontFamily: fonts.display, fontSize: fontSizes.xl, lineHeight: 34 },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 24,
  },
  cardTitle: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.lg },
  noteTitle: { color: colors.fresh, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.lg },
  message: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 22,
  },
  field: { gap: spacing.xs },
  label: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.sm },
  input: {
    minHeight: 48,
    borderColor: colors.ink,
    borderRadius: radii.sm,
    borderWidth: strokes.sticker,
    backgroundColor: colors.background,
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  multiline: { minHeight: 112, textAlignVertical: 'top' },
  claim: {
    gap: spacing.sm,
    borderLeftColor: colors.hype,
    borderLeftWidth: spacing.xs,
    paddingLeft: spacing.md,
  },
  claimText: { color: colors.ink, fontFamily: fonts.body, fontSize: fontSizes.md, lineHeight: 22 },
  empty: { color: colors.fresh, fontFamily: 'BricolageGrotesqueSemiBold', fontSize: fontSizes.sm },
  error: { color: colors.danger, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.sm },
});
