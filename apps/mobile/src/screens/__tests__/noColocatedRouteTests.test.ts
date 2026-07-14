import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Regression guard (S7 QA): expo-router scans everything under `app/` as a
 * route and Metro bundles it. A colocated `*.test.ts` there pulls Vitest into
 * the app bundle and crashes Expo Go on boot ("Vitest failed to access its
 * internal state"). Route tests must live outside `app/` (here, in
 * src/screens/__tests__/). This test fails if any test file reappears in app/.
 */
function collectTestFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectTestFiles(full));
    } else if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

describe('expo-router route directory hygiene', () => {
  it('has no colocated test files under app/ (they would break Expo Go boot)', () => {
    const appDir = join(process.cwd(), 'app');
    expect(collectTestFiles(appDir)).toEqual([]);
  });
});
