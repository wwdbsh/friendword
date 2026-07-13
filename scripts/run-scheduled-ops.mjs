#!/usr/bin/env node
// Second audit Slice 6: one entry point for the recurring ops passes so
// "manual and forgettable" becomes "one scheduled command". Runs the
// account-deletion processor and the orphan-media sweep in order and
// exits non-zero if any pass fails. Scheduling itself (cron, CI
// schedule, or a host scheduler) is an ops/user decision — see
// docs/OPS.md; nothing here self-schedules.

import { spawnSync } from 'node:child_process';

const apply = process.argv.includes('--apply');

const passes = [
  { label: 'account deletions', args: ['scripts/process-deletions.mjs'] },
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
