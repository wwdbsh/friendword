// WHY A PUBLIC PITCH URL IS EMPTY — GAP-7 / T013 (Issue #50).
//
// `getPublishedPitchBySlug` collapses four very different situations into the
// same `null`: a typo, a campaign whose window closed, one the owner took down,
// and one the public gate is deliberately hiding. Only the second of those may
// be told to the reader — expiry is the confirmed terminal state of every
// campaign — and the other three must stay indistinguishable from each other so
// a closed beta never confirms which slugs exist.
//
// These tests pin exactly that split. They fake the PostgREST builder shape the
// repo actually calls (select → eq → maybeSingle), so a change to the query
// shape breaks here rather than silently in production.
import { describe, expect, it } from 'vitest';

import type { ServiceSupabaseClient } from './client';
import { DataLayerError } from './errors';
import { getPublicPitchAbsence } from './publishedPitchRepo';

const DRAFT_ID = '10000000-0000-0000-0000-000000000001';
const NOW = new Date('2026-08-12T00:00:00Z');

type CampaignRow = {
  readonly status: string;
  readonly ends_at: string | null;
  readonly pitch_draft_id: string;
};

type FakeOptions = {
  readonly campaign?: CampaignRow | null;
  readonly campaignError?: { readonly message: string } | null;
  readonly betaValue?: string | null;
  readonly allowlisted?: boolean;
};

function fakeClient(options: FakeOptions = {}) {
  const { campaign = null, campaignError = null, betaValue = 'on', allowlisted = false } = options;
  const tables: string[] = [];
  const client = {
    from: (table: string) => {
      tables.push(table);
      if (table === 'app_config') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: betaValue === null ? null : { value: betaValue },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'qa_preview_allowlist') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: allowlisted ? { pitch_draft_id: DRAFT_ID } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'campaigns') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: campaign, error: campaignError }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
  // Same narrowing the rest of this package's unit tests use: the fake
  // implements exactly the builder chain the function under test calls, and
  // nothing else in ServiceSupabaseClient is reachable from it.
  return { client: client as unknown as ServiceSupabaseClient, tables };
}

describe('getPublicPitchAbsence', () => {
  it('rejects a malformed slug without querying anything', async () => {
    const { client, tables } = fakeClient();

    await expect(getPublicPitchAbsence(client, 'Not A Slug!', NOW)).resolves.toBe('missing');
    expect(tables).toEqual([]);
  });

  it('reports missing for a slug with no campaign row', async () => {
    const { client } = fakeClient({ campaign: null });

    await expect(getPublicPitchAbsence(client, 'nobody-abc123', NOW)).resolves.toBe('missing');
  });

  it('reports ended for a campaign whose status is already expired', async () => {
    const { client } = fakeClient({
      campaign: { status: 'expired', ends_at: null, pitch_draft_id: DRAFT_ID },
    });

    await expect(getPublicPitchAbsence(client, 'jordan-abc123', NOW)).resolves.toBe('ended');
  });

  it('reports ended for a published campaign whose window has passed', async () => {
    // The public read 404s on the timestamp the moment it passes — before the
    // expiration job flips the row — so the reader is told the same thing the
    // owner's own screens say (displayCampaignStatus).
    const { client } = fakeClient({
      campaign: {
        status: 'published',
        ends_at: '2026-08-11T23:59:59Z',
        pitch_draft_id: DRAFT_ID,
      },
    });

    await expect(getPublicPitchAbsence(client, 'jordan-abc123', NOW)).resolves.toBe('ended');
  });

  it('reports ended for a paused campaign whose window has passed', async () => {
    const { client } = fakeClient({
      campaign: {
        status: 'paused',
        ends_at: '2026-08-01T00:00:00Z',
        pitch_draft_id: DRAFT_ID,
      },
    });

    await expect(getPublicPitchAbsence(client, 'jordan-abc123', NOW)).resolves.toBe('ended');
  });

  it('reports missing for a paused campaign that is still inside its window', async () => {
    // Pausing is the owner hiding their page, not the window closing. Saying
    // "ended" would state something the row does not say.
    const { client } = fakeClient({
      campaign: {
        status: 'paused',
        ends_at: '2026-09-01T00:00:00Z',
        pitch_draft_id: DRAFT_ID,
      },
    });

    await expect(getPublicPitchAbsence(client, 'jordan-abc123', NOW)).resolves.toBe('missing');
  });

  it('reports missing for an archived campaign even after its window passed', async () => {
    // "Take it down for good" is a deliberate removal; confirming the slug ever
    // existed is not this page's call to make.
    const { client } = fakeClient({
      campaign: {
        status: 'archived',
        ends_at: '2026-08-01T00:00:00Z',
        pitch_draft_id: DRAFT_ID,
      },
    });

    await expect(getPublicPitchAbsence(client, 'jordan-abc123', NOW)).resolves.toBe('missing');
  });

  it('hides an expired campaign the public gate does not expose', async () => {
    // Fails closed exactly like the read does: with the beta gate off and no QA
    // allowlist entry, an existing slug must be indistinguishable from a typo.
    const { client } = fakeClient({
      campaign: { status: 'expired', ends_at: null, pitch_draft_id: DRAFT_ID },
      betaValue: 'off',
      allowlisted: false,
    });

    await expect(getPublicPitchAbsence(client, 'jordan-abc123', NOW)).resolves.toBe('missing');
  });

  it('reports ended for an allowlisted expired campaign while the gate is off', async () => {
    const { client } = fakeClient({
      campaign: { status: 'expired', ends_at: null, pitch_draft_id: DRAFT_ID },
      betaValue: 'off',
      allowlisted: true,
    });

    await expect(getPublicPitchAbsence(client, 'jordan-abc123', NOW)).resolves.toBe('ended');
  });

  it('throws a DataLayerError when the campaign lookup fails', async () => {
    const { client } = fakeClient({ campaignError: { message: 'boom' } });

    await expect(getPublicPitchAbsence(client, 'jordan-abc123', NOW)).rejects.toBeInstanceOf(
      DataLayerError,
    );
  });
});
