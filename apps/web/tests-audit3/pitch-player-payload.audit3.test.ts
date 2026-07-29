// FIFTH-AUDIT REGRESSION — P0/D5 (nothing the Dater removed ships in the page)
// and D6 (the page's provenance copy branches on what the row proves).
//
// `PitchPlayer` is a `'use client'` component, so Next.js serializes whatever
// props it receives into the RSC flight payload embedded in the public page's
// HTML. Passing the whole `PitchView` put `hard_claims_requiring_confirmation`,
// `approvedBody` and `transcriptText` in the page source of every pitch —
// reproduced against a real dev server with:
//
//   curl -s http://localhost:3000/p/demo-blair | grep -o '<claim string>'
//
// which printed the claim from inside `self.__next_f.push(...)` even though the
// visible page renders it nowhere. These tests pin both halves of the fix:
// the read boundary drops the flag, and the player projection carries only what
// the player draws.
/* global describe, expect, it */

import {
  daterControlLine,
  structureProvenanceLine,
  transcriptProvenanceLine,
} from '../src/pitch/copy';
import { fromPublishedPitch, toPitchPlayerView } from '../src/pitch/view';

const HARD_CLAIM = 'Blair owns a home in Ballard and earns 200k.';
const TRANSCRIPT_TEXT = 'Blair is the person who turns an ordinary Tuesday into a story.';
const APPROVED_BODY = 'We shared a wall for four years.\n\nA good match: someone kind.';

function publishedPitch(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: '20000000-0000-0000-0000-000000000001',
    campaignSlug: 'blair-abc123',
    publishedAt: '2026-07-29T00:00:00Z',
    daterDisplayName: 'Blair',
    introducerDisplayName: 'Maya',
    relationshipType: 'friend',
    relationshipDuration: 'y3to10',
    headline: 'Blair, in Blair’s own words.',
    body: APPROVED_BODY,
    transcript: {
      text: TRANSCRIPT_TEXT,
      segments: [{ start: 0, end: 4, text: TRANSCRIPT_TEXT }],
    },
    structure: {
      hook: 'Blair, in Blair’s own words.',
      relationship_context: 'We shared a wall for four years.',
      three_specific_qualities: ['Remembers every birthday', 'Cooks for a crowd', 'Never gossips'],
      evidence_or_anecdote: 'Blair drove three hours to sit with me after surgery.',
      good_match_for: 'Someone kind.',
      hard_claims_requiring_confirmation: [HARD_CLAIM],
    },
    daterReviewedStructure: true,
    age: 32,
    datingIntent: 'long-term',
    approximateLocation: 'Seattle, Puget Sound',
    voiceUrl: 'https://storage.example/voice.m4a',
    photos: [{ url: 'https://storage.example/one.jpg', sortOrder: 0 }],
    ...overrides,
  } as unknown as Parameters<typeof fromPublishedPitch>[0];
}

describe('[D5] the public page ships nothing the reader is not shown', () => {
  it('drops hard_claims_requiring_confirmation at the read boundary', () => {
    const view = fromPublishedPitch(publishedPitch());

    expect(view.structure).not.toBeNull();
    // The five printed fields survive untouched…
    expect(view.structure?.three_specific_qualities).toContain('Never gossips');
    // …and the flag the page never prints does not.
    expect(Object.keys(view.structure ?? {})).not.toContain('hard_claims_requiring_confirmation');
    expect(JSON.stringify(view.structure)).not.toContain(HARD_CLAIM);
  });

  it('serializes no claim, body or transcript into the player props', () => {
    // Exactly what Next.js writes into the page's flight payload.
    const serialized = JSON.stringify(toPitchPlayerView(fromPublishedPitch(publishedPitch())));

    expect(serialized).not.toContain(HARD_CLAIM);
    expect(serialized).not.toContain('hard_claims_requiring_confirmation');
    expect(serialized).not.toContain(APPROVED_BODY);
    // The caption segment text is the same sentence but is a separate field the
    // player genuinely draws; assert on the keys instead of the words.
    expect(Object.keys(JSON.parse(serialized) as Record<string, unknown>).sort()).toEqual([
      'age',
      'approximateLocation',
      'audioUrl',
      'campaignSlug',
      'captions',
      'daterName',
      'durationMs',
      'introducerPseudonym',
      'photos',
      'relationship',
    ]);
  });

  it('still gives the player the captions it renders', () => {
    const player = toPitchPlayerView(fromPublishedPitch(publishedPitch()));

    // D1 closes this one: the caption text is transcript text, and it is public,
    // so the Dater is shown the transcript read-only at consent.
    expect(player.captions.map((caption) => caption.text)).toEqual([TRANSCRIPT_TEXT]);
  });
});

describe('[D6] provenance copy claims only what the row proves', () => {
  const reviewed = fromPublishedPitch(publishedPitch());
  const notReviewed = fromPublishedPitch(publishedPitch({ daterReviewedStructure: false }));

  it('never says the Dater reviewed sections they were never shown', () => {
    expect(structureProvenanceLine(notReviewed)).not.toMatch(/reviewed and approved each section/);
    expect(structureProvenanceLine(notReviewed)).toContain('organized automatically');
    expect(structureProvenanceLine(reviewed)).toContain('reviewed and approved each section');
  });

  it('never claims the Dater edited the claims or the transcript', () => {
    for (const view of [reviewed, notReviewed]) {
      const line = daterControlLine(view);
      expect(line).not.toMatch(/edited the wording/);
      expect(line).not.toMatch(/edited .*claims/);
    }
    // The reviewed row may say they had the final say on the flagged claims —
    // that is the disposition the RPC actually records (retained_hard_claims).
    expect(daterControlLine(reviewed)).toContain('final say on every claim');
    expect(daterControlLine(notReviewed)).not.toContain('final say on every claim');
  });

  it('names the caption surface only when captions actually render', () => {
    expect(transcriptProvenanceLine(reviewed)).toContain('captions over the photos');

    const noSegments = fromPublishedPitch(
      publishedPitch({ transcript: { text: TRANSCRIPT_TEXT, segments: [] } }),
    );
    const line = transcriptProvenanceLine(noSegments);
    expect(line).not.toBeNull();
    expect(line).not.toContain('captions');

    expect(transcriptProvenanceLine(fromPublishedPitch(publishedPitch({ transcript: null })))).toBe(
      null,
    );
  });
});
