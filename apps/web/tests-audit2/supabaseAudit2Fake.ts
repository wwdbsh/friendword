export type Audit2Error = {
  readonly code: string;
  readonly message: string;
};

export type Audit2Call = {
  readonly functionName: string;
  readonly params: unknown;
};

type FakeConfig = {
  readonly rpcData?: unknown;
  readonly rpcError?: Audit2Error;
};

type RpcResult = {
  readonly data: unknown;
  readonly error: Audit2Error | null;
};

export type Audit2SupabaseFake = {
  readonly calls: readonly Audit2Call[];
  readonly client: {
    readonly rpc: (functionName: string, params: unknown) => Promise<RpcResult>;
  };
};

export function createAudit2SupabaseFake(config: FakeConfig = {}): Audit2SupabaseFake {
  const calls: Audit2Call[] = [];

  return {
    calls,
    client: {
      rpc: async (functionName, params) => {
        calls.push({ functionName, params });
        return {
          data: config.rpcData ?? { recorded: true },
          error: config.rpcError ?? null,
        };
      },
    },
  };
}

// This owned helper also supplies the isolated audit2 Vitest config so the
// existing tests-audit config and its green include set remain untouched.
export default {
  root: new URL('../', import.meta.url).pathname,
  resolve: {
    alias: {
      '@': new URL('../src', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests-audit2/**/*.audit2.test.ts'],
  },
};
