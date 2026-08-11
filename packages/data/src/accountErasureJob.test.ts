// THE DEPLOYED DELETION JOB, driven directly.
//
// `packages/data/src/accountErasure.test.ts` pins the two pure decisions. This
// file pins the thing that actually destroys data: `collectScope` and
// `deleteAccountData` from `scripts/lib/accountErasure.mjs`, called with a
// recording fake in place of the service-role client. Until this existed the
// job's stage order, its storage arguments and its retry behaviour were proven
// only by running it against a real project — the worst possible state for a
// data-destruction boundary.
//
// The fake is a plain row store plus a plain object store. It deliberately does
// NOT model FK cascades or RLS: those belong to
// `supabase/tests/33_account_deletion_boundary.sql`, which runs against the real
// migrations. What it does model is the shape of the calls (PostgREST filters,
// storage folder listings, RPCs, the GoTrue admin delete) and the fact that
// state written by one stage is visible to the next — which is exactly what the
// retry-convergence test needs.
import { describe, expect, it } from 'vitest';

import {
  collectScope,
  deleteAccountData,
  renderFolderPath,
  voiceObjectPath,
  type ErasureAdminClient,
  type ErasureQuery,
  type ErasureResult,
  type ErasureStorageEntry,
} from '../../../scripts/lib/accountErasure.mjs';

const INTRODUCER = '00000000-0000-4000-8000-00000000000a';
const DATER_ONE = '00000000-0000-4000-8000-00000000000b';
const DATER_TWO = '00000000-0000-4000-8000-00000000000c';

const DRAFT_ONE = '10000000-0000-4000-8000-000000000001';
const DRAFT_TWO = '10000000-0000-4000-8000-000000000002';

const CAMPAIGN_ONE = '20000000-0000-4000-8000-000000000001';
const CAMPAIGN_TWO = '20000000-0000-4000-8000-000000000002';

const REVISION_ONE = '30000000-0000-4000-8000-000000000001';
const REVISION_TWO = '30000000-0000-4000-8000-000000000002';

const renderPath = (draftId: string, revisionId: string): string =>
  `${renderFolderPath(draftId)}/${revisionId}.mp4`;
const daterPhotoPath = (draftId: string): string => `${draftId}/dater-photo.jpg`;

// ---------------------------------------------------------------------------
// The fake project.
// ---------------------------------------------------------------------------

type StoredRow = Record<string, unknown>;

type OrTerm = { readonly column: string; readonly value: string };

type Filter =
  | { readonly kind: 'eq'; readonly column: string; readonly value: string }
  | { readonly kind: 'in'; readonly column: string; readonly values: readonly string[] }
  | { readonly kind: 'or'; readonly terms: readonly OrTerm[] }
  | { readonly kind: 'like'; readonly column: string; readonly pattern: string };

type QueryVerb = 'select' | 'update' | 'delete';

const FAULT: ErasureResult = { data: null, error: { code: 'FAKE_FAULT' } };

/** Only `column.eq.value` terms exist in this job; anything else is a fake bug. */
function parseOrFilter(filter: string): OrTerm[] {
  return filter.split(',').map((term) => {
    const [column, operator, ...rest] = term.split('.');
    if (column === undefined || operator !== 'eq') {
      throw new Error(`the erasure fake cannot parse the or() term "${term}"`);
    }
    return { column, value: rest.join('.') };
  });
}

function likePattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/%/g, '.*')}$`);
}

function matchesFilters(row: StoredRow, filters: readonly Filter[]): boolean {
  return filters.every((filter) => {
    switch (filter.kind) {
      case 'eq':
        return row[filter.column] === filter.value;
      case 'in':
        return filter.values.some((value) => value === row[filter.column]);
      case 'or':
        return filter.terms.some((term) => row[term.column] === term.value);
      case 'like': {
        const value = row[filter.column];
        return typeof value === 'string' && likePattern(filter.pattern).test(value);
      }
    }
  });
}

type RowDeletion = { readonly table: string; readonly filters: readonly Filter[] };
type StorageRemoval = { readonly bucket: string; readonly paths: readonly string[] };
type RpcCall = { readonly name: string; readonly params: Readonly<Record<string, string>> };

class FakeProject {
  /** Every call the job made, in order, as `<verb>:<target>`. */
  readonly log: string[] = [];
  readonly rowDeletions: RowDeletion[] = [];
  readonly storageRemovals: StorageRemoval[] = [];
  readonly rpcCalls: RpcCall[] = [];
  readonly deletedAuthUsers: string[] = [];
  /**
   * `remove()` answering "no error" while the bytes stay. supabase-js reports
   * per-object storage failures inside the payload rather than as a bucket
   * error, so this is a real production shape — and the reason the stage
   * re-lists instead of trusting the call.
   */
  storageRemoveIsNoop = false;

  private readonly tables = new Map<string, StoredRow[]>();
  private readonly buckets = new Map<string, Set<string>>();
  private readonly faults = new Map<string, number>();
  private readonly callCounts = new Map<string, number>();

  seedRows(table: string, rows: readonly StoredRow[]): void {
    this.rowsOf(table).push(...rows.map((row) => ({ ...row })));
  }

  seedObjects(bucket: string, paths: readonly string[]): void {
    const objects = this.objectsOf(bucket);
    for (const path of paths) objects.add(path);
  }

  /** Makes the `occurrence`-th call of `operation` answer with an error. */
  failAt(operation: string, occurrence: number): void {
    this.faults.set(operation, occurrence);
  }

  objects(bucket: string): readonly string[] {
    return [...this.objectsOf(bucket)].sort();
  }

  rows(table: string): readonly StoredRow[] {
    return this.rowsOf(table).map((row) => ({ ...row }));
  }

  removedPaths(bucket: string): readonly string[] {
    return this.storageRemovals
      .filter((removal) => removal.bucket === bucket)
      .flatMap((removal) => [...removal.paths]);
  }

  get admin(): ErasureAdminClient {
    return {
      from: (table) => this.query(table),
      rpc: (name, params) => Promise.resolve(this.runRpc(name, params)),
      storage: {
        from: (bucket) => ({
          list: (folder, options) => Promise.resolve(this.listObjects(bucket, folder, options)),
          remove: (paths) => Promise.resolve(this.removeObjects(bucket, paths)),
        }),
      },
      auth: {
        admin: {
          deleteUser: (userId) => {
            if (this.record('auth.deleteUser')) {
              return Promise.resolve({ error: { status: 500 } });
            }
            this.deletedAuthUsers.push(userId);
            return Promise.resolve({ error: null });
          },
        },
      },
    };
  }

  private rowsOf(table: string): StoredRow[] {
    const existing = this.tables.get(table);
    if (existing !== undefined) return existing;
    const created: StoredRow[] = [];
    this.tables.set(table, created);
    return created;
  }

  private objectsOf(bucket: string): Set<string> {
    const existing = this.buckets.get(bucket);
    if (existing !== undefined) return existing;
    const created = new Set<string>();
    this.buckets.set(bucket, created);
    return created;
  }

  /** Logs the call and answers whether this is the occurrence asked to fail. */
  private record(operation: string): boolean {
    const seen = (this.callCounts.get(operation) ?? 0) + 1;
    this.callCounts.set(operation, seen);
    this.log.push(operation);
    return this.faults.get(operation) === seen;
  }

  private runRpc(name: string, params: Readonly<Record<string, string>>): ErasureResult {
    if (this.record(`rpc:${name}`)) return FAULT;
    this.rpcCalls.push({ name, params: { ...params } });
    if (name === 'erase_pitch_draft') {
      const draftId = params['target_draft_id'];
      this.deleteWhere('consent_requests', (row) => row['pitch_draft_id'] === draftId);
      this.deleteWhere('pitch_drafts', (row) => row['id'] === draftId);
    }
    // reassign_pitch_storage_owner rewrites storage.objects.owner_id, which this
    // fake does not model; the row change that matters to the job is the
    // explicit pitch_drafts update the stage performs right after it.
    return { data: [], error: null };
  }

  private deleteWhere(table: string, predicate: (row: StoredRow) => boolean): void {
    const rows = this.rowsOf(table);
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row !== undefined && predicate(row)) rows.splice(index, 1);
    }
  }

  private listObjects(
    bucket: string,
    folder: string,
    options: { readonly limit: number; readonly offset: number },
  ): { readonly data: readonly ErasureStorageEntry[] | null; readonly error: unknown } {
    if (this.record(`storage.list:${bucket}`)) return { data: null, error: FAULT.error };
    const entries = new Map<string, ErasureStorageEntry>();
    const prefix = `${folder}/`;
    for (const path of [...this.objectsOf(bucket)].sort()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const separator = rest.indexOf('/');
      if (separator < 0) {
        entries.set(rest, { name: rest, id: `object:${path}` });
      } else {
        const directory = rest.slice(0, separator);
        if (!entries.has(directory)) entries.set(directory, { name: directory, id: null });
      }
    }
    return {
      data: [...entries.values()].slice(options.offset, options.offset + options.limit),
      error: null,
    };
  }

  private removeObjects(bucket: string, paths: readonly string[]): ErasureResult {
    if (this.record(`storage.remove:${bucket}`)) return FAULT;
    this.storageRemovals.push({ bucket, paths: [...paths] });
    if (!this.storageRemoveIsNoop) {
      const objects = this.objectsOf(bucket);
      for (const path of paths) objects.delete(path);
    }
    return { data: [], error: null };
  }

  private query(table: string): ErasureQuery {
    const filters: Filter[] = [];
    let verb: QueryVerb = 'select';
    let updates: Readonly<Record<string, unknown>> = {};
    let sortColumn: string | null = null;
    let sliceRange: { readonly from: number; readonly to: number } | null = null;

    const run = (): ErasureResult => {
      if (this.record(`${verb}:${table}`)) return FAULT;
      const rows = this.rowsOf(table);
      let matched = rows.filter((row) => matchesFilters(row, filters));
      if (verb === 'delete') {
        this.rowDeletions.push({ table, filters: [...filters] });
        for (const row of matched) {
          const index = rows.indexOf(row);
          if (index >= 0) rows.splice(index, 1);
        }
      } else if (verb === 'update') {
        for (const row of matched) Object.assign(row, updates);
      } else {
        const column = sortColumn;
        if (column !== null) {
          matched = [...matched].sort((left, right) =>
            String(left[column]).localeCompare(String(right[column])),
          );
        }
        if (sliceRange !== null) matched = matched.slice(sliceRange.from, sliceRange.to + 1);
      }
      return { data: matched.map((row) => ({ ...row })), error: null };
    };

    const query: ErasureQuery = {
      select: () => query,
      update: (values) => {
        verb = 'update';
        updates = values;
        return query;
      },
      delete: () => {
        verb = 'delete';
        return query;
      },
      eq: (column, value) => {
        filters.push({ kind: 'eq', column, value });
        return query;
      },
      in: (column, values) => {
        filters.push({ kind: 'in', column, values: [...values] });
        return query;
      },
      or: (filter) => {
        filters.push({ kind: 'or', terms: parseOrFilter(filter) });
        return query;
      },
      like: (column, pattern) => {
        filters.push({ kind: 'like', column, pattern });
        return query;
      },
      order: (column) => {
        sortColumn = column;
        return query;
      },
      range: (from, to) => {
        sliceRange = { from, to };
        return query;
      },
      then: <TResult1 = ErasureResult, TResult2 = never>(
        onfulfilled?: ((value: ErasureResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): PromiseLike<TResult1 | TResult2> => Promise.resolve(run()).then(onfulfilled, onrejected),
    };
    return query;
  }
}

type SharedCampaign = {
  readonly draftId: string;
  readonly ownerId: string;
  readonly campaignId: string;
  readonly revisionId: string;
};

/**
 * One introducer and the drafts they recorded for other people's campaigns.
 * Every preserved prefix holds the introducer's voice, the render that copies
 * it, and a photo the dater supplied — the photo is the control, because the
 * draft is being kept FOR them.
 */
function seedSharedCampaigns(preserved: readonly SharedCampaign[]): FakeProject {
  const project = new FakeProject();
  project.seedRows(
    'pitch_drafts',
    preserved.map((entry) => ({
      id: entry.draftId,
      created_by_user_id: INTRODUCER,
      subject_user_id: entry.ownerId,
    })),
  );
  project.seedRows(
    'campaigns',
    preserved.map((entry) => ({
      id: entry.campaignId,
      pitch_draft_id: entry.draftId,
      owner_user_id: entry.ownerId,
    })),
  );
  project.seedRows(
    'media_render_jobs',
    preserved.map((entry) => ({
      id: `job-${entry.draftId}`,
      pitch_draft_id: entry.draftId,
      campaign_id: entry.campaignId,
    })),
  );
  project.seedRows(
    'media_validations',
    preserved.flatMap((entry) => [
      { bucket_id: 'pitch-media', object_name: voiceObjectPath(entry.draftId) },
      { bucket_id: 'pitch-media', object_name: renderPath(entry.draftId, entry.revisionId) },
      { bucket_id: 'pitch-media', object_name: daterPhotoPath(entry.draftId) },
    ]),
  );
  project.seedObjects(
    'pitch-media',
    preserved.flatMap((entry) => [
      voiceObjectPath(entry.draftId),
      renderPath(entry.draftId, entry.revisionId),
      daterPhotoPath(entry.draftId),
    ]),
  );
  project.seedObjects('profile-media', [`${INTRODUCER}/me.jpg`]);
  return project;
}

const ONE_SHARED_CAMPAIGN: readonly SharedCampaign[] = [
  { draftId: DRAFT_ONE, ownerId: DATER_ONE, campaignId: CAMPAIGN_ONE, revisionId: REVISION_ONE },
];

const TWO_SHARED_CAMPAIGNS: readonly SharedCampaign[] = [
  ...ONE_SHARED_CAMPAIGN,
  { draftId: DRAFT_TWO, ownerId: DATER_TWO, campaignId: CAMPAIGN_TWO, revisionId: REVISION_TWO },
];

/** One full attempt, exactly as `processRequest` runs it. */
async function runErasure(project: FakeProject, userId: string): Promise<void> {
  const admin = project.admin;
  const scope = await collectScope(admin, userId);
  await deleteAccountData(admin, userId, scope);
}

describe('deleteAccountData on a preserved draft', () => {
  it('names the voice recording and the render that copies it', async () => {
    const project = seedSharedCampaigns(ONE_SHARED_CAMPAIGN);

    await runErasure(project, INTRODUCER);

    const removed = project.removedPaths('pitch-media');
    expect(removed).toContain(voiceObjectPath(DRAFT_ONE));
    expect(removed).toContain(renderPath(DRAFT_ONE, REVISION_ONE));
    // The control: the draft survives for the dater, and so does their photo.
    expect(removed).not.toContain(daterPhotoPath(DRAFT_ONE));
    expect(project.objects('pitch-media')).toEqual([daterPhotoPath(DRAFT_ONE)]);
    expect(project.rows('pitch_drafts')).toEqual([
      { id: DRAFT_ONE, created_by_user_id: DATER_ONE, subject_user_id: DATER_ONE },
    ]);
    expect(project.deletedAuthUsers).toEqual([INTRODUCER]);
  });

  it('deletes the render job rows before the objects they advertise', async () => {
    const project = seedSharedCampaigns(ONE_SHARED_CAMPAIGN);

    await runErasure(project, INTRODUCER);

    const renderJobDeletion = project.rowDeletions.find(
      (deletion) => deletion.table === 'media_render_jobs',
    );
    expect(renderJobDeletion?.filters).toEqual([
      { kind: 'in', column: 'pitch_draft_id', values: [DRAFT_ONE] },
    ]);
    expect(project.rows('media_render_jobs')).toEqual([]);
    // `output_storage_path` must never outlive its object, so the row goes first.
    expect(project.log.indexOf('delete:media_render_jobs')).toBeLessThan(
      project.log.indexOf('storage.remove:pitch-media'),
    );
  });

  it('drops the validation ledger of the erased objects but not of the dater photo', async () => {
    const project = seedSharedCampaigns(ONE_SHARED_CAMPAIGN);

    await runErasure(project, INTRODUCER);

    expect(project.rows('media_validations')).toEqual([
      { bucket_id: 'pitch-media', object_name: daterPhotoPath(DRAFT_ONE) },
    ]);
  });

  it('fails the stage when the objects are still there after the removal', async () => {
    // A removal that reports success and deletes nothing must not be reported as
    // an erasure: the request stays `failed` and the operator retries.
    const project = seedSharedCampaigns(ONE_SHARED_CAMPAIGN);
    project.storageRemoveIsNoop = true;

    await expect(runErasure(project, INTRODUCER)).rejects.toThrow('introducer voice erasure');
    // The transfer is downstream of the failed stage, so the draft is still the
    // deleted user's — which is what lets the retry see it at all.
    expect(project.rows('pitch_drafts')).toEqual([
      { id: DRAFT_ONE, created_by_user_id: INTRODUCER, subject_user_id: DATER_ONE },
    ]);
  });
});

// The regression the stage order exists for. The ownership transfer is the one
// stage that takes a preserved draft out of `collectScope`'s reach: afterwards
// the draft is neither created by nor about the deleted user, so no later
// attempt can find it. With the voice erasure downstream of the transfer, a
// failure in the window between them stranded the recording in storage for
// good — every retry rebuilt a scope that no longer mentioned the draft and
// then reported success.
describe('retry convergence after a mid-transfer failure', () => {
  it('has already erased the voice by the time a draft can become invisible', async () => {
    const project = seedSharedCampaigns(TWO_SHARED_CAMPAIGNS);
    // A transient failure on the SECOND draft's transfer: by then the first
    // draft has been handed over and the second has not.
    project.failAt('rpc:reassign_pitch_storage_owner', 2);

    await expect(runErasure(project, INTRODUCER)).rejects.toThrow(
      'shared campaign ownership transfer',
    );
    expect(project.rows('pitch_drafts')).toEqual([
      { id: DRAFT_ONE, created_by_user_id: DATER_ONE, subject_user_id: DATER_ONE },
      { id: DRAFT_TWO, created_by_user_id: INTRODUCER, subject_user_id: DATER_TWO },
    ]);

    // The retry: a fresh scope, which can no longer see the transferred draft.
    await runErasure(project, INTRODUCER);

    expect(project.objects('pitch-media')).toEqual([
      daterPhotoPath(DRAFT_ONE),
      daterPhotoPath(DRAFT_TWO),
    ]);
    expect(project.rows('media_render_jobs')).toEqual([]);
    expect(project.deletedAuthUsers).toEqual([INTRODUCER]);
  });
});
