#!/usr/bin/env node
// Second audit Slice 6: one entry point for the recurring ops passes so
// "manual and forgettable" becomes "one scheduled command". Runs the
// account-deletion processor and the orphan-media sweep in order and
// exits non-zero if any pass fails. The schedule lives outside this file:
// .github/workflows/scheduled-ops.yml runs it daily (fcp Issue #39), and
// the pure-SQL passes also run in hosted pg_cron (0043) — see docs/OPS.md.

import { spawnSync } from 'node:child_process';

const apply = process.argv.includes('--apply');

const passes = [
  { label: 'campaign expiration', args: ['scripts/expire-campaigns.mjs'] },
  { label: 'account deletions', args: ['scripts/process-deletions.mjs'] },
  { label: 'review payload scrub', args: ['scripts/scrub-review-payloads.mjs'] },
  {
    label: 'orphan media sweep',
    args: apply
      ? ['scripts/cleanup-orphan-media.mjs', '--apply']
      : ['scripts/cleanup-orphan-media.mjs'],
  },
];

let failures = 0;
for (const pass of passes) {
  console.log(`\n=== scheduled ops: ${pass.label} ===`);
  const result = spawnSync(process.execPath, pass.args, { stdio: 'inherit' });
  if (result.status !== 0) {
    failures += 1;
    console.error(`scheduled ops: ${pass.label} exited ${result.status}`);
  }
}

if (!apply) {
  console.log('\n(orphan sweep ran dry-run; pass --apply to delete)');
}
process.exit(failures === 0 ? 0 : 1);
