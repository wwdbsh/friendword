// UNCONFIRMED DISPLAY NAMES ON THE TWO IMAGE ROUTES (T002, Issue #71).
//
// `private.handle_new_auth_user` (0011) seeds `profiles.display_name` from the
// email local-part and marks it `display_name_confirmed = false`. /api/og is
// scraped into other people's timelines and /api/kit-image is made to be
// posted, so both must print a name only once its owner has confirmed one.
//
// The test asserts on the rendered element tree (ImageResponse is captured, not
// rasterised) AND on the columns each route selected — a route that forgot to
// ask for `display_name_confirmed` would otherwise "pass" by treating every
// name as unconfirmed.
/* global beforeEach, describe, expect, it, vi */

const OWNER = '00000000-0000-0000-0000-000000000002';
const INTRODUCER = '00000000-0000-0000-0000-000000000001';
const DRAFT_ID = '10000000-0000-0000-0000-000000000001';

type ProfileRow = {
  user_id: string;
  display_name: string;
  display_name_confirmed: boolean;
};

const mocks = vi.hoisted(() => ({
  getSupabaseServiceClient: vi.fn<() => unknown>(),
  captured: [] as unknown[],
  selects: [] as string[],
}));

vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(element: unknown) {
      mocks.captured.push(element);
    }
  },
}));

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServiceClient: mocks.getSupabaseServiceClient,
}));

vi.mock('@friendword/data', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    isCampaignPubliclyVisible: async () => true,
    createBrowserClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: OWNER } }, error: null }),
      },
    }),
  };
});

import { GET as ogRoute } from '../app/api/og/route';
import { GET as kitRoute } from '../app/api/kit-image/route';

/**
 * One fake PostgREST builder for every table these two routes read. Each
 * terminal (`single`, `maybeSingle`, `order`, `in`) resolves to whatever the
 * table map holds, and every `select()` string is recorded so the test can
 * prove the confirmation column was actually requested.
 */
function fakeServiceClient(profiles: readonly ProfileRow[]): unknown {
  const rows: Record<string, unknown> = {
    campaigns: {
      id: '20000000-0000-0000-0000-000000000001',
      pitch_draft_id: DRAFT_ID,
      owner_user_id: OWNER,
      slug: 'blair-abc123',
    },
    pitch_drafts: {
      id: DRAFT_ID,
      headline: 'A warm introduction.',
      subject_user_id: OWNER,
      created_by_user_id: INTRODUCER,
    },
    share_kits: { id: 'kit-1', unlocked_by_user_id: OWNER },
    profiles,
    pitch_assets: { storage_path: `pitch-media/${DRAFT_ID}/photo-1.jpg` },
  };
  return {
    from: (table: string) => {
      const data = rows[table] ?? null;
      const builder: Record<string, unknown> = {
        select: (columns?: string) => {
          if (typeof columns === 'string') {
            mocks.selects.push(`${table}:${columns}`);
          }
          return builder;
        },
        eq: () => builder,
        or: () => builder,
        order: () => builder,
        limit: () => builder,
        in: async () => ({ data, error: null }),
        single: async () => ({ data, error: null }),
        maybeSingle: async () => ({ data, error: null }),
      };
      return builder;
    },
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://storage.example/${path}` },
          error: null,
        }),
      }),
    },
  };
}

/** Every string in the captured React element tree, flattened. */
function renderedText(element: unknown): string {
  if (typeof element === 'string') {
    return element;
  }
  if (Array.isArray(element)) {
    return element.map(renderedText).join(' ');
  }
  if (typeof element === 'object' && element !== null && 'props' in element) {
    const props = (element as { props?: { children?: unknown } }).props;
    return renderedText(props?.children);
  }
  return '';
}

function confirmed(): readonly ProfileRow[] {
  return [
    { user_id: OWNER, display_name: 'Blair', display_name_confirmed: true },
    { user_id: INTRODUCER, display_name: 'Maya', display_name_confirmed: true },
  ];
}

function unconfirmed(): readonly ProfileRow[] {
  return [
    { user_id: OWNER, display_name: 'blair.kim92', display_name_confirmed: false },
    { user_id: INTRODUCER, display_name: 'maya.park', display_name_confirmed: false },
  ];
}

describe('the OG card', () => {
  beforeEach(() => {
    mocks.captured.length = 0;
    mocks.selects.length = 0;
  });

  it('prints both names once they are confirmed', async () => {
    mocks.getSupabaseServiceClient.mockReturnValue(fakeServiceClient(confirmed()));

    await ogRoute(new Request('https://web.example/api/og?slug=blair-abc123'));

    const text = renderedText(mocks.captured[0]);
    expect(text).toContain('Blair');
    expect(text).toContain('Maya');
  });

  it('prints neither email-derived name while they are unconfirmed', async () => {
    mocks.getSupabaseServiceClient.mockReturnValue(fakeServiceClient(unconfirmed()));

    await ogRoute(new Request('https://web.example/api/og?slug=blair-abc123'));

    const text = renderedText(mocks.captured[0]);
    expect(text).not.toContain('blair.kim92');
    expect(text).not.toContain('maya.park');
    expect(text).toContain('A friend');
    expect(mocks.selects).toContain('profiles:user_id, display_name, display_name_confirmed');
  });
});

describe('the launch-kit image', () => {
  beforeEach(() => {
    mocks.captured.length = 0;
    mocks.selects.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.example';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  });

  function kitRequest(): Request {
    return new Request(`https://web.example/api/kit-image?draftId=${DRAFT_ID}`, {
      headers: { authorization: 'Bearer token-1' },
    });
  }

  it('prints both names once they are confirmed', async () => {
    mocks.getSupabaseServiceClient.mockReturnValue(fakeServiceClient(confirmed()));

    await kitRoute(kitRequest());

    const text = renderedText(mocks.captured[0]);
    expect(text).toContain('Blair');
    expect(text).toContain('Maya');
  });

  it('prints neither email-derived name while they are unconfirmed', async () => {
    mocks.getSupabaseServiceClient.mockReturnValue(fakeServiceClient(unconfirmed()));

    await kitRoute(kitRequest());

    const text = renderedText(mocks.captured[0]);
    expect(text).not.toContain('blair.kim92');
    expect(text).not.toContain('maya.park');
    expect(text).toContain('A friend');
    expect(mocks.selects).toContain('profiles:user_id, display_name, display_name_confirmed');
  });
});
