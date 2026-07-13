export type AuditError = {
  readonly code: string;
  readonly message: string;
};

export type AuditCall = {
  readonly functionName: string;
  readonly params: unknown;
};

type FakeConfig = {
  readonly rpcData?: unknown;
  readonly rpcError?: AuditError;
};

type RpcResult = {
  readonly data: unknown;
  readonly error: AuditError | null;
};

export type AuditSupabaseFake = {
  readonly calls: readonly AuditCall[];
  readonly client: {
    readonly rpc: (functionName: string, params: unknown) => Promise<RpcResult>;
  };
};

export function createAuditSupabaseFake(config: FakeConfig = {}): AuditSupabaseFake {
  const calls: AuditCall[] = [];

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
