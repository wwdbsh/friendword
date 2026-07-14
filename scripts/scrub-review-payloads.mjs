#!/usr/bin/env node
// Third audit Slice 3 (H-2): resolved purchase-event review payloads keep
// full RevenueCat PII only for a bounded retention window. This pass calls
// the service-role scrub function (migration 0037) that strips the PII keys
// from resolved/discarded reviews older than 90 days while keeping the
// operational summary. Open reviews are never touched.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repoRoot, 'packages/data/package.json'));
const { createClient } = require('@supabase/supabase-js');

function readEnvFile() {
  const envPath = path.join(repoRoot, '.env');
  if (!existsSync(envPath)) return {};
  return Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}

const env = { ...readEnvFile(), ...process.env };
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await admin.rpc('scrub_resolved_purchase_review_payloads');
if (error) {
  console.error(`review payload scrub failed: ${error.message}`);
  process.exit(1);
}
console.log(`review payload scrub: ${data ?? 0} row(s) scrubbed`);
