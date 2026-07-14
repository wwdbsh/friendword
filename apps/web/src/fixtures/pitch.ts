import type { PitchStructure } from '@friendword/contracts';

export type PitchPhoto = {
  readonly src: string;
  readonly alt: string;
  readonly startMs: number;
  readonly endMs: number;
};

export type PitchCaption = {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
};

export type PitchFixture = {
  readonly campaignSlug: string;
  readonly daterName: string;
  readonly approximateLocation: string;
  readonly introducerPseudonym: string;
  readonly relationship: string;
  readonly durationMs: number;
  readonly description: string;
  /**
   * Marks the fixture as demo data. Renderers surface this so a judge never
   * mistakes a seeded preview for a live, consented pitch (GP-P0-3).
   */
  readonly isDemo: true;
  readonly photos: readonly [PitchPhoto, ...PitchPhoto[]];
  readonly captions: readonly [PitchCaption, ...PitchCaption[]];
  /**
   * Structured breakdown of the friend's pitch (CP-2). The real pipeline
   * stores this as the draft/revision `structure` JSONB (migration 0013);
   * the demo carries it inline so the structure-driven scenes render before
   * a rights-cleared recording is seeded.
   */
  readonly structure: PitchStructure;
};

// NOTE (GP-P0-3): age and friend-vouch fields were removed. The production
// pipeline cannot produce them (view.ts returns age:null and vouches were the
// unshipped Flow D), so showing them on the representative demo advertised an
// unbuilt capability. Do not reintroduce them here without a real feature.
const demoBlair = {
  campaignSlug: 'demo-blair',
  daterName: 'Blair',
  approximateLocation: 'Brooklyn, New York',
  introducerPseudonym: 'Maya',
  relationship: 'Friends for 6 years',
  durationMs: 60_000,
  description: 'Meet Blair through Maya’s written demo pitch. Demo data — no live recording yet.',
  isDemo: true,
  photos: [
    {
      src: '/fixtures/blair-portrait-1.svg',
      alt: 'Illustrated portrait placeholder for Blair in a tangerine jacket',
      startMs: 0,
      endMs: 20_000,
    },
    {
      src: '/fixtures/blair-portrait-2.svg',
      alt: 'Illustrated portrait placeholder for Blair holding a record',
      startMs: 20_000,
      endMs: 40_000,
    },
    {
      src: '/fixtures/blair-portrait-3.svg',
      alt: 'Illustrated portrait placeholder for Blair on a sunny city walk',
      startMs: 40_000,
      endMs: 60_001,
    },
  ],
  captions: [
    {
      startMs: 0,
      endMs: 12_000,
      text: 'Blair is the person who turns an ordinary Tuesday into the story you tell all year.',
    },
    {
      startMs: 12_000,
      endMs: 24_000,
      text: 'She remembers your coffee order and somehow always finds the best song for the walk home.',
    },
    {
      startMs: 24_000,
      endMs: 36_000,
      text: 'She is curious, quick-witted, and genuinely shows up when it matters.',
    },
    {
      startMs: 36_000,
      endMs: 48_000,
      text: 'Her ideal night is live music, great noodles, and a conversation that runs past midnight.',
    },
    {
      startMs: 48_000,
      endMs: 60_001,
      text: 'If you are kind, playful, and ready for something real, I think you should meet Blair.',
    },
  ],
  structure: {
    hook: 'Blair is the person who turns an ordinary Tuesday into the story you tell all year.',
    relationship_context: 'Maya has been close friends with Blair for six years.',
    three_specific_qualities: [
      'Remembers the small things — your coffee order, the song for the walk home.',
      'Curious and quick-witted, always up for a conversation that runs past midnight.',
      'Genuinely shows up when it actually matters.',
    ],
    evidence_or_anecdote:
      'Her ideal night is live music, great noodles, and talking until the trains stop running.',
    good_match_for: 'Someone kind, playful, and ready for something real.',
    hard_claims_requiring_confirmation: [],
  },
} as const satisfies PitchFixture;

const pitchFixtures: Readonly<Record<string, PitchFixture>> = {
  [demoBlair.campaignSlug]: demoBlair,
};

export function getPitchFixture(campaignSlug: string): PitchFixture | undefined {
  return pitchFixtures[campaignSlug];
}
