// VIRAL-LOOP SLICE — staged interest (S1 intent / S2 promotion, migration 0053).
// Pins the two invariants the design hangs on:
//  1. S1 carries NO free text — the save RPC receives exactly one campaign
//     id, so nothing a moderation gate has not seen can be stored.
//  2. Intents never mix into Dater-facing reads — this repo talks only to the
//     0053 intent RPCs (never to `interests`, the interest read RPCs, or any
//     table directly), so "every row a Dater sees came through the delivery
//     gates" holds.
// RPC name/argument REALITY (do the functions exist in the migrations with
// these names and arguments?) is owned by rpcContract.test.ts, not by the
// mocks here.
import { describe, expect, it } from 'vitest';

import type { BrowserSupabaseClient } from './client';
import { DataLayerError, UnauthenticatedError } from './errors';
import {
  DATER_FACING_INTEREST_READS,
  INTEREST_INTENT_RPCS,
  InterestIntentRepo,
} from './interestIntentRepo';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const CAMPAIGN_ID = '20000000-0000-0000-0000-000000000001';
const INTENT_ID = '90000000-0000-0000-0000-000000000001';
const INTEREST_ID = '60000000-0000-0000-0000-000000000001';

type RpcCall = { readonly fn: string; readonly params: Record<string, unknown> };

type RpcResult = { data: unknown; error: { message: string } | null };

function fakeClient(
  options: {
    readonly signedIn?: boolean;
    readonly results?: Record<string, RpcResult>;
  } = {},
) {
  const rpcCalls: RpcCall[] = [];
  const tableAccesses: string[] = [];
  const signedIn = options.signedIn ?? true;
  const client = {
    auth: {
      getSession: async () => ({
        data: {
          session: signedIn ? { user: { id: USER_ID } } : null,
        },
        error: null,
      }),
    },
    from: (table: string) => {
      tableAccesses.push(table);
      throw new Error(`unexpected direct table access: ${table}`);
    },
    rpc: async (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      return options.results?.[fn] ?? { data: [], error: null };
    },
  };
  return { client: client as unknown as BrowserSupabaseClient, rpcCalls, tableAccesses };
}

describe('InterestIntentRepo — S1 intent', () => {
  it('saves an intent with exactly the campaign id and no free-text field', async () => {
    const { client, rpcCalls } = fakeClient({
      results: {
        create_interest_intent: {
          data: [{ intent_id: INTENT_ID, created_at: '2026-08-01T00:00:00Z' }],
          error: null,
        },
      },
    });

    const saved = await new InterestIntentRepo(client).saveIntent(CAMPAIGN_ID);

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.fn).toBe('create_interest_intent');
    // S1 stores no words: one key, and it is the campaign id.
    expect(Object.keys(rpcCalls[0]?.params ?? {})).toEqual(['target_campaign_id']);
    expect(rpcCalls[0]?.params).toEqual({ target_campaign_id: CAMPAIGN_ID });
    expect(saved).toEqual({ intentId: INTENT_ID, createdAt: '2026-08-01T00:00:00Z' });
  });

  it('rejects when signed out, before any RPC', async () => {
    const { client, rpcCalls } = fakeClient({ signedIn: false });

    await expect(new InterestIntentRepo(client).saveIntent(CAMPAIGN_ID)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(rpcCalls).toHaveLength(0);
  });

  it('rejects a malformed campaign id before any RPC', async () => {
    const { client, rpcCalls } = fakeClient();

    await expect(new InterestIntentRepo(client).saveIntent('not-a-uuid')).rejects.toThrow();
    expect(rpcCalls).toHaveLength(0);
  });

  it('surfaces a save failure — no fake success', async () => {
    const { client } = fakeClient({
      results: {
        create_interest_intent: { data: null, error: { message: 'rate limit exceeded' } },
      },
    });

    await expect(new InterestIntentRepo(client).saveIntent(CAMPAIGN_ID)).rejects.toBeInstanceOf(
      DataLayerError,
    );
  });

  it('reads back the own intent through the self-scoped RPC and maps null for none', async () => {
    const { client, rpcCalls, tableAccesses } = fakeClient({
      results: {
        get_my_interest_intent: {
          data: [{ intent_id: INTENT_ID, created_at: '2026-08-01T00:00:00Z' }],
          error: null,
        },
      },
    });
    const repo = new InterestIntentRepo(client);

    await expect(repo.getMyIntent(CAMPAIGN_ID)).resolves.toEqual({
      intentId: INTENT_ID,
      createdAt: '2026-08-01T00:00:00Z',
    });
    expect(rpcCalls).toEqual([
      { fn: 'get_my_interest_intent', params: { target_campaign_id: CAMPAIGN_ID } },
    ]);
    // The server scopes to auth.uid(); the client passes no user id and never
    // touches the table.
    expect(tableAccesses).toEqual([]);

    const empty = fakeClient();
    await expect(new InterestIntentRepo(empty.client).getMyIntent(CAMPAIGN_ID)).resolves.toBeNull();
  });

  it('requires a session before reading the own intent', async () => {
    const { client, rpcCalls } = fakeClient({ signedIn: false });

    await expect(new InterestIntentRepo(client).getMyIntent(CAMPAIGN_ID)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('InterestIntentRepo — S2 promotion', () => {
  it('promotes with the note (moderated downstream) and maps the interest row', async () => {
    const { client, rpcCalls } = fakeClient({
      results: {
        promote_interest_intent: {
          data: [{ interest_id: INTEREST_ID, interest_status: 'submitted' }],
          error: null,
        },
      },
    });

    const promoted = await new InterestIntentRepo(client).promoteIntent(
      CAMPAIGN_ID,
      'We keep almost meeting.',
    );

    expect(rpcCalls[0]?.fn).toBe('promote_interest_intent');
    expect(rpcCalls[0]?.params).toEqual({
      target_campaign_id: CAMPAIGN_ID,
      interest_note: 'We keep almost meeting.',
    });
    expect(promoted).toEqual({ interestId: INTEREST_ID, interestStatus: 'submitted' });
  });

  it('passes a null note through unchanged', async () => {
    const { client, rpcCalls } = fakeClient({
      results: {
        promote_interest_intent: {
          data: [{ interest_id: INTEREST_ID, interest_status: 'submitted' }],
          error: null,
        },
      },
    });

    await new InterestIntentRepo(client).promoteIntent(CAMPAIGN_ID, null);

    expect(rpcCalls[0]?.params).toMatchObject({ interest_note: null });
  });

  it('fails honestly when the server rejects promotion (gates stay closed)', async () => {
    const { client } = fakeClient({
      results: {
        promote_interest_intent: {
          data: null,
          error: {
            message: 'Friendword is in a private beta; interest submissions are not open yet',
          },
        },
      },
    });

    await expect(
      new InterestIntentRepo(client).promoteIntent(CAMPAIGN_ID, null),
    ).rejects.toBeInstanceOf(DataLayerError);
  });

  it('fails when the RPC returns no interest row', async () => {
    const { client } = fakeClient({
      results: { promote_interest_intent: { data: [], error: null } },
    });

    await expect(
      new InterestIntentRepo(client).promoteIntent(CAMPAIGN_ID, null),
    ).rejects.toBeInstanceOf(DataLayerError);
  });
});

describe('intents never mix into Dater-facing reads', () => {
  it('keeps the intent RPC namespace disjoint from Dater-facing interest reads', () => {
    for (const intentRpc of INTEREST_INTENT_RPCS) {
      expect(DATER_FACING_INTEREST_READS).not.toContain(intentRpc);
    }
  });

  it('calls only intent RPCs and no table at all, across every repo method', async () => {
    const { client, rpcCalls, tableAccesses } = fakeClient({
      results: {
        create_interest_intent: {
          data: [{ intent_id: INTENT_ID, created_at: null }],
          error: null,
        },
        promote_interest_intent: {
          data: [{ interest_id: INTEREST_ID, interest_status: 'submitted' }],
          error: null,
        },
      },
    });
    const repo = new InterestIntentRepo(client);

    await repo.saveIntent(CAMPAIGN_ID);
    await repo.getMyIntent(CAMPAIGN_ID);
    await repo.promoteIntent(CAMPAIGN_ID, null);

    expect(tableAccesses).toEqual([]);
    const intentRpcNames: readonly string[] = INTEREST_INTENT_RPCS;
    const daterReads: readonly string[] = DATER_FACING_INTEREST_READS;
    for (const call of rpcCalls) {
      expect(intentRpcNames).toContain(call.fn);
      expect(daterReads).not.toContain(call.fn);
    }
  });
});
