import { colors, fonts, fontSizes } from '@friendword/ui-tokens';
import { StyleSheet, Text } from 'react-native';

import { HypeButton, QuietNavAction, TrustCard } from '../../components';

export type AiConsentUiState = 'checking' | 'required' | 'existing' | 'error';

type AiConsentDisclosureProps = {
  readonly state: AiConsentUiState;
  readonly busy: boolean;
  readonly errorMessage: string | null;
  readonly onCreateAiDraft: () => void;
  readonly onRetry: () => void;
  readonly onWriteManually: () => void;
};

export function AiConsentDisclosure({
  state,
  busy,
  errorMessage,
  onCreateAiDraft,
  onRetry,
  onWriteManually,
}: AiConsentDisclosureProps) {
  if (state === 'checking') {
    return (
      <TrustCard>
        <Text style={styles.title}>Checking AI processing consent</Text>
        <Text style={styles.body}>No external AI request has started.</Text>
        <HypeButton disabled label="Checking…" onPress={onRetry} variant="trust" />
        <QuietNavAction disabled={busy} label="Write it myself" onPress={onWriteManually} />
      </TrustCard>
    );
  }

  if (state === 'error') {
    return (
      <TrustCard tone="danger">
        <Text style={styles.title}>AI draft is unavailable</Text>
        <Text style={styles.body}>{errorMessage ?? 'No external AI request was started.'}</Text>
        <HypeButton
          disabled={busy}
          label={busy ? 'Checking…' : 'Try again'}
          onPress={onRetry}
          variant="trust"
        />
        <QuietNavAction disabled={busy} label="Write it myself" onPress={onWriteManually} />
      </TrustCard>
    );
  }

  if (state === 'existing') {
    return (
      <TrustCard>
        <Text style={styles.title}>AI processing consent recorded</Text>
        <Text style={styles.body}>
          This draft already has consent for the current disclosure revision.
        </Text>
        <HypeButton
          disabled={busy}
          label={busy ? 'Creating the AI draft…' : 'Create the AI draft'}
          onPress={onCreateAiDraft}
          variant="trust"
        />
        <QuietNavAction disabled={busy} label="Write it myself" onPress={onWriteManually} />
      </TrustCard>
    );
  }

  return (
    <TrustCard>
      <Text style={styles.title}>Before AI drafts this pitch</Text>
      <Text style={styles.body}>
        Your recording and photos are always saved to Friendword’s private storage first — that step
        alone never sends anything to an outside company.
      </Text>
      <Text style={styles.body}>
        Only if you agree here will this recording and any photos then be sent to an external AI
        provider, currently OpenAI, to transcribe, structure, and moderate the pitch. If you choose
        “Write it myself” instead, nothing goes to that provider.
      </Text>
      <Text style={styles.body}>
        The content is used only to build this draft. Your friend reviews it and can delete
        everything before anything goes public.
      </Text>
      <Text style={styles.body}>
        By continuing, you confirm that you have your friend’s permission to share their photos and
        story.
      </Text>
      <HypeButton
        disabled={busy}
        label={busy ? 'Recording consent…' : 'I agree — create the AI draft'}
        onPress={onCreateAiDraft}
        variant="trust"
      />
      <QuietNavAction disabled={busy} label="Write it myself" onPress={onWriteManually} />
    </TrustCard>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.lg },
  body: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: fontSizes.md * 1.45,
  },
});
