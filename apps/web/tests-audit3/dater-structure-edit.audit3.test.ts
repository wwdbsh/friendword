// FIFTH-AUDIT REGRESSION — P0 (the Dater approves the words that publish).
// Runs in the audit3 harness because it is the web app's only node test runner.
//
// The public page renders `structure` and ignores the approved body whenever
// structure is non-null, so the Dater's edit only reaches readers if the edited
// structure travels: consent editor -> create_dater_revision -> approved
// revision -> pitch_drafts.structure -> PitchView.structure -> the five labeled
// scenes. This pins the two ends the web side owns:
//   (a) the moderated text of a structure edit includes the three qualities, so
//       the ledger hash matches private.dater_revision_moderation_text (0047)
//       and quality text cannot publish unmoderated;
//   (b) fromPublishedPitch surfaces the edited quality (not the AI's original)
//       as PitchView.structure.three_specific_qualities — the exact array
//       app/p/[campaignSlug]/page.tsx maps over under "Three specific things".
/* global afterEach, beforeEach, describe, expect, it, vi */

import { createHash } from 'node:crypto';

import { daterPitchModerationText } from '@friendword/contracts';

import { createServiceFake } from './serviceClientFake';

const CALLER_ID = '11111111-1111-4111-8111-111111111111';
const DRAFT_ID = '33333333-3333-4333-8333-333333333333';

const EDITED_STRUCTURE = {
  hook: 'Blair, in Blair’s own words.',
  relationship_context: 'We shared a wall for four years.',
  three_specific_qualities: [
    'Remembers every birthday',
    'Makes the quiet person feel included',
    'Never gossips',
  ],
  evidence_or_anecdote: 'Blair drove three hours to sit with me after surgery.',
  good_match_for: 'Someone who likes long walks and longer conversations.',
};

const DERIVED_HEADLINE = EDITED_STRUCTURE.hook;
const DERIVED_BODY = `${EDITED_STRUCTURE.relationship_context}\n\n${EDITED_STRUCTURE.evidence_or_anecdote}\n\nA good match: ${EDITED_STRUCTURE.good_match_for}`;
const EXPECTED_CONTENT = `${DERIVED_HEADLINE}\n\n${DERIVED_BODY}\n\n${EDITED_STRUCTURE.three_specific_qualities.join('\n\n')}`;
const EXPECTED_HASH = createHash('sha256').update(EXPECTED_CONTENT, 'utf8').digest('hex');

const checkImage = vi.fn();
const checkText = vi.fn();

const mocks = vi.hoisted(() => ({
  getSupabaseServiceClient: vi.fn<() => unknown>(),
}));

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServiceClient: mocks.getSupabaseServiceClient,
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

vi.mock('@friendword/adapters', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createProviders: () => ({
      moderation: { checkImage, checkText },
      transcription: {},
      pitchStructure: {},
      identityVerification: {},
    }),
  };
});

import { POST } from '../app/api/moderate-text/route';
import {
  daterControlLine,
  structureProvenanceLine,
  transcriptProvenanceLine,
} from '../src/pitch/copy';
import { fromPublishedPitch, toPitchPlayerView } from '../src/pitch/view';

describe('[a] moderate-text — a structure edit moderates the published qualities too', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.OPENAI_API_KEY = 'sk-test';
    checkImage.mockReset();
    checkText.mockReset();
    mocks.getSupabaseServiceClient.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hashes headline + derived body + the three qualities', async () => {
    const fake = createServiceFake({
      draftSubjectId: CALLER_ID,
      draftStatus: 'consent_pending',
      reserveRow: {
        reservation_id: 'res-1',
        prior_status: 'new',
        granted: true,
        lease_token: 'lease-1',
      },
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    checkText.mockResolvedValue({ allowed: true, categories: [] });

    const response = await POST(
      new Request('http://localhost/api/moderate-text', {
        method: 'POST',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'dater_pitch_content',
          draftId: DRAFT_ID,
          headline: DERIVED_HEADLINE,
          body: DERIVED_BODY,
          qualities: EDITED_STRUCTURE.three_specific_qualities,
        }),
      }),
    );

    expect(response.status).toBe(200);
    // The contract helper and the route must produce the same bytes.
    expect(daterPitchModerationText(EDITED_STRUCTURE)).toBe(EXPECTED_CONTENT);
    expect(checkText).toHaveBeenCalledWith(EXPECTED_CONTENT);
    expect(checkText.mock.calls[0]?.[0]).toContain('Never gossips');

    const written = fake.upserts.find((entry) => entry.table === 'text_moderations');
    expect(written?.row).toMatchObject({
      scope: 'pitch_content',
      content_hash: EXPECTED_HASH,
      moderation_status: 'passed',
    });
  });

  it('rejects a quality list that is not exactly three entries', async () => {
    const fake = createServiceFake({
      draftSubjectId: CALLER_ID,
      draftStatus: 'consent_pending',
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(
      new Request('http://localhost/api/moderate-text', {
        method: 'POST',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'dater_pitch_content',
          draftId: DRAFT_ID,
          headline: DERIVED_HEADLINE,
          body: DERIVED_BODY,
          qualities: ['only', 'two'],
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(checkText).toHaveBeenCalledTimes(0);
  });
});

describe('[b] published view — the edited structure is what the page renders', () => {
  const publishedPitch = {
    campaignId: '20000000-0000-0000-0000-000000000001',
    campaignSlug: 'blair-edited',
    publishedAt: '2026-07-29T00:00:00Z',
    daterDisplayName: 'Blair',
    introducerDisplayName: 'Maya',
    relationshipType: 'friend',
    relationshipDuration: 'y3to10',
    headline: DERIVED_HEADLINE,
    body: DERIVED_BODY,
    transcript: null,
    structure: { ...EDITED_STRUCTURE, hard_claims_requiring_confirmation: ['Blair owns a home.'] },
    age: 32,
    datingIntent: 'long-term',
    approximateLocation: 'Seattle, Puget Sound',
    voiceUrl: null,
    daterReviewedStructure: true,
    photos: [{ url: 'https://storage.example/one.jpg', sortOrder: 0 }],
  };

  const toView = (overrides: Record<string, unknown> = {}) =>
    fromPublishedPitch({ ...publishedPitch, ...overrides } as unknown as Parameters<
      typeof fromPublishedPitch
    >[0]);

  it('carries the Dater-edited quality into the rendered structure', () => {
    const view = toView();

    // page.tsx renders `structure` and ignores approvedBody when it is present.
    expect(view.structure).not.toBeNull();
    expect(view.structure?.three_specific_qualities).toEqual(
      EDITED_STRUCTURE.three_specific_qualities,
    );
    expect(view.structure?.three_specific_qualities).toContain(
      'Makes the quiet person feel included',
    );
    expect(view.structure?.hook).toBe(DERIVED_HEADLINE);
    // The approved body stays the derived projection of the same structure.
    expect(view.approvedBody).toBe(DERIVED_BODY);
  });

  // FIFTH-AUDIT REGRESSION (verdict 4). The leak was structural: page.tsx
  // handed the whole pitch to a 'use client' component, so Next serialized
  // `structure` — hard claims included — into the page source. Two independent
  // guards, because either alone can rot: the read boundary must drop the
  // flagged claims, and the player's props must not carry the published prose.
  it('never lets a flagged claim or the prose reach the client component', () => {
    const view = toView();
    const serializedView = JSON.stringify(view);
    const serializedPlayerProps = JSON.stringify(toPitchPlayerView(view));

    // Guard 1: the read boundary drops hard_claims_requiring_confirmation.
    expect(serializedView).not.toContain('Blair owns a home.');
    expect(serializedView).not.toContain('hard_claims_requiring_confirmation');

    // Guard 2: whatever else lands in PitchView, the player gets none of the
    // published prose — the props object below IS the flight payload.
    expect(serializedPlayerProps).not.toContain('Blair owns a home.');
    expect(serializedPlayerProps).not.toContain(EDITED_STRUCTURE.hook);
    expect(serializedPlayerProps).not.toContain(EDITED_STRUCTURE.evidence_or_anecdote);
    expect(serializedPlayerProps).not.toContain(DERIVED_BODY);
    expect(Object.keys(toPitchPlayerView(view))).not.toContain('structure');
    // …while still carrying everything the player actually draws.
    expect(serializedPlayerProps).toContain('Blair');
    expect(serializedPlayerProps).toContain('https://storage.example/one.jpg');
  });
});

// FIFTH-AUDIT REGRESSION (verdicts 2/4/6, decision D6). Each public sentence is
// only allowed to claim what the row proves. Before this, every page said the
// Dater "reviewed and approved this page" — false for rows published before the
// section editor, and false about the transcript on every row.
describe('[c] public copy — no sentence outruns what the row proves', () => {
  const reviewed = {
    daterName: 'Blair',
    introducerPseudonym: 'Maya',
    daterReviewedStructure: true,
    isDemo: false,
    audioUrl: 'https://storage.example/voice.m4a',
  };
  const notReviewed = { ...reviewed, daterReviewedStructure: false };

  it('only claims a section review when structure_reviewed carried through', () => {
    expect(structureProvenanceLine(reviewed)).toContain('reviewed and approved each section');
    expect(structureProvenanceLine(notReviewed)).not.toContain('reviewed and approved');
    expect(structureProvenanceLine(notReviewed)).toContain('agreed to publish this page');
    expect(structureProvenanceLine({ ...notReviewed, isDemo: true })).toContain('Demo data');
  });

  it('never says the Dater edited the claims or the wording on an unreviewed row', () => {
    // The old sentence: "edited the wording, photos, and claims". Claims are
    // disposed of, not edited, and an unreviewed row's wording was never theirs.
    expect(daterControlLine(reviewed)).not.toContain('edited the wording');
    expect(daterControlLine(notReviewed)).not.toContain('edited the wording');
    expect(daterControlLine(notReviewed)).not.toContain('approved each written section');
    expect(daterControlLine(reviewed)).toContain('approved each written section');
    // Unchanged product terms the interest flow enforces.
    expect(daterControlLine(notReviewed)).toContain(
      'Interest requires signing in and completing a dating profile with 2 photos, a bio, and dating intent.',
    );
  });

  it('points at the caption surface only when captions actually render', () => {
    const base = { daterName: 'Blair', introducerPseudonym: 'Maya' };
    expect(transcriptProvenanceLine({ ...base, transcriptText: null, captions: [] })).toBeNull();
    expect(
      transcriptProvenanceLine({ ...base, transcriptText: 'Blair is great.', captions: [] }),
    ).not.toContain('captions');
    expect(
      transcriptProvenanceLine({
        ...base,
        transcriptText: 'Blair is great.',
        captions: [{ startMs: 0, endMs: 1000, text: 'Blair is great.' }],
      }),
    ).toContain('captions');
  });
});
