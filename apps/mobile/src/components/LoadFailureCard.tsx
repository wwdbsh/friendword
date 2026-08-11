import { colors, fonts, fontSizes } from '@friendword/ui-tokens';
import { StyleSheet, Text } from 'react-native';

import { HypeButton } from './HypeButton';
import { TrustCard } from './TrustCard';

type LoadFailureCardProps = {
  readonly title: string;
  readonly message: string;
  /** Runs the same read that failed. Required — that is the whole point. */
  readonly onRetry: () => void;
  readonly retryLabel?: string;
};

/**
 * A list section that could not be read (T014, audit MUI-13).
 *
 * Every one of these cards used to end with "Check your connection and reopen
 * this screen." — an instruction to perform navigation by hand for something
 * the screen can do in one line, and one that is wrong on a screen reached by a
 * tab where "reopening" is not obvious. The read is already a callback; the
 * card now offers it.
 *
 * The copy no longer tells anyone to leave. It says what failed and what
 * pressing the button will do, which is all this screen actually knows.
 */
export function LoadFailureCard({
  title,
  message,
  onRetry,
  retryLabel = 'Try again',
}: LoadFailureCardProps) {
  return (
    <TrustCard tone="danger">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <HypeButton label={retryLabel} onPress={onRetry} secondary variant="trust" />
    </TrustCard>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.lg },
  message: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: fontSizes.md * 1.45,
  },
});
