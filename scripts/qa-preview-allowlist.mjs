#!/usr/bin/env node
// Internal-QA helper (third audit Slice 0 contract): the public-beta gate is
// authoritative and is never toggled for QA. The only sanctioned exception is
// the service-role `qa_preview_allowlist`, scoped per pitch_draft, which the
// production E2E also uses. This tool manages those rows for manual device QA.
//
//   node scripts/qa-preview-allowlist.mjs list
//   node scripts/qa-preview-allowlist.mjs add <pitch_draft_id> [note]
//   node scripts/qa-preview-allowlist.mjs remove <pitch_draft_id>
//   node scripts/qa-preview-allowlist.mjs find <campaign-slug-or-headline-substring>
//
// Uses SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
// from the environment. Values are never printed.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repoRoot, 'packages/data/package.json'));
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in the environment.');
  process.exit(2);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const [, , command, arg, ...rest] = process.argv;

async function main() {
  if (command === 'list') {
    const { data, error } = await admin
      .from('qa_preview_allowlist')
      .select('pitch_draft_id, note, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    for (const row of data) {
      console.log(`${row.pitch_draft_id}  ${row.created_at}  ${row.note ?? ''}`);
    }
    console.log(`${data.length} allowlisted draft(s)`);
    return;
  }
  if (command === 'add') {
    if (!arg) throw new Error('usage: add <pitch_draft_id> [note]');
    const note = rest.join(' ') || `manual device QA ${new Date().toISOString().slice(0, 10)}`;
    const { error } = await admin
      .from('qa_preview_allowlist')
      .upsert({ pitch_draft_id: arg, note }, { onConflict: 'pitch_draft_id' });
    if (error) throw error;
    console.log(`allowlisted ${arg}`);
    return;
  }
  if (command === 'remove') {
    if (!arg) throw new Error('usage: remove <pitch_draft_id>');
    const { error } = await admin.from('qa_preview_allowlist').delete().eq('pitch_draft_id', arg);
    if (error) throw error;
    console.log(`removed ${arg}`);
    return;
  }
  if (command === 'find') {
    if (!arg) throw new Error('usage: find <campaign-slug-or-headline-substring>');
    const { data: campaigns, error } = await admin
      .from('campaigns')
      .select('id, slug, status, pitch_draft_id, published_at')
      .ilike('slug', `%${arg}%`)
      .order('published_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    for (const c of campaigns) {
      console.log(`campaign ${c.slug} [${c.status}] draft=${c.pitch_draft_id}`);
    }
    const { data: drafts, error: draftError } = await admin
      .from('pitch_drafts')
      .select('id, headline, status, created_at')
      .ilike('headline', `%${arg}%`)
      .order('created_at', { ascending: false })
      .limit(10);
    if (draftError) throw draftError;
    for (const d of drafts) {
      console.log(`draft ${d.id} [${d.status}] "${d.headline ?? ''}" ${d.created_at}`);
    }
    if (campaigns.length === 0 && drafts.length === 0) console.log('no matches');
    return;
  }
  console.error('usage: qa-preview-allowlist.mjs <list|add|remove|find> ...');
  process.exit(2);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
