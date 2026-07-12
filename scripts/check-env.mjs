#!/usr/bin/env node
/**
 * Validates that .env contains every key declared in .env.example.
 * Values are not validated here — runtime schemas in @friendword/config do that.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const examplePath = resolve(root, '.env.example');
const envPath = resolve(root, '.env');

const parseKeys = (content) =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('=')[0]);

const requiredKeys = parseKeys(readFileSync(examplePath, 'utf8'));

if (!existsSync(envPath)) {
  console.error('.env not found. Copy .env.example to .env and fill in values.');
  process.exit(1);
}

const presentKeys = new Set(parseKeys(readFileSync(envPath, 'utf8')));
const missing = requiredKeys.filter((key) => !presentKeys.has(key));

if (missing.length > 0) {
  console.error(`Missing keys in .env:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

console.log(`OK: all ${requiredKeys.length} keys from .env.example are present in .env`);
