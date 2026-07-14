/* Third-audit (P0-NEW-1/2) service-client fake. Records every rpc call and
 * media_validations upsert so the audit3 route tests can assert consent gating,
 * succeeded-replay reuse, and conservative failure accounting. */

export type RpcCall = { readonly fn: string; readonly params: Record<string, unknown> };

export type ServiceFakeConfig = {
  readonly accountStatus?: 'active' | 'suspended';
  readonly draftOwnerId?: string;
  // reserve_provider_usage result: either a returned row or an error.
  readonly reserveRow?: Record<string, unknown> | null;
  readonly reserveError?: { readonly message: string } | null;
  // media_validations select (stored verdict for replay).
  readonly storedModeration?: { moderation_status: string; moderation_ref: string | null } | null;
  readonly listUpdatedAt?: string;
  readonly signedUrl?: string | null;
  readonly signError?: { readonly message: string } | null;
  readonly downloadBytes?: Uint8Array | null;
};

export type ServiceFake = {
  readonly client: unknown;
  readonly rpcCalls: RpcCall[];
  readonly upserts: Array<{ table: string; row: Record<string, unknown> }>;
};

export function createServiceFake(config: ServiceFakeConfig = {}): ServiceFake {
  const rpcCalls: RpcCall[] = [];
  const upserts: Array<{ table: string; row: Record<string, unknown> }> = [];

  function makeQuery(table: string) {
    let op: 'select' | 'upsert' | 'update' | 'insert' = 'select';
    const resolveSelect = () => {
      if (table === 'users') {
        return { data: { account_status: config.accountStatus ?? 'active' }, error: null };
      }
      if (table === 'pitch_drafts') {
        return { data: { created_by_user_id: config.draftOwnerId ?? null }, error: null };
      }
      if (table === 'media_validations') {
        return { data: config.storedModeration ?? null, error: null };
      }
      return { data: null, error: null };
    };
    const resolveWrite = () => ({ data: null, error: null });
    const builder: Record<string, unknown> = {
      select() {
        return builder;
      },
      eq() {
        return builder;
      },
      in() {
        return builder;
      },
      gte() {
        return builder;
      },
      order() {
        return builder;
      },
      update() {
        op = 'update';
        return builder;
      },
      insert(row: Record<string, unknown>) {
        op = 'insert';
        upserts.push({ table, row });
        return builder;
      },
      upsert(row: Record<string, unknown>) {
        op = 'upsert';
        upserts.push({ table, row });
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(op === 'select' ? resolveSelect() : resolveWrite());
      },
      single() {
        return Promise.resolve(op === 'select' ? resolveSelect() : resolveWrite());
      },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        return Promise.resolve(op === 'select' ? resolveSelect() : resolveWrite()).then(onF, onR);
      },
    };
    return builder;
  }

  const storageBucket = {
    download() {
      const bytes = config.downloadBytes ?? null;
      if (bytes === null) {
        return Promise.resolve({ data: null, error: { message: 'not found' } });
      }
      return Promise.resolve({
        data: new Blob([new Uint8Array(bytes).buffer as ArrayBuffer]),
        error: null,
      });
    },
    list() {
      return Promise.resolve({
        data: [{ name: 'photo.png', id: 'obj-1', updated_at: config.listUpdatedAt ?? 'v1' }],
        error: null,
      });
    },
    createSignedUrl() {
      if (config.signError) {
        return Promise.resolve({ data: null, error: config.signError });
      }
      return Promise.resolve({
        data: { signedUrl: config.signedUrl ?? 'https://signed.example/obj' },
        error: null,
      });
    },
    remove() {
      return Promise.resolve({ data: [], error: null });
    },
  };

  const client = {
    from: (table: string) => makeQuery(table),
    storage: { from: () => storageBucket },
    rpc: (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      if (fn === 'reserve_provider_usage') {
        if (config.reserveError) {
          return Promise.resolve({ data: null, error: config.reserveError });
        }
        return Promise.resolve({ data: [config.reserveRow ?? null], error: null });
      }
      // reconcile_provider_usage and anything else succeed quietly.
      return Promise.resolve({ data: null, error: null });
    },
  };

  return { client, rpcCalls, upserts };
}

/** Minimal structurally-valid PNG (magic + IHDR) so checkMediaSignature passes. */
export function validPngBytes(): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // PNG signature
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR length = 13
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // 'IHDR'
  return bytes;
}
