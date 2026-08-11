// Hand-written declarations for accountErasure.mjs. The module stays plain
// ESM because scripts/ runs under bare `node` with no TypeScript loader; this
// file is what lets the typed tests in packages/data consume it.

export type ErasureDraftRow = {
  readonly id: string;
  readonly created_by_user_id: string;
  readonly subject_user_id: string | null;
};

export type ErasureCampaignRow = {
  readonly id: string;
  readonly pitch_draft_id: string;
  readonly owner_user_id: string;
};

export type ErasureRoomRow = { readonly id: string };

export type DraftReassignment = {
  readonly draftId: string;
  readonly newOwnerId: string;
};

export type AccountErasurePlan = {
  /** Drafts erased with the account. */
  readonly draftIds: readonly string[];
  /** Campaigns removed: this user's own, plus any whose draft is erased. */
  readonly campaignIds: readonly string[];
  readonly roomIds: readonly string[];
  /** Drafts kept alive for another owner's campaign. */
  readonly reassignments: readonly DraftReassignment[];
};

export type AccountErasureScope = AccountErasurePlan & {
  /** Every object under an erased draft's prefix. */
  readonly pitchPaths: readonly string[];
  /** Every object under the user's own profile-media prefix. */
  readonly profilePaths: readonly string[];
  /**
   * Voice-derived objects on the PRESERVED drafts, as of scope collection.
   * Reported by `--dry-run`; the stage that deletes re-enumerates instead of
   * trusting this snapshot.
   */
  readonly voiceDerivedPaths: readonly string[];
};

// ---------------------------------------------------------------------------
// The admin-client surface the erasure actually uses. Narrow on purpose: it is
// the contract a test fake has to satisfy, and a supabase-js service client
// satisfies it structurally.
// ---------------------------------------------------------------------------

export type ErasureRow = Readonly<Record<string, unknown>>;

export type ErasureResult = {
  readonly data?: readonly ErasureRow[] | null | undefined;
  readonly error?: { readonly code?: string | undefined } | null | undefined;
};

export interface ErasureQuery extends PromiseLike<ErasureResult> {
  select(columns: string): ErasureQuery;
  update(values: Readonly<Record<string, unknown>>): ErasureQuery;
  delete(): ErasureQuery;
  eq(column: string, value: string): ErasureQuery;
  in(column: string, values: readonly string[]): ErasureQuery;
  /** PostgREST `or=` syntax; only `column.eq.value` terms are used here. */
  or(filter: string): ErasureQuery;
  like(column: string, pattern: string): ErasureQuery;
  order(column: string, options: { readonly ascending: boolean }): ErasureQuery;
  range(from: number, to: number): ErasureQuery;
}

export type ErasureStorageEntry = {
  readonly name: string;
  /** `null` marks a folder, which is how supabase-js reports one. */
  readonly id: string | null;
};

export type ErasureStorageListOptions = {
  readonly limit: number;
  readonly offset: number;
  readonly sortBy: { readonly column: string; readonly order: string };
};

export type ErasureStorageBucket = {
  list(
    folder: string,
    options: ErasureStorageListOptions,
  ): PromiseLike<{
    readonly data?: readonly ErasureStorageEntry[] | null | undefined;
    readonly error?: unknown;
  }>;
  remove(paths: readonly string[]): PromiseLike<ErasureResult>;
};

export type ErasureAdminClient = {
  from(table: string): ErasureQuery;
  rpc(name: string, params: Readonly<Record<string, string>>): PromiseLike<ErasureResult>;
  storage: { from(bucket: string): ErasureStorageBucket };
  auth: {
    admin: {
      deleteUser(
        userId: string,
      ): PromiseLike<{ readonly error?: { readonly status?: number } | null | undefined }>;
    };
  };
};

export declare const VOICE_OBJECT_NAME: string;
export declare const RENDER_PREFIX: string;

export declare function voiceObjectPath(draftId: string): string;
export declare function renderFolderPath(draftId: string): string;
export declare function isVoiceDerivedPath(draftId: string, objectPath: string): boolean;

export declare function planAccountErasure(input: {
  readonly userId: string;
  readonly drafts: readonly ErasureDraftRow[];
  readonly campaigns: readonly ErasureCampaignRow[];
  readonly rooms: readonly ErasureRoomRow[];
}): AccountErasurePlan;

export declare function collectVoiceDerivedPaths(
  preservedDraftIds: readonly string[],
  listPaths: (folder: string) => Promise<readonly string[]>,
): Promise<readonly string[]>;

export declare function findSurvivingVoiceDerivedPaths(
  preservedDraftIds: readonly string[],
  listPrefix: (draftId: string) => Promise<readonly string[]>,
): Promise<readonly string[]>;

export declare function chunks<T>(values: readonly T[], size?: number): T[][];

export declare function expectResult(
  operation: PromiseLike<ErasureResult>,
): Promise<readonly ErasureRow[]>;

export declare function runStage<T>(label: string, operation: () => Promise<T>): Promise<T>;

export declare function collectScope(
  admin: ErasureAdminClient,
  userId: string,
): Promise<AccountErasureScope>;

export declare function deleteAccountData(
  admin: ErasureAdminClient,
  userId: string,
  scope: AccountErasureScope,
): Promise<void>;
