import { colors, fonts, fontSizes } from '@friendword/ui-tokens';
import { StyleSheet, Text } from 'react-native';

import { HypeButton } from './HypeButton';
import { TrustCard } from './TrustCard';

type SignInPromptCardProps = {
  readonly title: string;
  readonly message: string;
  readonly onSignIn: () => void;
};

/**
 * Trust Layer card for signed-out surfaces (campaigns, live pitches, interests).
 * These states used to be dead ends — the card explained why data was hidden but
 * gave no way to sign in. It now carries a real sign-in action so the account
 * gate is reachable from every list, wired to the shared SignInSheet.
 */
export function SignInPromptCard({ title, message, onSignIn }: SignInPromptCardProps) {
  return (
    <TrustCard>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <HypeButton label="Sign in" onPress={onSignIn} variant="trust" />
    </TrustCard>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.lg },
  message: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 24,
  },
});
