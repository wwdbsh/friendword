import {
  pitchStructureSchema,
  type DraftInputs,
  type PitchStructure,
  type RelationshipDuration,
  type RelationshipType,
} from '@friendword/contracts';

import { simulateDelay } from './delay';
import type { MockProviderOptions, PitchStructureProvider } from './types';

const RELATIONSHIP_LABELS = {
  friend: 'friends',
  coworker: 'coworkers',
  family: 'family',
  roommate: 'roommates',
  other: 'close connections',
} as const satisfies Record<RelationshipType, string>;

const DURATION_LABELS = {
  lt1y: 'less than a year',
  y1to3: 'one to three years',
  y3to10: 'three to ten years',
  gt10y: 'more than ten years',
} as const satisfies Record<RelationshipDuration, string>;

const QUALITY_RULES = [
  { keyword: 'kind', quality: 'kind' },
  { keyword: 'curious', quality: 'curious' },
  { keyword: 'reliable', quality: 'reliable' },
  { keyword: 'funny', quality: 'funny' },
  { keyword: 'thoughtful', quality: 'thoughtful' },
] as const;

const FALLBACK_QUALITIES = ['thoughtful', 'reliable', 'genuine'] as const;
const HARD_CLAIM_PATTERN = /\b(always|never|income|salary|diagnosed|owns)\b/i;

export class MockPitchStructureProvider implements PitchStructureProvider {
  readonly #options: MockProviderOptions;

  constructor(options: MockProviderOptions = {}) {
    this.#options = options;
  }

  async structure(transcript: string, context: DraftInputs): Promise<PitchStructure> {
    await simulateDelay(this.#options);

    const normalizedTranscript = transcript.trim();
    const sentences = normalizedTranscript
      .split(/[.!?]+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0);
    const hook = sentences[0] ?? 'Meet someone worth knowing';
    const evidence = sentences[1] ?? normalizedTranscript;
    const inferredQualities = QUALITY_RULES.filter(({ keyword }) =>
      normalizedTranscript.toLowerCase().includes(keyword),
    ).map(({ quality }) => quality);
    const qualities = [...new Set([...inferredQualities, ...FALLBACK_QUALITIES])].slice(0, 3);

    return pitchStructureSchema.parse({
      hook,
      relationship_context: `We have been ${RELATIONSHIP_LABELS[context.relationshipType]} for ${DURATION_LABELS[context.relationshipDuration]}.`,
      three_specific_qualities: qualities,
      evidence_or_anecdote: evidence,
      good_match_for: 'Someone kind, communicative, and ready for a genuine connection.',
      hard_claims_requiring_confirmation: sentences.filter((sentence) =>
        HARD_CLAIM_PATTERN.test(sentence),
      ),
    });
  }
}
