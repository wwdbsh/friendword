import {
  colors,
  fontSizes,
  lineHeights,
  motion,
  radii,
  shadows,
  spacing,
  strokes,
} from '@friendword/ui-tokens';

export const themeCss = `
:root {
  --color-background: ${colors.background};
  --color-surface: ${colors.surface};
  --color-stage: ${colors.stage};
  --color-ink: ${colors.ink};
  --color-text-secondary: ${colors.textSecondary};
  --color-text-faint: ${colors.textFaint};
  --color-stage-text: ${colors.stageText};
  --color-stage-text-secondary: ${colors.stageTextSecondary};
  --color-pop: ${colors.pop};
  --color-pop-pressed: ${colors.popPressed};
  --color-flirt: ${colors.flirt};
  --color-hype: ${colors.hype};
  --color-fresh: ${colors.fresh};
  --color-danger: ${colors.danger};
  --color-on-pop: ${colors.onPop};
  --color-on-hype: ${colors.onHype};
  --font-size-xs: ${fontSizes.xs}px;
  --font-size-sm: ${fontSizes.sm}px;
  --font-size-md: ${fontSizes.md}px;
  --font-size-lg: ${fontSizes.lg}px;
  --font-size-xl: ${fontSizes.xl}px;
  --font-size-display: ${fontSizes.display}px;
  --font-size-hero: ${fontSizes.hero}px;
  --line-tight: ${lineHeights.tight};
  --line-normal: ${lineHeights.normal};
  --line-relaxed: ${lineHeights.relaxed};
  --space-xs: ${spacing.xs}px;
  --space-sm: ${spacing.sm}px;
  --space-md: ${spacing.md}px;
  --space-lg: ${spacing.lg}px;
  --space-xl: ${spacing.xl}px;
  --space-xxl: ${spacing.xxl}px;
  --radius-sm: ${radii.sm}px;
  --radius-md: ${radii.md}px;
  --radius-lg: ${radii.lg}px;
  --radius-pill: ${radii.pill}px;
  --motion-fast: ${motion.fast}ms;
  --motion-normal: ${motion.normal}ms;
  --motion-slow: ${motion.slow}ms;
  --motion-stagger: ${motion.stagger}ms;
  --motion-bounce: cubic-bezier(${motion.bounce.join(',')});
  --motion-ease-out: cubic-bezier(${motion.easeOut.join(',')});
  --shadow-sticker: ${shadows.sticker};
  --shadow-sticker-sm: ${shadows.stickerSm};
  --shadow-card: ${shadows.card};
  --stroke-sticker: ${strokes.sticker}px;
}
`;
