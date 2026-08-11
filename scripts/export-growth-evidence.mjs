#!/usr/bin/env node
/**
 * Exports the anonymized growth-evidence package (docs/GROWTH_EVIDENCE.md):
 * aggregate counts only — no emails, names, free-text, or per-user rows.
 * Reads hosted Supabase with the service role and prints JSON to stdout
 * (or writes --out <file>).
 *
 * Truthfulness contract (fifth audit H-8 / H-9):
 *  - We do NOT claim a K-factor. Before the app ships we have no viral cohort;
 *    what we can honestly report is a share PROXY, waitlist demand, and — once
 *    referral publishing exists — the count of new campaigns actually attributed
 *    to a prior campaign. None of these is renamed "K-factor".
 *  - Outcome metrics the server owns (interest decisions) are counted only when
 *    `properties.recorded_by = 'server'`, so a client cannot inflate them by
 *    emitting the same event name. Anonymous client interactions are reported
 *    separately and flagged as client-reported.
 *  - Revenue is net paid transactions (purchase-family events minus refunds),
 *    not a raw row count of every lifecycle event.
 *  - Sandbox drill rows (0060) are excluded from every revenue metric. A
 *    sandbox purchase moves no money, so counting one would inflate conversion
 *    while contributing zero revenue. Requires 0060 to be applied: the ledger
 *    filter reads a column that migration adds.
 *  - Every metric carries its source_of_truth and limitations inline.
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

// Purchase-family event types that represent money actually received.
const PAID_EVENT_TYPES = ['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL'];

// 0060 sandbox exclusion. The two contracts differ and the filters must too:
//
//  - `purchase_credit_ledger.environment` and `campaign_entitlements.environment`
//    are server judgements: NOT NULL, CHECK-ed to exactly SANDBOX|PRODUCTION.
//    A plain inequality is exact there.
//  - `purchase_events.environment` (0014) stores RevenueCat's raw string: it is
//    nullable and not case-normalized, so `.neq('environment', 'SANDBOX')` would
//    silently drop every NULL-environment row — real purchases — out of revenue.
//    The rule is `upper(coalesce(environment, '')) <> 'SANDBOX'`, the same shape
//    0023's production gate uses. PostgREST cannot take that expression, so it is
//    spelled server-side as "NULL, or not case-insensitively equal to SANDBOX":
//    unknown or oddly-cased environments count as real money, which is the safe
//    direction for a revenue figure.
//
// Both filters run in Postgres, not in JS, so `head: true` exact counts stay exact.
const excludeSandboxEvents = (q) => q.or('environment.is.null,environment.not.ilike.SANDBOX');
const excludeSandboxLabelled = (q) => q.neq('environment', 'SANDBOX');

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

/**
 * Counts an analytics event. `recordedBy: 'server'` restricts the count to rows
 * the database triggers stamped (0033), which a client cannot forge — required
 * for any outcome metric. Omit it only for genuinely client-reported interactions.
 */
async function countEvents(eventName, { recordedBy } = {}) {
  return countRows('analytics_events', (q) => {
    let query = q.eq('event_name', eventName);
    if (recordedBy) {
      query = query.eq('properties->>recorded_by', recordedBy);
    }
    return query;
  });
}

const [
  users,
  publishedCampaigns,
  // Client-reported interactions (anonymous, forgeable — reported as-is, flagged):
  uniqueViews,
  interestsStarted,
  // Server-recorded outcomes (trigger-stamped recorded_by='server'):
  interestsSubmitted,
  interestsAccepted,
  introRooms,
  grossPaidTransactions,
  refunds,
  creatorCreditsConsumed,
  reportsOpen,
] = await Promise.all([
  countRows('users', (q) => q.eq('account_status', 'active')),
  countRows('campaigns', (q) => q.eq('status', 'published')),
  countEvents('pitch_viewed_unique'),
  countEvents('interest_started'),
  countEvents('interest_submitted', { recordedBy: 'server' }),
  countEvents('interest_accepted', { recordedBy: 'server' }),
  countRows('intro_rooms'),
  countRows('purchase_events', (q) => excludeSandboxEvents(q.in('event_type', PAID_EVENT_TYPES))),
  countRows('purchase_events', (q) => excludeSandboxEvents(q.eq('event_type', 'REFUND'))),
  countRows('purchase_credit_ledger', (q) =>
    excludeSandboxLabelled(q.eq('credit_state', 'consumed')),
  ),
  countRows('reports', (q) => q.eq('status', 'open')),
]);

// Share proxy: `campaign_shared` is a Creator-Kit share action, NOT a converted
// referral. Dividing by published campaigns yields shares-per-campaign, a proxy
// for share intent only — it is explicitly not a K-factor. Exact head count so
// there is no silent row cap.
const shareProxyEvents = await countEvents('campaign_shared');

// True referral chain: rows in referral_claims whose new_campaign_id is set are
// prior campaigns that led to a NEW published campaign. This is the honest
// attributed-growth signal, but with no cohort/window defined it is still not
// a K-factor. Column names come from migration 0039 (join_waitlist / claim_referral).
const { data: claimRows, error: claimError } = await admin
  .from('referral_claims')
  .select('source_campaign_id, new_campaign_id')
  .limit(100_000);
if (claimError) {
  throw new Error(`referral_claims: ${claimError.message}`);
}
const referralClaimsTotal = claimRows?.length ?? 0;
const attributedRows = (claimRows ?? []).filter((row) => row.new_campaign_id !== null);
const attributedNewCampaigns = attributedRows.length;
const attributingSourceCampaigns = new Set(
  attributedRows.map((row) => row.source_campaign_id).filter((id) => id !== null),
).size;
const newCampaignsPerAttributingSource =
  attributingSourceCampaigns === 0
    ? null
    : Number((attributedNewCampaigns / attributingSourceCampaigns).toFixed(3));

// Waitlist demand: total signups plus how many carried a source campaign slug.
const { data: waitlistRows, error: waitlistError } = await admin
  .from('waitlist_signups')
  .select('source_campaign_id')
  .limit(100_000);
if (waitlistError) {
  throw new Error(`waitlist_signups: ${waitlistError.message}`);
}
const waitlistSignups = waitlistRows?.length ?? 0;
const waitlistSignupsFromCampaign = (waitlistRows ?? []).filter(
  (row) => row.source_campaign_id !== null,
).length;

const netPaidTransactions = grossPaidTransactions - refunds;
const sharesPerPublishedCampaign =
  publishedCampaigns === 0 ? null : Number((shareProxyEvents / publishedCampaigns).toFixed(3));

const evidence = {
  generated_at: new Date().toISOString(),
  scope: 'anonymized aggregates only',
  timezone: 'UTC',
  window: 'all-time',
  funnel: {
    active_users: users,
    published_campaigns: publishedCampaigns,
    // Client-reported (anonymous) interactions:
    unique_pitch_views: uniqueViews,
    interests_started: interestsStarted,
    // Server-recorded outcomes:
    interests_submitted: interestsSubmitted,
    interests_accepted: interestsAccepted,
    intro_rooms_opened: introRooms,
    campaign_share_proxy_events: shareProxyEvents,
  },
  referral: {
    referral_claims_total: referralClaimsTotal,
    attributed_new_campaigns: attributedNewCampaigns,
    attributing_source_campaigns: attributingSourceCampaigns,
    new_campaigns_per_attributing_source: newCampaignsPerAttributingSource,
    waitlist_signups: waitlistSignups,
    waitlist_signups_from_campaign: waitlistSignupsFromCampaign,
  },
  revenue: {
    net_paid_transactions: netPaidTransactions,
    gross_paid_transactions: grossPaidTransactions,
    refunds,
    creator_credits_consumed: creatorCreditsConsumed,
  },
  safety: {
    open_reports: reportsOpen,
  },
  // Deliberately NOT a K-factor: shares-per-published-campaign is share intent
  // only, and every share proxy row is a client action, not a conversion.
  share_proxy_events_per_published_campaign: sharesPerPublishedCampaign,
  metric_metadata: {
    active_users: {
      source_of_truth: "users.account_status = 'active'",
      limitations: 'Excludes suspended/erased accounts; no activity recency filter.',
    },
    unique_pitch_views: {
      source_of_truth: "analytics_events where event_name = 'pitch_viewed_unique'",
      limitations:
        'Client-reported and anonymous. Deduped per session in the browser only; a client could omit or repeat it. Not authoritative.',
    },
    interests_started: {
      source_of_truth: "analytics_events where event_name = 'interest_started'",
      limitations: 'Client-reported. Reflects intent to start, not a server-verified outcome.',
    },
    interests_submitted: {
      source_of_truth:
        "analytics_events where event_name = 'interest_submitted' AND properties.recorded_by = 'server'",
      limitations: 'Server-stamped outcome (0033 trigger); client-emitted rows are excluded.',
    },
    interests_accepted: {
      source_of_truth:
        "analytics_events where event_name = 'interest_accepted' AND properties.recorded_by = 'server'",
      limitations: 'Server-stamped outcome (0033 trigger); client-emitted rows are excluded.',
    },
    campaign_share_proxy_events: {
      source_of_truth: "analytics_events where event_name = 'campaign_shared'",
      limitations: 'A Creator-Kit share action, NOT a conversion. Proxy for share intent only.',
    },
    referral_claims_total: {
      source_of_truth: 'referral_claims row count',
      limitations:
        'One first-source claim per user (claim_referral is idempotent, self-campaign ignored). Not all claims lead to a new campaign.',
    },
    attributed_new_campaigns: {
      source_of_truth: 'referral_claims where new_campaign_id IS NOT NULL',
      limitations:
        'Counts prior campaigns that produced a new published campaign. NOT a K-factor: no cohort or time window is defined, and each claim is first-source only.',
    },
    net_paid_transactions: {
      source_of_truth: `purchase_events event_type IN (${PAID_EVENT_TYPES.join(', ')}) minus event_type = 'REFUND', both restricted to upper(coalesce(environment, '')) <> 'SANDBOX'`,
      limitations:
        'Net = gross paid events minus refund events over all time; refunds are subtracted in aggregate, not matched per original_transaction_id. Excludes CANCELLATION/EXPIRATION (no money movement). Excludes sandbox drill events (0060), which move no money; rows with an absent or unrecognized environment are counted as real.',
    },
    creator_credits_consumed: {
      source_of_truth:
        "purchase_credit_ledger.credit_state = 'consumed' AND environment <> 'SANDBOX'",
      limitations:
        'Consumed launch credits only; available/revoked credits are excluded. Excludes sandbox drill credits (0060).',
    },
    open_reports: {
      source_of_truth: "reports.status = 'open'",
      limitations: 'Snapshot of unresolved reports at export time.',
    },
    share_proxy_events_per_published_campaign: {
      source_of_truth: 'campaign_share_proxy_events / published_campaigns',
      limitations:
        'NOT a K-factor. Numerator is share intent (client action), denominator is published campaigns; no viral cohort is measured.',
    },
    waitlist_signups: {
      source_of_truth: 'waitlist_signups row count',
      limitations:
        'Pre-launch demand only; a signup is not an active user. Duplicate emails are no-ops server-side.',
    },
  },
};

const output = JSON.stringify(evidence, null, 2);
if (outPath) {
  writeFileSync(outPath, `${output}\n`);
  console.error(`export-growth-evidence: wrote ${outPath}`);
} else {
  console.log(output);
}
