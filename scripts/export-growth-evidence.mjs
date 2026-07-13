#!/usr/bin/env node
/**
 * Exports the anonymized growth-evidence package (docs/GROWTH_EVIDENCE.md):
 * aggregate counts only — no emails, names, free-text, or per-user rows.
 * Reads hosted Supabase with the service role and prints JSON to stdout
 * (or writes --out <file>).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repoRoot, 'packages/data/package.json'));
const { createClient } = require('@supabase/supabase-js');

const outFlagIndex = process.argv.indexOf('--out');
const outPath = outFlagIndex === -1 ? null : process.argv[outFlagIndex + 1];
if (outFlagIndex !== -1 && !outPath) {
  console.error('usage: node scripts/export-growth-evidence.mjs [--out <file>]');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(path.join(repoRoot, '.env'), 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('export-growth-evidence: missing Supabase env');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function countRows(table, modify) {
  let query = admin.from(table).select('*', { count: 'exact', head: true });
  if (modify) {
    query = modify(query);
  }
  const { count, error } = await query;
  if (error) {
    throw new Error(`${table}: ${error.message}`);
  }
  return count ?? 0;
}

async function countEvents(eventName) {
  return countRows('analytics_events', (q) => q.eq('event_name', eventName));
}

const [
  users,
  publishedCampaigns,
  uniqueViews,
  interestsStarted,
  interestsSubmitted,
  interestsAccepted,
  introRooms,
  purchases,
  creatorCreditsConsumed,
  reportsOpen,
] = await Promise.all([
  countRows('users', (q) => q.eq('account_status', 'active')),
  countRows('campaigns', (q) => q.eq('status', 'published')),
  countEvents('pitch_viewed_unique'),
  countEvents('interest_started'),
  countEvents('interest_submitted'),
  countEvents('interest_accepted'),
  countRows('intro_rooms'),
  countRows('purchase_events'),
  countRows('purchase_credit_ledger', (q) => q.eq('credit_state', 'consumed')),
  countRows('reports', (q) => q.eq('status', 'open')),
]);

// Attribution: shares that convert into new campaigns approximate K-factor.
const { data: shareRows, error: shareError } = await admin
  .from('analytics_events')
  .select('properties')
  .eq('event_name', 'campaign_shared')
  .limit(10_000);
if (shareError) {
  throw new Error(`campaign_shared: ${shareError.message}`);
}
const shares = shareRows?.length ?? 0;

const evidence = {
  generated_at: new Date().toISOString(),
  scope: 'anonymized aggregates only',
  funnel: {
    active_users: users,
    published_campaigns: publishedCampaigns,
    unique_pitch_views: uniqueViews,
    interests_started: interestsStarted,
    interests_submitted: interestsSubmitted,
    interests_accepted: interestsAccepted,
    intro_rooms_opened: introRooms,
    campaign_shares: shares,
  },
  revenue: {
    purchase_events: purchases,
    creator_credits_consumed: creatorCreditsConsumed,
  },
  safety: {
    open_reports: reportsOpen,
  },
  k_factor_estimate:
    publishedCampaigns === 0 ? null : Number((shares / publishedCampaigns).toFixed(3)),
};

const output = JSON.stringify(evidence, null, 2);
if (outPath) {
  writeFileSync(outPath, `${output}\n`);
  console.error(`export-growth-evidence: wrote ${outPath}`);
} else {
  console.log(output);
}
