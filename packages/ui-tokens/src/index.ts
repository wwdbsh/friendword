/**
 * Friendword design tokens — "Hype Mixtape".
 *
 * Your friend is your hype person. The UI feels like a zine your best friend
 * made about you: warm cream paper, punchy tangerine/hot-pink/sunshine
 * stickers with bold ink outlines, bouncy motion, waveforms that jump.
 * Active and funky — never moody, never corporate, never a neon Tinder clone.
 * Full direction: docs/DESIGN.md (change there first, then here).
 *
 * Values are platform-agnostic (React Native + web).
 */

export const colors = {
  /** Warm cream paper — the app's canvas. */
  background: '#FFF6EA',
  /** Cards on cream. */
  surface: '#FFFFFF',
  /** Ink stage — dark blocks (pitch player, media). Warm, not pure black. */
  stage: '#201914',
  /** Bold ink — outlines, primary text. */
  ink: '#221B15',
  /** Secondary text on cream. */
  textSecondary: '#6E6259',
  /** Tertiary/disabled on cream. */
  textFaint: '#A2958A',
  /** Text on the ink stage. */
  stageText: '#FFF6EA',
  /** Muted text on the ink stage. */
  stageTextSecondary: '#C9BCAE',

  /** Tangerine — primary action, energy. */
  pop: '#FF5B2E',
  /** Pressed tangerine. */
  popPressed: '#E24417',
  /** Hot pink — romance, flirt moments, waveforms. */
  flirt: '#FF3D8A',
  /** Sunshine yellow — hype badges, vouch highlights. */
  hype: '#FFC63F',
  /** Teal — verified, safety, success. */
  fresh: '#17B89B',
  /** Danger/report. */
  danger: '#E5484D',
  /** Text on pop/flirt fills. */
  onPop: '#FFF9F2',
  /** Text on hype (yellow) fills. */
  onHype: '#221B15',
} as const;

/** Signature gradients — use boldly but on one hero element per screen. */
export const gradients = {
  /** Tangerine → hot pink. Primary brand moment (record button, CTA). */
  sunset: ['#FF5B2E', '#FF3D8A'],
  /** Sunshine → tangerine. Hype accents, badges. */
  hype: ['#FFC63F', '#FF5B2E'],
} as const;

/**
 * Typography.
 * - Display: Unbounded — wide, loud, unmistakable. Wordmark, hero titles,
 *   big numbers. Use sparingly at large sizes.
 * - Body/UI: Bricolage Grotesque — characterful grotesque with real charm.
 * Mobile: @expo-google-fonts/unbounded + @expo-google-fonts/bricolage-grotesque.
 * Web: next/font/google.
 */
export const fonts = {
  display: 'Unbounded',
  body: 'BricolageGrotesque',
} as const;

export const fontSizes = {
  xs: 12,
  sm: 14,
  md: 17,
  lg: 20,
  xl: 26,
  display: 32,
  hero: 42,
} as const;

export const lineHeights = {
  tight: 1.1,
  normal: 1.45,
  relaxed: 1.6,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
  xxl: 64,
} as const;

/** Chunky, friendly corners. */
export const radii = {
  sm: 12,
  md: 20,
  lg: 32,
  pill: 999,
} as const;

/**
 * Motion: bouncy and alive. Entrances overshoot slightly; stickers tilt in.
 * Respect prefers-reduced-motion everywhere.
 */
export const motion = {
  fast: 140,
  normal: 240,
  slow: 420,
  /** Springy overshoot for entrances and toggles (CSS cubic-bezier). */
  bounce: [0.34, 1.56, 0.64, 1] as const,
  /** Soft landing for exits/scrubs. */
  easeOut: [0.22, 1, 0.36, 1] as const,
  /** Stagger interval for load reveals (ms). */
  stagger: 90,
} as const;

/** Sticker tilt angles (degrees) — alternate for collage energy. */
export const tilts = [-3, 2, -1.5, 2.5] as const;

/** Shadows: hard "sticker" offset for funky elements, soft for cards. */
export const shadows = {
  /** Hard ink offset — the signature sticker look (web box-shadow). */
  sticker: '4px 4px 0 #221B15',
  stickerSm: '2px 2px 0 #221B15',
  /** Soft ambient card shadow. */
  card: '0 8px 24px rgba(34, 27, 21, 0.10)',
} as const;

/** Standard ink outline width for sticker elements. */
export const strokes = {
  sticker: 2,
} as const;
