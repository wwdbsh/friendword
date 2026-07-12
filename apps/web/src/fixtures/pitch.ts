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

export type PitchVouch = {
  readonly pseudonym: string;
  readonly relationship: string;
  readonly quote: string;
};

export type PitchFixture = {
  readonly campaignSlug: string;
  readonly daterName: string;
  readonly age: number;
  readonly approximateLocation: string;
  readonly introducerPseudonym: string;
  readonly relationship: string;
  readonly durationMs: number;
  readonly description: string;
  readonly photos: readonly [PitchPhoto, ...PitchPhoto[]];
  readonly captions: readonly [PitchCaption, ...PitchCaption[]];
  readonly waveform: readonly number[];
  readonly vouches: readonly [PitchVouch, PitchVouch];
};

const demoBlair = {
  campaignSlug: 'demo-blair',
  daterName: 'Blair',
  age: 29,
  approximateLocation: 'Brooklyn, New York',
  introducerPseudonym: 'Maya',
  relationship: 'Friends for 6 years',
  durationMs: 60_000,
  description: 'Meet Blair through Maya’s original voice pitch, shared with Blair’s approval.',
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
  waveform: [
    34, 52, 77, 45, 62, 88, 58, 39, 72, 94, 67, 48, 83, 56, 31, 64, 91, 75, 43, 69, 86, 51, 37, 79,
    96, 61, 46, 73, 89, 54, 35, 68, 82, 59, 41, 76, 93, 65, 49, 85, 57, 33, 71, 87, 63, 44, 80, 92,
  ],
  vouches: [
    {
      pseudonym: 'Jules',
      relationship: 'Former roommate',
      quote: 'Blair makes people feel included without ever making a big show of it.',
    },
    {
      pseudonym: 'Noah',
      relationship: 'Sunday run club',
      quote: 'She brings the playlist, the snacks, and the exact encouragement you need.',
    },
  ],
} as const satisfies PitchFixture;

const pitchFixtures: Readonly<Record<string, PitchFixture>> = {
  [demoBlair.campaignSlug]: demoBlair,
};

export function getPitchFixture(campaignSlug: string): PitchFixture | undefined {
  return pitchFixtures[campaignSlug];
}
