import { colors, fonts, fontSizes, motion, radii, spacing, strokes } from '@friendword/ui-tokens';
import type { PropsWithChildren, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useReducedMotion } from '../../components';

type PitchStepFrameProps = PropsWithChildren<{
  readonly track: number;
  readonly title: string;
  readonly subtitle: string;
  readonly footer: ReactNode;
  readonly onBack: () => void;
}>;

export function PitchStepFrame({
  track,
  title,
  subtitle,
  footer,
  onBack,
  children,
}: PitchStepFrameProps) {
  const reducedMotion = useReducedMotion();
  const entrance = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reducedMotion) {
      entrance.setValue(1);
      return;
    }

    entrance.setValue(0);
    const animation = Animated.timing(entrance, {
      toValue: 1,
      duration: motion.slow,
      easing: Easing.bezier(...motion.bounce),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [entrance, reducedMotion]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" hitSlop={12} onPress={onBack}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <View style={styles.trackBadge}>
            <Text style={styles.track}>Track {track} of 5</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View
            style={[
              styles.content,
              {
                opacity: entrance,
                transform: [
                  {
                    translateY: entrance.interpolate({
                      inputRange: [0, 1],
                      outputRange: [spacing.lg, 0],
                    }),
                  },
                  {
                    scale: entrance.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.97, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.heading}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            {children}
          </Animated.View>
        </ScrollView>

        {footer === null ? null : <View style={styles.footer}>{footer}</View>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  keyboardView: { flex: 1 },
  topBar: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  back: {
    color: colors.ink,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.md,
  },
  trackBadge: {
    transform: [{ rotate: '2deg' }],
    borderColor: colors.ink,
    borderRadius: radii.pill,
    borderWidth: strokes.sticker,
    backgroundColor: colors.hype,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  track: {
    color: colors.onHype,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.sm,
  },
  scrollContent: { flexGrow: 1, padding: spacing.lg },
  content: { flex: 1, gap: spacing.lg },
  heading: { gap: spacing.sm },
  title: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: fontSizes.xl,
    lineHeight: fontSizes.xl * 1.2,
  },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: fontSizes.md * 1.45,
  },
  footer: {
    borderTopColor: colors.ink,
    borderTopWidth: strokes.sticker,
    backgroundColor: colors.background,
    padding: spacing.md,
    paddingHorizontal: spacing.lg,
  },
});
