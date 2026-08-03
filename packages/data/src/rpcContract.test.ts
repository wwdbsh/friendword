// RPC CONTRACT TEST — migrations are the truth, mocks are not.
//
// Twice in this repo a client called a Postgres function that did not exist
// (or a column spelled differently) while every unit test stayed green,
// because the tests mocked `rpc()` and happily answered to any name. This
// suite closes that class: it parses `supabase/migrations/*.sql` for every
// `CREATE FUNCTION public.<name>(<args>)` (applying `DROP FUNCTION` in
// migration order) and asserts that every RPC name the client code calls —
// and every named argument it passes in an inline object literal — exists in
// that real server surface. Renaming an RPC on either side, or misspelling an
// argument key, fails here before it can fail in production as PGRST202.
//
// The migrations are read-only input; this file must never edit them.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { INTEREST_INTENT_RPCS } from './interestIntentRepo';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');

/**
 * Only these trees may contain Supabase client calls today. A new client
 * package must be added here to fall under the contract.
 */
const CLIENT_SOURCE_DIRS = [
  join(REPO_ROOT, 'packages', 'data', 'src'),
  join(REPO_ROOT, 'apps', 'web', 'src'),
];

type SqlFunction = {
  readonly migrationFile: string;
  readonly argNames: readonly string[];
  readonly rawArgs: string;
};

type ClientRpcCall = {
  readonly file: string;
  readonly name: string;
  /** null when the params are not an inline object literal (unverifiable). */
  readonly paramKeys: readonly string[] | null;
};

// ── SQL side: the real server surface ────────────────────────────────────

function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const commentStart = line.indexOf('--');
      return commentStart === -1 ? line : line.slice(0, commentStart);
    })
    .join('\n');
}

/** Reads from the '(' at `openIndex` to its balanced ')'; returns the inside. */
function readBalancedParens(text: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(openIndex + 1, i);
      }
    }
  }
  throw new Error(`Unbalanced parentheses at index ${openIndex}`);
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
    } else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
    }
    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

const ARG_MODES = new Set(['in', 'out', 'inout', 'variadic']);

function parseArgNames(rawArgs: string): string[] {
  const names: string[] = [];
  for (const part of splitTopLevel(rawArgs, ',')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      continue;
    }
    const first = tokens[0] ?? '';
    const nameToken = ARG_MODES.has(first.toLowerCase()) ? (tokens[1] ?? '') : first;
    names.push(nameToken.toLowerCase());
  }
  return names;
}

/**
 * All `public.*` functions that exist after replaying the migrations in
 * order. `DROP FUNCTION public.x(...)` removes every signature of `x` created
 * so far — this repo deliberately avoids overloads (0053 records why), so
 * name-level removal matches reality.
 */
function loadServerFunctions(): Map<string, SqlFunction[]> {
  const functions = new Map<string, SqlFunction[]>();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  expect(files.length).toBeGreaterThan(0);

  const createPattern = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi;
  const dropPattern = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?public\.([a-z0-9_]+)\s*\(/gi;

  for (const file of files) {
    const sql = stripLineComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    type Statement = {
      readonly index: number;
      readonly kind: 'create' | 'drop';
      readonly name: string;
      readonly openIndex: number;
    };
    const statements: Statement[] = [];
    for (const match of sql.matchAll(createPattern)) {
      statements.push({
        index: match.index ?? 0,
        kind: 'create',
        name: (match[1] ?? '').toLowerCase(),
        openIndex: (match.index ?? 0) + match[0].length - 1,
      });
    }
    for (const match of sql.matchAll(dropPattern)) {
      statements.push({
        index: match.index ?? 0,
        kind: 'drop',
        name: (match[1] ?? '').toLowerCase(),
        openIndex: (match.index ?? 0) + match[0].length - 1,
      });
    }
    statements.sort((a, b) => a.index - b.index);

    for (const statement of statements) {
      if (statement.kind === 'drop') {
        functions.delete(statement.name);
        continue;
      }
      const rawArgs = readBalancedParens(sql, statement.openIndex);
      const signature: SqlFunction = {
        migrationFile: file,
        argNames: parseArgNames(rawArgs),
        rawArgs: rawArgs.replace(/\s+/g, ' ').trim(),
      };
      const existing = functions.get(statement.name) ?? [];
      functions.set(statement.name, [...existing, signature]);
    }
  }
  return functions;
}

// ── Client side: every RPC call site ─────────────────────────────────────

function listTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') {
        files.push(...listTypeScriptFiles(fullPath));
      }
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) {
      continue;
    }
    // Test files may invent names for mocks; generated types are not calls.
    if (/\.test\.tsx?$/.test(entry.name) || entry.name === 'database.types.ts') {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

/**
 * Matches the three call shapes used in this codebase:
 *   client.rpc('name', {...})          (typed supabase client)
 *   looseRpc(client)('name', {...})    (apps/web untyped envelope)
 *   this.callIntentRpc('name', {...})  (interestIntentRepo wrapper)
 * A new wrapper shape must be added here — the anchor assertions below fail
 * loudly if the extractor goes blind.
 */
const CALL_PATTERNS = [
  /\.rpc\(\s*['"]([a-z0-9_]+)['"]/g,
  /looseRpc\([^)]*\)\(\s*['"]([a-z0-9_]+)['"]/g,
  /callIntentRpc\(\s*['"]([a-z0-9_]+)['"]/g,
];

function parseInlineParamKeys(source: string, afterIndex: number): readonly string[] | null {
  const rest = source.slice(afterIndex);
  const argsMatch = /^\s*,\s*\{/.exec(rest);
  if (argsMatch === null) {
    return null;
  }
  const openIndex = afterIndex + argsMatch[0].length - 1;
  let literal: string;
  try {
    literal = readBalancedBraces(source, openIndex);
  } catch {
    return null;
  }
  const keys: string[] = [];
  for (const part of splitTopLevel(literal, ',')) {
    const trimmed = part.trim();
    if (trimmed === '') {
      continue;
    }
    if (trimmed.startsWith('...')) {
      // A spread hides its keys from static analysis; skip the whole check
      // rather than pass a half-verified call.
      return null;
    }
    const keyMatch = /^['"]?([a-zA-Z_][a-zA-Z0-9_]*)['"]?\s*(?::|$)/.exec(trimmed);
    if (keyMatch === null) {
      return null;
    }
    keys.push((keyMatch[1] ?? '').toLowerCase());
  }
  return keys;
}

function readBalancedBraces(text: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(openIndex + 1, i);
      }
    }
  }
  throw new Error(`Unbalanced braces at index ${openIndex}`);
}

function collectClientRpcCalls(): ClientRpcCall[] {
  const calls: ClientRpcCall[] = [];
  for (const dir of CLIENT_SOURCE_DIRS) {
    for (const file of listTypeScriptFiles(dir)) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of CALL_PATTERNS) {
        for (const match of source.matchAll(pattern)) {
          calls.push({
            file: relative(REPO_ROOT, file),
            name: (match[1] ?? '').toLowerCase(),
            paramKeys: parseInlineParamKeys(source, (match.index ?? 0) + match[0].length),
          });
        }
      }
    }
  }
  return calls;
}

// ── The contract ─────────────────────────────────────────────────────────

const serverFunctions = loadServerFunctions();
const clientCalls = collectClientRpcCalls();

describe('client RPC calls exist in the migration SQL', () => {
  it('extractor sanity: the known call sites are actually seen', () => {
    // If a wrapper is renamed or the regexes rot, this fails before the
    // contract silently checks nothing.
    const seenNames = new Set(clientCalls.map((call) => call.name));
    for (const anchor of [
      'create_interest_intent',
      'get_my_interest_intent',
      'promote_interest_intent',
      'claim_referral',
      'submit_interest',
      'track_event',
    ]) {
      expect(seenNames, `extractor no longer sees ${anchor}`).toContain(anchor);
    }
    expect(serverFunctions.size).toBeGreaterThan(30);
  });

  it('every RPC name called by packages/data or apps/web is a real public function', () => {
    const missing = clientCalls
      .filter((call) => !serverFunctions.has(call.name))
      .map((call) => `${call.file} calls '${call.name}'`);
    expect(
      missing,
      `RPCs with no CREATE FUNCTION public.* in migrations:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('every inline argument key matches a real argument name of the function', () => {
    const violations: string[] = [];
    for (const call of clientCalls) {
      if (call.paramKeys === null) {
        continue;
      }
      const signatures = serverFunctions.get(call.name);
      if (signatures === undefined) {
        continue; // already reported by the name check
      }
      const fitsSomeSignature = signatures.some((signature) =>
        (call.paramKeys ?? []).every((key) => signature.argNames.includes(key)),
      );
      if (!fitsSomeSignature) {
        const expected = signatures
          .map((signature) => `(${signature.rawArgs}) [${signature.migrationFile}]`)
          .join(' | ');
        violations.push(
          `${call.file} calls '${call.name}' with {${call.paramKeys.join(', ')}} ` +
            `but the migrations define ${expected}`,
        );
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('the pinned interest-intent RPC list itself exists server-side', () => {
    // Independent of the source-scan: even if every call site changed shape,
    // the exported contract constant must stay real.
    for (const name of INTEREST_INTENT_RPCS) {
      expect(
        serverFunctions.has(name),
        `INTEREST_INTENT_RPCS entry '${name}' not in migrations`,
      ).toBe(true);
    }
  });
});
