import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  colors,
  fonts,
  fontSizes,
  maxControlFontScale,
  radii,
  spacing,
  strokes,
} from '@friendword/ui-tokens';

import {
  DISPLAY_NAME_MAX_LENGTH,
  displayNameProblemMessage,
  validateDisplayName,
} from './displayNameConfirmation';

type DisplayNameSheetProps = {
  readonly visible: boolean;
  readonly busy: boolean;
  readonly errorMessage: string | null;
  readonly onClose: () => void;
  readonly onConfirm: (name: string) => void;
  /** Defaults to the pitch-submit wording; the account screen sets its own. */
  readonly confirmLabel?: string;
};

/**
 * "What should your friend see?" — asked once, right before the pitch goes.
 *
 * T002 (Issue #71). The field starts EMPTY on purpose. The stored value at
 * this point is the email local-part `handle_new_auth_user` (0011) invented,
 * and prefilling it would turn "we never published a name you did not choose"
 * into "we published the one you did not bother to delete". An empty field
 * asks the question; a prefilled one answers it for you.
 *
 * Surface follows SignInSheet: the same modal shell, the same tokens, the same
 * scrolling content so the error text and the way out stay reachable with the
 * keyboard up.
 */
export function DisplayNameSheet({
  visible,
  busy,
  errorMessage,
  onClose,
  onConfirm,
  confirmLabel = 'Save and send pitch',
}: DisplayNameSheetProps) {
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);

  // Clears on every close — the parent closes this sheet after a SUCCESSFUL
  // save too, and a name left in the field would reappear the next time
  // somebody opened it to change it.
  useEffect(() => {
    if (!visible) {
      setName('');
      setTouched(false);
    }
  }, [visible]);

  const problem = validateDisplayName(name);
  // The empty state is the field's resting state, so it is not an error until
  // the person has tried to send. Too-long is shown as it happens.
  const inlineProblem = problem === 'too_long' || (touched && problem !== null) ? problem : null;

  const handleClose = (): void => {
    setName('');
    setTouched(false);
    onClose();
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Close name entry"
          accessibilityRole="button"
          disabled={busy}
          style={styles.backdropDismiss}
          onPress={handleClose}
        />
        <View style={styles.sheet}>
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.badge}>
              <Text maxFontSizeMultiplier={maxControlFontScale} style={styles.badgeText}>
                One last thing
              </Text>
            </View>
            <Text style={styles.title}>What should we call you?</Text>
            <Text style={styles.subtitle}>
              This is the name on the pitch — your friend sees it when they approve it, and so does
              anyone they share their page with. Use whatever you would want them to read.
            </Text>

            <TextInput
              accessibilityLabel="Your name"
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus
              editable={!busy}
              // No maxLength: silently swallowing the 61st character looks like
              // a broken keyboard. The count is shown and the error names it.
              placeholder="Your name"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              value={name}
              onChangeText={setName}
            />

            {inlineProblem === null ? null : (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {displayNameProblemMessage(inlineProblem)}
                {inlineProblem === 'too_long'
                  ? ` (${name.trim().length}/${DISPLAY_NAME_MAX_LENGTH})`
                  : ''}
              </Text>
            )}
            {errorMessage === null ? null : (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {errorMessage}
              </Text>
            )}

            <Pressable
              accessibilityRole="button"
              disabled={busy}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && !busy && styles.primaryButtonPressed,
                busy && styles.primaryButtonDisabled,
              ]}
              onPress={() => {
                setTouched(true);
                if (validateDisplayName(name) !== null) {
                  return;
                }
                onConfirm(name.trim());
              }}
            >
              {busy ? (
                <ActivityIndicator color={colors.onPop} />
              ) : (
                <Text maxFontSizeMultiplier={maxControlFontScale} style={styles.primaryButtonText}>
                  {confirmLabel}
                </Text>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={busy}
              style={styles.secondaryButton}
              onPress={handleClose}
            >
              <Text style={styles.secondaryAction}>Not now</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(34, 27, 21, 0.55)', justifyContent: 'flex-end' },
  backdropDismiss: { flex: 1 },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: strokes.sticker,
    borderBottomWidth: 0,
    borderColor: colors.ink,
  },
  sheetContent: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.xl },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.hype,
    borderColor: colors.ink,
    borderRadius: radii.pill,
    borderWidth: strokes.sticker,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    transform: [{ rotate: '-2deg' }],
  },
  badgeText: {
    color: colors.onHype,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.sm,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: fontSizes.xl,
    lineHeight: fontSizes.xl * 1.25,
  },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: fontSizes.md * 1.45,
  },
  input: {
    minHeight: 52,
    backgroundColor: colors.surface,
    borderColor: colors.ink,
    borderRadius: radii.md,
    borderWidth: strokes.sticker,
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  error: {
    color: colors.danger,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.sm,
  },
  primaryButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.pop,
    borderColor: colors.ink,
    borderRadius: radii.md,
    borderWidth: strokes.sticker,
    paddingVertical: spacing.md,
    shadowColor: colors.ink,
    shadowOffset: { width: spacing.xs, height: spacing.xs },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: spacing.xs,
  },
  primaryButtonPressed: { backgroundColor: colors.popPressed, transform: [{ scale: 0.97 }] },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: {
    color: colors.onPop,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.md,
  },
  secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryAction: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
});
