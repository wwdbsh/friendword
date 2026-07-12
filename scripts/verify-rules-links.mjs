#!/usr/bin/env node
/**
 * Checks that the official Shipaton pages are reachable and reports content
 * hashes so rule changes can be detected between runs (docs/HACKATHON_RULES.md
 * re-check gates). Compare hashes against the previously recorded run.
 */
import { createHash } from 'node:crypto';

const URLS = [
  'https://revenuecat-shipaton-2026.devpost.com/',
  'https://revenuecat-shipaton-2026.devpost.com/rules',
  'https://www.revenuecat.com/blog/company/announcing-shipaton-2026/',
];

let failed = false;

for (const url of URLS) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const body = await res.text();
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);
    console.log(`${res.ok ? 'OK ' : 'ERR'} ${res.status} ${url} content-sha256:${hash}`);
    if (!res.ok) failed = true;
  } catch (error) {
    console.error(`ERR fetch failed ${url}: ${error instanceof Error ? error.message : error}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
