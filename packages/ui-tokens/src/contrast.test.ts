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
  ['ink on fresh fill', colors.ink, colors.fresh],
];

describe('token contrast (WCAG AA, normal text)', () => {
  it.each(READABLE_PAIRS)('%s is at least 4.5:1', (_label, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});
