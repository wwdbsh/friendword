import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserClient } from './client';
import { DataLayerError } from './errors';
import { PitchDraftRepo } from './pitchDraftRepo';

const DRAFT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000001';
const STORAGE_PATH = `pitch-media/${DRAFT_ID}/photo-abc123.jpg`;

const EXISTING_ROW = {
  id: '40000000-0000-0000-0000-000000000001',
  pitch_draft_id: DRAFT_ID,
  uploaded_by_user_id: USER_ID,
  asset_type: 'photo',
  storage_path: STORAGE_PATH,
  sort_order: 0,
  created_at: '2026-07-29T00:00:00.000Z',
  updated_at: '2026-07-29T00:00:00.000Z',
};

const UNIQUE_VIOLATION = {
  code: '23505',
  message:
    'duplicate key value violates unique constraint "pitch_assets_pitch_draft_id_storage_path_key"',
  details: null,
  hint: null,
};

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSession: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

/** Filters the select chain records, so a test can assert what was looked up. */
type SelectCall = { readonly table: string; readonly filters: Record<string, unknown> };

function installTables(handlers: {
  readonly insert: () => { data: unknown; error: unknown };
  readonly select: (call: SelectCall) => { data: unknown; error: unknown };
  readonly selectCalls: SelectCall[];
  readonly insertCalls: unknown[];
}): void {
  mocks.from.mockImplementation((table: string) => {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {
      insert(row: unknown) {
        handlers.insertCalls.push(row);
        return {
          select: () => ({ single: async () => handlers.insert() }),
        };
      },
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return builder;
      },
      order() {
        return builder;
      },
      async single() {
        return handlers.select({ table, filters });
      },
      async maybeSingle() {
        const call = { table, filters };
        handlers.selectCalls.push(call);
        return handlers.select(call);
      },
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        const call = { table, filters };
        handlers.selectCalls.push(call);
        return Promise.resolve(handlers.select(call)).then(onFulfilled, onRejected);
      },
    };
    return builder;
  });
}

describe('PitchDraftRepo.registerAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue({
      auth: { getSession: mocks.getSession },
      from: mocks.from,
      rpc: mocks.rpc,
    });
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: USER_ID } } },
      error: null,
    });
  });

  it('records a new asset', async () => {
    const insertCalls: unknown[] = [];
    installTables({
      insert: () => ({ data: EXISTING_ROW, error: null }),
      select: () => ({ data: null, error: null }),
      selectCalls: [],
      insertCalls,
    });
    const repo = new PitchDraftRepo(createBrowserClient('https://project.example', 'anon-key'));

    const row = await repo.registerAsset(DRAFT_ID, 'photo', 'photo-abc123.jpg');

    expect(row).toEqual(EXISTING_ROW);
    expect(insertCalls).toEqual([
      {
        pitch_draft_id: DRAFT_ID,
        uploaded_by_user_id: USER_ID,
        asset_type: 'photo',
        storage_path: STORAGE_PATH,
        sort_order: 0,
      },
    ]);
  });

  it('treats a unique violation as the registration having already landed', async () => {
    // The window this closes: the insert commits but its response is lost, so
    // the caller retries. pitch_assets is UNIQUE (pitch_draft_id, storage_path),
    // and surfacing 23505 as a failure would make every later submit from that
    // device fail on the same asset — permanently.
    const selectCalls: SelectCall[] = [];
    installTables({
      insert: () => ({ data: null, error: UNIQUE_VIOLATION }),
      select: () => ({ data: EXISTING_ROW, error: null }),
      selectCalls,
      insertCalls: [],
    });
    const repo = new PitchDraftRepo(createBrowserClient('https://project.example', 'anon-key'));

    const row = await repo.registerAsset(DRAFT_ID, 'photo', 'photo-abc123.jpg');

    expect(row).toEqual(EXISTING_ROW);
    expect(selectCalls).toEqual([
      { table: 'pitch_assets', filters: { pitch_draft_id: DRAFT_ID, storage_path: STORAGE_PATH } },
    ]);
  });

  it('still fails when the row the violation named cannot be read back', async () => {
    installTables({
      insert: () => ({ data: null, error: UNIQUE_VIOLATION }),
      select: () => ({ data: null, error: null }),
      selectCalls: [],
      insertCalls: [],
    });
    const repo = new PitchDraftRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.registerAsset(DRAFT_ID, 'photo', 'photo-abc123.jpg')).rejects.toBeInstanceOf(
      DataLayerError,
    );
  });

  it('does not swallow an insert failure that is not a unique violation', async () => {
    installTables({
      insert: () => ({
        data: null,
        error: { code: '42501', message: 'new row violates row-level security policy' },
      }),
      select: () => ({ data: EXISTING_ROW, error: null }),
      selectCalls: [],
      insertCalls: [],
    });
    const repo = new PitchDraftRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.registerAsset(DRAFT_ID, 'photo', 'photo-abc123.jpg')).rejects.toBeInstanceOf(
      DataLayerError,
    );
  });
});

describe('PitchDraftRepo.listAssets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue({
      auth: { getSession: mocks.getSession },
      from: mocks.from,
      rpc: mocks.rpc,
    });
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: USER_ID } } },
      error: null,
    });
  });

  it('reads the rows a submit would snapshot for one draft', async () => {
    const selectCalls: SelectCall[] = [];
    installTables({
      insert: () => ({ data: null, error: null }),
      select: () => ({ data: [EXISTING_ROW], error: null }),
      selectCalls,
      insertCalls: [],
    });
    const repo = new PitchDraftRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.listAssets(DRAFT_ID)).resolves.toEqual([EXISTING_ROW]);
    expect(selectCalls).toEqual([{ table: 'pitch_assets', filters: { pitch_draft_id: DRAFT_ID } }]);
  });

  it('reports a failed read instead of an empty asset list', async () => {
    installTables({
      insert: () => ({ data: null, error: null }),
      select: () => ({ data: null, error: { message: 'statement timeout' } }),
      selectCalls: [],
      insertCalls: [],
    });
    const repo = new PitchDraftRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.listAssets(DRAFT_ID)).rejects.toBeInstanceOf(DataLayerError);
  });
});

describe('PitchDraftRepo.removeAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue({
      auth: { getSession: mocks.getSession },
      from: mocks.from,
      rpc: mocks.rpc,
    });
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: USER_ID } } },
      error: null,
    });
  });

  it('detaches the row through the 0046 RPC with its parameter name', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const repo = new PitchDraftRepo(createBrowserClient('https://project.example', 'anon-key'));

    await repo.removeAsset(EXISTING_ROW.id);

    expect(mocks.rpc).toHaveBeenCalledWith('remove_pitch_draft_asset', {
      p_asset_id: EXISTING_ROW.id,
    });
  });

  it('reports the server refusal rather than reporting a removal that did not happen', async () => {
    // 0046 refuses a voice asset, a draft past changes_requested, and an asset
    // someone else uploaded. Swallowing any of those would let the caller
    // believe the pitch no longer carries a photo that it still carries.
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'the introducer voice recording cannot be removed' },
    });
    const repo = new PitchDraftRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.removeAsset(EXISTING_ROW.id)).rejects.toBeInstanceOf(DataLayerError);
  });
});
