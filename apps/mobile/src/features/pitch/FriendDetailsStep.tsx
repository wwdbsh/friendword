import { colors, fontSizes, radii, spacing, strokes } from '@friendword/ui-tokens';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { HypeButton, StickerCard } from '../../components';
import { EmailInvitationContactSchema } from '../../services/types';
import { PitchStepFrame } from './PitchStepFrame';

type FriendDetailsStepProps = {
  readonly busy: boolean;
  readonly errorMessage: string | null;
  readonly firstName: string;
  readonly contactValue: string;
  readonly onFirstNameChange: (value: string) => void;
  readonly onContactValueChange: (value: string) => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
};

export function FriendDetailsStep({
  busy,
  errorMessage,
  firstName,
  contactValue,
  onFirstNameChange,
  onContactValueChange,
  onBack,
  onContinue,
}: FriendDetailsStepProps) {
  const trimmedName = firstName.trim();
  const trimmedContact = contactValue.trim();
  const contactIsValid = EmailInvitationContactSchema.safeParse({
    kind: 'email',
    value: trimmedContact,
  }).success;
  const canContinue = trimmedName.length > 0 && contactIsValid;

  return (
    <PitchStepFrame
      track={2}
      title="Who are we hyping?"
      subtitle="We use this email to make sure only your invited friend can claim the approval link."
      onBack={onBack}
      footer={
        <View style={styles.footerContent}>
          {errorMessage ? (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {errorMessage}
            </Text>
          ) : null}
          <HypeButton
            disabled={!canContinue || busy}
            label={busy ? 'Saving…' : 'Save their details'}
            onPress={onContinue}
          />
        </View>
      }
    >
      <StickerCard>
        <View style={styles.field}>
          <Text style={styles.label}>First name</Text>
          <TextInput
            accessibilityLabel="Friend first name"
            autoCapitalize="words"
            autoComplete="name-given"
            onChangeText={onFirstNameChange}
            placeholder="Jordan"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            value={firstName}
          />
          <Text style={styles.helper}>Used as their on-screen name until they approve.</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Approval invite email</Text>
          <TextInput
            accessibilityLabel="Approval invite email"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={onContactValueChange}
            placeholder="jordan@example.com"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            value={contactValue}
          />
        </View>
      </StickerCard>
    </PitchStepFrame>
  );
}

const styles = StyleSheet.create({
  footerContent: { gap: spacing.sm },
  field: { gap: spacing.sm },
  label: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.lg },
  input: {
    minHeight: 52,
    borderColor: colors.ink,
    borderRadius: radii.sm,
    borderWidth: strokes.sticker,
    backgroundColor: colors.background,
    color: colors.ink,
    fontFamily: 'BricolageGrotesqueSemiBold',
    fontSize: fontSizes.md,
    paddingHorizontal: spacing.md,
  },
  helper: {
    color: colors.textSecondary,
    fontFamily: 'BricolageGrotesque',
    fontSize: fontSizes.sm,
  },
  error: {
    color: colors.danger,
    fontFamily: 'BricolageGrotesqueSemiBold',
    fontSize: fontSizes.sm,
    textAlign: 'center',
  },
});
