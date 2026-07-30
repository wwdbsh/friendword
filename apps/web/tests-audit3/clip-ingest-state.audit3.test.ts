// PHASE 3A — /api/media/clip-ingest-state authorization and projection.
//
// The route answers the contract the mobile app wired first
// (apps/mobile/src/services/clipIngest.ts): bearer Supabase JWT, body
// {bucket:'pitch-media', draftId, objectNames}, response {states:{...}}.
// Pinned here:
//   (a) the draft's creator may read at any draft status
//   (b) the subject may read ONLY while the draft is consent_pending
//   (c) a stranger gets 403 and no ingest row is ever queried
//   (d) no bearer token → 401 before anything else
//   (e) the payload NEVER carries face_boxes — the 0050 service-only contract,
//       same discipline as the pitch-player projection tests.
/* global beforeEach, describe, expect, it, vi */

const CALLER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const DRAFT_ID = '33333333-3333-4333-8333-333333333333';
const ASSET_ID = '44444444-4444-4444-8444-444444444444';
const OBJECT_NAME = 'clip-abc123.mp4';

const mocks = vi.hoisted(() => ({
  getSupabaseServiceClient: vi.fn<() => unknown>(),
  triggerIngestRun: vi.fn(async () => undefined),
}));

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServiceClient: mocks.getSupabaseServiceClient,
}));

vi.mock('@/lib/clipIngest/trigger', () => ({
  triggerIngestRun: mocks.triggerIngestRun,
  ingestRunSecret: () => null,
}));

vi.mock('@friendword/data', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createBrowserClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: CALLER_ID } }, error: null }),
      },
    }),
  };
});

import { POST } from '../app/api/media/clip-ingest-state/route';

type FakeConfig = {
  readonly draftOwnerId: string;
  readonly draftSubjectId: string | null;
  readonly draftStatus: string;
  readonly ingestRow?: Record<string, unknown>;
};

type FakeState = {
  readonly client: unknown;
  readonly queriedTables: string[];
};

function createFake(config: FakeConfig): FakeState {
  const queriedTables: string[] = [];
  const ingestRow = config.ingestRow ?? {
    asset_id: ASSET_ID,
    ingest_status: 'succeeded',
    duration_ms: 9_000,
    proxy_path: `pitch-media/${DRAFT_ID}/clip-${ASSET_ID}-proxy.mp4`,
    poster_path: `pitch-media/${DRAFT_ID}/clip-${ASSET_ID}-poster.jpg`,
    // A leaked column would surface in the payload scan in [e]; the fake
    // carries it so the route has to actively not select/forward it.
    face_boxes: [{ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }],
  };

  function makeQuery(table: string) {
    queriedTables.push(table);
    const resolve = () => {
      if (table === 'users') {
        return { data: { account_status: 'active' }, error: null };
      }
      if (table === 'pitch_drafts') {
        return {
          data: {
            created_by_user_id: config.draftOwnerId,
            subject_user_id: config.draftSubjectId,
            status: config.draftStatus,
          },
          error: null,
        };
      }
      if (table === 'pitch_assets') {
        return {
          data: [
            {
              id: ASSET_ID,
              storage_path: `pitch-media/${DRAFT_ID}/${OBJECT_NAME}`,
            },
          ],
          error: null,
        };
      }
      if (table === 'pitch_video_ingests') {
        return { data: [ingestRow], error: null };
      }
      return { data: null, error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      maybeSingle: () => Promise.resolve(resolve()),
      single: () => Promise.resolve(resolve()),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    };
    return builder;
  }

  const client = {
    from: (table: string) => makeQuery(table),
    storage: {
      from: () => ({
        createSignedUrl: (objectPath: string) =>
          Promise.resolve({
            data: { signedUrl: `https://signed.example/${objectPath}` },
            error: null,
          }),
      }),
    },
  };

  return { client, queriedTables };
}

function stateRequest(body?: Record<string, unknown>, withAuth = true): Request {
  return new Request('http://localhost/api/media/clip-ingest-state', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(withAuth ? { authorization: 'Bearer token' } : {}),
    },
    body: JSON.stringify(
      body ?? { bucket: 'pitch-media', draftId: DRAFT_ID, objectNames: [OBJECT_NAME] },
    ),
  });
}

describe('media/clip-ingest-state — authorization and projection', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    mocks.getSupabaseServiceClient.mockReset();
    mocks.triggerIngestRun.mockClear();
  });

  it('[a] creator: 200 with the mobile-pinned states shape and card data', async () => {
    const fake = createFake({
      draftOwnerId: CALLER_ID,
      draftSubjectId: OTHER_ID,
      draftStatus: 'draft',
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(stateRequest());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      states: Record<string, string>;
      clips: Record<string, Record<string, unknown>>;
    };
    expect(payload.states).toEqual({ [OBJECT_NAME]: 'succeeded' });
    expect(payload.clips[OBJECT_NAME]).toMatchObject({ state: 'succeeded', durationMs: 9_000 });
    expect(payload.clips[OBJECT_NAME]?.posterUrl).toContain('https://signed.example/');
  });

  it('[b] subject while consent_pending: 200', async () => {
    const fake = createFake({
      draftOwnerId: OTHER_ID,
      draftSubjectId: CALLER_ID,
      draftStatus: 'consent_pending',
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(stateRequest());
    expect(response.status).toBe(200);
  });

  it('[c] subject after the draft left consent_pending: 403', async () => {
    const fake = createFake({
      draftOwnerId: OTHER_ID,
      draftSubjectId: CALLER_ID,
      draftStatus: 'published',
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(stateRequest());
    expect(response.status).toBe(403);
    expect(fake.queriedTables).not.toContain('pitch_video_ingests');
  });

  it('[d] stranger: 403 before any ingest read', async () => {
    const fake = createFake({
      draftOwnerId: OTHER_ID,
      draftSubjectId: OTHER_ID,
      draftStatus: 'consent_pending',
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(stateRequest());
    expect(response.status).toBe(403);
    expect(fake.queriedTables).not.toContain('pitch_assets');
    expect(fake.queriedTables).not.toContain('pitch_video_ingests');
  });

  it('[e] no bearer token: 401; malformed body: 400', async () => {
    const fake = createFake({
      draftOwnerId: CALLER_ID,
      draftSubjectId: null,
      draftStatus: 'draft',
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    expect((await POST(stateRequest(undefined, false))).status).toBe(401);
    expect(
      (
        await POST(
          stateRequest({ bucket: 'profile-media', draftId: DRAFT_ID, objectNames: [OBJECT_NAME] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          stateRequest({ bucket: 'pitch-media', draftId: DRAFT_ID, objectNames: ['../../etc'] }),
        )
      ).status,
    ).toBe(400);
  });

  it('[f] the payload never carries face_boxes, even when the row does', async () => {
    const fake = createFake({
      draftOwnerId: CALLER_ID,
      draftSubjectId: OTHER_ID,
      draftStatus: 'draft',
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(stateRequest());
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain('face_boxes');
    expect(serialized).not.toContain('faceBoxes');
    expect(serialized).not.toContain('0.25');
  });
});
