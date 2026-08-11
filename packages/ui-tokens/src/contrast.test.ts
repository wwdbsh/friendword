import { describe, expect, it } from 'vitest';

import { colors } from './index';

function channel(value: number): number {
  const scaled = value / 255;

  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const raw = hex.replace('#', '');
  const red = parseInt(raw.slice(0, 2), 16);
  const green = parseInt(raw.slice(2, 4), 16);
  const blue = parseInt(raw.slice(4, 6), 16);

  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

export function contrastRatio(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);

  return (lighter + 0.05) / (darker + 0.05);
}

const AA_NORMAL = 4.5;
/** WCAG 1.4.11: non-text UI parts (borders, boundaries) need 3:1. */
const NON_TEXT = 3;

/**
 * Audit D-P0 guard: every token pair that carries readable text must meet
 * WCAG AA for normal text. textFaint is deliberately absent — it is
 * restricted to placeholder/disabled content, which AA exempts.
 */
const READABLE_PAIRS: readonly (readonly [string, string, string])[] = [
  ['ink on cream', colors.ink, colors.background],
  ['ink on surface', colors.ink, colors.surface],
  ['secondary text on cream', colors.textSecondary, colors.background],
  ['stage text on stage', colors.stageText, colors.stage],
  ['muted stage text on stage', colors.stageTextSecondary, colors.stage],
  ['text on pop fill', colors.onPop, colors.pop],
  ['text on pressed pop fill', colors.onPop, colors.popPressed],
  ['text on flirt fill', colors.onPop, colors.flirt],
  ['text on hype fill', colors.onHype, colors.hype],
  ['text on danger fill', colors.onDanger, colors.danger],
  ['danger text on cream', colors.danger, colors.background],
  // T017: the caption keyword sits on the cream sticker card; the card also
  // appears over white surfaces in the consent preview.
  ['keyword text on cream', colors.keyword, colors.background],
  ['keyword text on surface', colors.keyword, colors.surface],
  ['ink on fresh fill', colors.ink, colors.fresh],
];

/**
 * Third audit §8: every border/boundary token used on a Trust Layer surface
 * (TrustCard, SafetyAction, QuietNavAction) must meet WCAG 1.4.11 (3:1) on
 * BOTH cream and white — the two canvases a trust border can sit against.
 * This matrix resolves the previously "deliberately absent" gap: it exercises
 * the exact tokens the mobile Trust Layer draws as 1px hairlines.
 */
const TRUST_BORDER_PAIRS: readonly (readonly [string, string, string])[] = [
  ['trust neutral border on cream', colors.borderMuted, colors.background],
  ['trust neutral border on surface', colors.borderMuted, colors.surface],
  ['trust success border on cream', colors.borderSuccess, colors.background],
  ['trust success border on surface', colors.borderSuccess, colors.surface],
  ['trust danger border on cream', colors.danger, colors.background],
  ['trust danger border on surface', colors.danger, colors.surface],
];

describe('token contrast (WCAG AA, normal text)', () => {
  it.each(READABLE_PAIRS)('%s is at least 4.5:1', (_label, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe('Trust Layer border contrast (WCAG 1.4.11 non-text)', () => {
  it.each(TRUST_BORDER_PAIRS)('%s is at least 3:1', (_label, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it('textFaint stays below 3:1 as a border — it is fill-only, never a boundary', () => {
    expect(contrastRatio(colors.textFaint, colors.background)).toBeLessThan(NON_TEXT);
    expect(contrastRatio(colors.textFaint, colors.surface)).toBeLessThan(NON_TEXT);
  });

  it('fresh stays below 3:1 as a border — success boundaries use borderSuccess', () => {
    // Third audit §8: the exhaustive matrix caught fresh (#17B89B) failing as a
    // TrustCard success border (2.35 cream / 2.51 white). Keep this guard so the
    // teal trust signal is never wired back onto a boundary.
    expect(contrastRatio(colors.fresh, colors.background)).toBeLessThan(NON_TEXT);
    expect(contrastRatio(colors.fresh, colors.surface)).toBeLessThan(NON_TEXT);
  });
});
