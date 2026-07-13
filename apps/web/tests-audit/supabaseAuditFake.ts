export type AuditError = {
  readonly code: string;
  readonly message: string;
};

export type AuditCall =
  | {
      readonly operation: 'insert';
      readonly table: string;
      readonly payload: unknown;
    }
  | {
      readonly operation: 'upsert';
      readonly table: string;
      readonly payload: unknown;
    }
  | {
      readonly operation: 'update';
      readonly table: string;
      readonly payload: unknown;
    }
  | {
      readonly operation: 'eq';
      readonly table: string;
      readonly column: string;
      readonly value: unknown;
    }
  | {
      readonly operation: 'rpc';
      readonly functionName: string;
      readonly params: unknown;
    };

type FakeConfig = {
  readonly tableErrors?: Readonly<Record<string, AuditError>>;
  readonly rpcError?: AuditError;
};

type MutationResult = {
  readonly error: AuditError | null;
};

type AuditFilter = {
  readonly column: string;
  readonly value: unknown;
};

type SemanticWriteAttempt = {
  readonly payload: unknown;
  readonly filters: readonly AuditFilter[];
};

type FilterBuilder = {
  readonly eq: (column: string, value: unknown) => FilterBuilder;
};

type TableBuilder = {
  readonly insert: (payload: unknown) => Promise<MutationResult>;
  readonly upsert: (payload: unknown, options?: unknown) => Promise<MutationResult>;
  readonly update: (payload: unknown) => FilterBuilder;
};

export type AuditSupabaseFake = {
  readonly calls: readonly AuditCall[];
  readonly benefitWriteAttempts: readonly unknown[];
  readonly creatorCreditRefundAttempts: readonly SemanticWriteAttempt[];
  readonly purchaseEventWriteAttempts: readonly unknown[];
  readonly client: {
    readonly from: (table: string) => TableBuilder;
    readonly rpc: (functionName: string, params: unknown) => Promise<MutationResult>;
  };
};

export function createAuditSupabaseFake(config: FakeConfig = {}): AuditSupabaseFake {
  const calls: AuditCall[] = [];
  const benefitWriteAttempts: unknown[] = [];
  const creatorCreditRefundAttempts: SemanticWriteAttempt[] = [];
  const purchaseEventWriteAttempts: unknown[] = [];

  const resultFor = (table: string): MutationResult => ({
    error: config.tableErrors?.[table] ?? null,
  });

  const hasEntry = (payload: unknown, key: string, expected: string): boolean =>
    typeof payload === 'object' &&
    payload !== null &&
    Object.entries(payload).some(([entryKey, value]) => entryKey === key && value === expected);

  const entryValue = (record: unknown, key: string): unknown => {
    if (typeof record !== 'object' || record === null) {
      return undefined;
    }
    return Object.entries(record).find(([entryKey]) => entryKey === key)?.[1];
  };

  return {
    calls,
    benefitWriteAttempts,
    creatorCreditRefundAttempts,
    purchaseEventWriteAttempts,
    client: {
      from: (table) => ({
        insert: async (payload) => {
          calls.push({ operation: 'insert', table, payload });
          if (table === 'purchase_events') {
            purchaseEventWriteAttempts.push(payload);
          }
          if (table === 'purchase_credit_ledger') {
            benefitWriteAttempts.push(payload);
          }
          return resultFor(table);
        },
        upsert: async (payload) => {
          calls.push({ operation: 'upsert', table, payload });
          return resultFor(table);
        },
        update: (payload) => {
          calls.push({ operation: 'update', table, payload });
          const filters: AuditFilter[] = [];
          let refundRecorded = false;
          const filterBuilder: FilterBuilder = {
            eq: (column, value) => {
              calls.push({ operation: 'eq', table, column, value });
              filters.push({ column, value });
              const availableCredit = filters.some(
                (filter) => filter.column === 'credit_state' && filter.value === 'available',
              );
              const creatorProduct = filters.some(
                (filter) =>
                  filter.column === 'product_id' && filter.value === 'creator_launch_credit_499',
              );
              if (
                !refundRecorded &&
                table === 'purchase_credit_ledger' &&
                hasEntry(payload, 'credit_state', 'refunded') &&
                availableCredit &&
                creatorProduct
              ) {
                creatorCreditRefundAttempts.push({ payload, filters });
                refundRecorded = true;
              }
              return filterBuilder;
            },
          };
          return filterBuilder;
        },
      }),
      rpc: async (functionName, params) => {
        calls.push({ operation: 'rpc', functionName, params });
        if (functionName === 'record_revenuecat_event') {
          const payload = entryValue(params, 'payload');
          purchaseEventWriteAttempts.push(payload);
          benefitWriteAttempts.push(payload);
          const cancellation =
            hasEntry(payload, 'event_type', 'CANCELLATION') ||
            hasEntry(payload, 'type', 'CANCELLATION');
          if (cancellation && hasEntry(payload, 'product_id', 'creator_launch_credit_499')) {
            creatorCreditRefundAttempts.push({ payload, filters: [] });
          }
        }
        return { error: config.rpcError ?? null };
      },
    },
  };
}
