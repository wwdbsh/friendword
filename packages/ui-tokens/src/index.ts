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
  /**
   * Placeholder/disabled fills ONLY (2.72:1 on cream, 2.92:1 on white — below
   * AA text AND below the 3:1 WCAG 1.4.11 non-text threshold). Never use for
   * readable copy, fine print, OR borders/boundaries; use textSecondary for
   * text and borderMuted for hairlines (audit D-P0, third audit §8).
   */
  textFaint: '#A2958A',
  /**
   * Trust Layer neutral hairline (3.73:1 on cream, 3.99:1 on white — passes
   * WCAG 1.4.11 non-text 3:1 on both canvases). Replaces textFaint as the
   * TrustCard / QuietNavAction border. Not for readable text.
   */
  borderMuted: '#8A7D73',
  /**
   * Trust Layer success/verified border (3.77:1 on cream, 4.03:1 on white).
   * Darker teal than `fresh` (which is 2.35:1 as a border and fails 3:1);
   * use this for TrustCard success boundaries, `fresh` only for fills/icons.
   */
  borderSuccess: '#0E8F76',
  /** Text on the ink stage. */
  stageText: '#FFF6EA',
  /** Muted text on the ink stage. */
  stageTextSecondary: '#C9BCAE',

  /** Tangerine — primary action, energy. */
  pop: '#FF5B2E',
  /** Pressed tangerine (ink text stays >=4.5:1 in the pressed state too). */
  popPressed: '#E8501F',
  /**
   * Readable tangerine — the caption keyword accent (T017). Same hue as `pop`,
   * darkened until it passes WCAG AA as TEXT on both canvases (4.71:1 on cream,
   * 5.04:1 on white); `pop` itself measures 2.89:1 on cream and must never be
   * used for readable copy. Fills and icons still use `pop`.
   */
  keyword: '#C24523',
  /** Hot pink — romance, flirt moments, waveforms. */
  flirt: '#FF3D8A',
  /** Sunshine yellow — hype badges, vouch highlights. */
  hype: '#FFC63F',
  /** Teal — verified, safety, success. Fill and icon only, never readable copy. */
  fresh: '#17B89B',
  /**
   * Readable teal — the verified/success accent when the token has to carry
   * TEXT (T014, MUI-6). Same signal as `fresh`, darkened until it passes WCAG
   * AA as normal text on both canvases (4.93:1 on cream, 5.27:1 on white);
   * `fresh` itself measures 2.35:1 on cream. Fills and icons still use `fresh`,
   * boundaries still use `borderSuccess`.
   */
  verified: '#0B7A64',
  /**
   * Danger/report. Dark enough that cream text passes 4.5:1 as a fill and
   * the color itself passes as text on cream (audit D-P0 correction).
   */
  danger: '#C63838',
  /**
   * Text on pop/flirt fills — ink, per the audit D-P0 decision: the old
   * cream-on-tangerine pair measured 2.96:1. Never put cream text on pop.
   */
  onPop: '#221B15',
  /** Text on hype (yellow) fills. */
  onHype: '#221B15',
  /** Text on danger fills (measured 4.99:1 on #C63838). */
  onDanger: '#FFF9F2',
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
  /**
   * Trust Layer elevation — soft, low, no hard offset (consent, identity,
   * payment, report, delete). RN equivalent: offset {0,4}, radius 16,
   * opacity 0.08, elevation 2. Never use the sticker shadow on trust surfaces.
   */
  trust: '0 4px 16px rgba(34, 27, 21, 0.08)',
} as const;

/**
 * Which colour tokens may carry readable copy — the machine-readable form of
 * the rules the doc comments above state in prose (T014, audit MUI-6).
 *
 * The prose was already correct and was already ignored: the mobile app used
 * `pop` for every screen eyebrow, `fresh` for metadata lines and `textFaint`
 * for a hint, all of them below WCAG AA as text. A comment cannot fail a build,
 * so the ban lives here as data, `contrast.test.ts` proves each entry really is
 * unreadable (the ban is measured, never an opinion), and
 * `apps/mobile/src/components/tokenTextColors.test.ts` scans the app for the
 * `color:` style key and fails on any of these names.
 *
 * Keys are token names in {@link colors}; values say what to use instead.
 */
export const nonTextColorTokens = {
  pop: 'Tangerine fill (2.89:1 on cream). Readable tangerine copy uses `keyword`.',
  popPressed: 'Pressed tangerine fill (3.24:1 on cream). Readable copy uses `keyword`.',
  flirt: 'Hot-pink fill/waveform (3.12:1 on cream). Copy on cream uses `ink`.',
  hype: 'Sunshine badge fill (1.46:1 on cream). Copy on a hype fill uses `onHype`.',
  fresh: 'Teal fill/icon (2.35:1 on cream). Readable teal copy uses `verified`.',
  textFaint: 'Placeholder/disabled fill only (2.72:1 on cream). Copy uses `textSecondary`.',
} as const;

/**
 * Which colour tokens may never be a border/boundary — WCAG 1.4.11 needs 3:1
 * against BOTH cream and white and these two miss it on both. Trust Layer
 * hairlines use `borderMuted`, success boundaries use `borderSuccess`.
 */
export const nonBorderColorTokens = {
  fresh: 'Teal is 2.35:1 as a boundary. Success borders use `borderSuccess`.',
  textFaint: 'Faint grey is 2.72:1 as a boundary. Hairlines use `borderMuted`.',
} as const;

/**
 * Largest Dynamic Type multiplier a control with a FIXED height may apply to
 * its own label (T014, audit MUI-14).
 *
 * Font scaling is never switched off: `allowFontScaling={false}` would leave a
 * person who needs large text with the same 12pt badge they could not read, and
 * body copy on every screen scales without a cap. The cap exists only where the
 * container cannot grow with the text — a 44/48/52pt minimum-height button, a
 * pill badge — because there the honest failure mode is a clipped label. At
 * 1.4× the largest standard iOS setting still fits inside those heights; the
 * accessibility sizes above it are what the cap absorbs.
 */
export const maxControlFontScale = 1.4;

/** Outline widths: 2px sticker for campaign, 1px hairline for the Trust Layer. */
export const strokes = {
  sticker: 2,
  /** Trust Layer border width (consent/identity/payment/report/delete). */
  trust: 1,
} as const;
