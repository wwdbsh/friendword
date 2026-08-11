import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { nonBorderColorTokens, nonTextColorTokens } from '@friendword/ui-tokens';
import { describe, expect, it } from 'vitest';

/**
 * The guard for audit MUI-6.
 *
 * `@friendword/ui-tokens` has said in prose since the D-P0 correction that
 * `pop`, `fresh` and `textFaint` are fills and must never carry readable copy,
 * and the mobile app used all three as text anyway — seventeen times, including
 * the eyebrow at the top of five screens and the price on the paywall. A doc
 * comment cannot fail a build. This can.
 *
 * The rule is not restated here: `nonTextColorTokens` and `nonBorderColorTokens`
 * are exported by the token package, and `packages/ui-tokens/src/contrast.test.ts`
 * proves each listed token really does miss its threshold. This test only finds
 * the places the app breaks them.
 *
 * Mutation check: writing `color: colors.pop` anywhere under `app/` or `src/`
 * turns this red, which is the whole reason it exists — the seventeen original
 * misuses were each individually reasonable-looking.
 */

const MOBILE_ROOT = process.cwd();
const SCANNED_DIRS = ['app', 'src'];

/**
 * A React Native text colour is the style key `color`, lower-case c. Every
 * non-text colour key in RN ends in a capital-C `Color` — `backgroundColor`,
 * `borderColor`, `shadowColor`, `placeholderTextColor` — so requiring the key
 * to begin a token (start of line, after `{`, or after `,`) matches text
 * colours and nothing else.
 */
const TEXT_COLOR_PATTERN = /(?:^|[{,\s])color:\s*colors\.([A-Za-z0-9_]+)/g;

/** Any border/boundary key: borderColor, borderTopColor, borderLeftColor, … */
const BORDER_COLOR_PATTERN = /border[A-Za-z]*Color:\s*colors\.([A-Za-z0-9_]+)/g;

type Violation = {
  readonly file: string;
  readonly line: number;
  readonly token: string;
  readonly reason: string;
};

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') {
        continue;
      }
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function findViolations(
  source: string,
  file: string,
  pattern: RegExp,
  banned: Readonly<Record<string, string>>,
): Violation[] {
  const violations: Violation[] = [];
  source.split('\n').forEach((text, index) => {
    for (const match of text.matchAll(new RegExp(pattern.source, 'g'))) {
      const token = match[1];
      const reason = token === undefined ? undefined : banned[token];
      if (token !== undefined && reason !== undefined) {
        violations.push({ file, line: index + 1, token, reason });
      }
    }
  });
  return violations;
}

function scan(pattern: RegExp, banned: Readonly<Record<string, string>>): Violation[] {
  return SCANNED_DIRS.flatMap((dir) =>
    sourceFiles(join(MOBILE_ROOT, dir)).flatMap((file) =>
      findViolations(readFileSync(file, 'utf8'), relative(MOBILE_ROOT, file), pattern, banned),
    ),
  );
}

function describeViolations(violations: readonly Violation[]): string {
  return violations
    .map(({ file, line, token, reason }) => `${file}:${line} uses colors.${token} — ${reason}`)
    .join('\n');
}

describe('the detector itself', () => {
  // A source scan that silently stops matching passes forever. These two keep
  // the patterns honest against a sample with a known answer.
  const sample = [
    'const styles = StyleSheet.create({',
    '  eyebrow: { color: colors.pop },',
    '  ok: { color: colors.ink, backgroundColor: colors.pop },',
    '  hairline: { borderTopColor: colors.textFaint },',
    '  fine: { borderColor: colors.borderMuted, placeholderTextColor: colors.textFaint },',
    '});',
  ].join('\n');

  it('flags a banned text colour and ignores the same token used as a fill', () => {
    const found = findViolations(sample, 'sample.ts', TEXT_COLOR_PATTERN, nonTextColorTokens);

    expect(found.map((violation) => `${violation.line}:${violation.token}`)).toEqual(['2:pop']);
  });

  it('flags a banned boundary colour and ignores an allowed placeholder fill', () => {
    const found = findViolations(sample, 'sample.ts', BORDER_COLOR_PATTERN, nonBorderColorTokens);

    expect(found.map((violation) => `${violation.line}:${violation.token}`)).toEqual([
      '4:textFaint',
    ]);
  });
});

describe('mobile respects the ui-tokens text-colour policy (MUI-6)', () => {
  it('never sets a fill-only token as a text colour', () => {
    const violations = scan(TEXT_COLOR_PATTERN, nonTextColorTokens);

    expect(describeViolations(violations)).toBe('');
  });

  it('never sets a sub-3:1 token as a border or boundary', () => {
    const violations = scan(BORDER_COLOR_PATTERN, nonBorderColorTokens);

    expect(describeViolations(violations)).toBe('');
  });

  it('actually scanned the app — an empty walk would pass vacuously', () => {
    const scanned = SCANNED_DIRS.flatMap((dir) => sourceFiles(join(MOBILE_ROOT, dir)));

    expect(scanned.length).toBeGreaterThan(30);
    expect(scanned.some((file) => file.endsWith('app/index.tsx'))).toBe(true);
  });
});
