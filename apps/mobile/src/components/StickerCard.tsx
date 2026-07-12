import { colors, radii, spacing, strokes } from '@friendword/ui-tokens';
import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

const stickerShadow: ViewStyle = {
  shadowColor: colors.ink,
  shadowOffset: { width: spacing.xs, height: spacing.xs },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: spacing.xs,
};

export function StickerCard({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    ...stickerShadow,
    gap: spacing.md,
    borderColor: colors.ink,
    borderRadius: radii.md,
    borderWidth: strokes.sticker,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
});
