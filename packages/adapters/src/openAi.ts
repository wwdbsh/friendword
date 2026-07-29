import { pitchStructureSchema, type DraftInputs, type PitchStructure } from '@friendword/contracts';

import type {
  AudioInput,
  IdentityVerificationProvider,
  IdentityVerificationResult,
  LivenessCheckReference,
  ModerationProvider,
  ModerationResult,
  PitchStructureProvider,
  TranscriptionProvider,
  TranscriptionResult,
} from './types';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';
// whisper-1 + verbose_json is the only transcription surface that returns
// segment timestamps, which the public pitch captions require (CP-2).
const TRANSCRIBE_MODEL = 'whisper-1';
const STRUCTURE_MODEL = 'gpt-4o-mini';
const MODERATION_MODEL = 'omni-moderation-latest';
/**
 * Both granularities, always. Sending 'word' alone makes the API omit
 * `segments`, and every caption line and photo scene boundary is derived from
 * segments — word timings are additive on top (A7).
 *
 * The multipart field name carries the brackets: the API reference documents the
 * parameter as `timestamp_granularities[]` and its curl example repeats
 * `-F "timestamp_granularities[]=word"` per element, which is how an array
 * reaches a multipart/form-data endpoint.
 */
const TIMESTAMP_GRANULARITIES = ['word', 'segment'] as const;

export class ProviderRequestError extends Error {
  override readonly name = 'ProviderRequestError';

  constructor(operation: string, status: number) {
    super(`${operation} failed (${status})`);
  }
}

/** Real transcription: audio.uri must be a fetchable (signed) URL. */
export class OpenAiTranscriptionProvider implements TranscriptionProvider {
  constructor(private readonly apiKey: string) {}

  async transcribe(audio: AudioInput): Promise<TranscriptionResult> {
    const audioResponse = await fetch(audio.uri);
    if (!audioResponse.ok) {
      throw new ProviderRequestError('audio download', audioResponse.status);
    }
    const audioBlob = await audioResponse.blob();

    const form = new FormData();
    form.append('file', audioBlob, 'voice.m4a');
    form.append('model', TRANSCRIBE_MODEL);
    form.append('response_format', 'verbose_json');
    // English-first MVP (Slice 8 decision): without a language hint, Whisper
    // can misdetect accented English and return a translated transcript.
    form.append('language', 'en');
    for (const granularity of TIMESTAMP_GRANULARITIES) {
      form.append('timestamp_granularities[]', granularity);
    }

    const response = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!response.ok) {
      throw new ProviderRequestError('transcription', response.status);
    }

    const data = (await response.json()) as {
      readonly text?: string;
      readonly language?: string;
      readonly segments?: readonly {
        readonly start?: number;
        readonly end?: number;
        readonly text?: string;
      }[];
      readonly words?: readonly {
        readonly start?: number;
        readonly end?: number;
        readonly word?: string;
      }[];
    };
    if (typeof data.text !== 'string' || data.text.trim() === '') {
      throw new ProviderRequestError('transcription', 502);
    }

    const segments = (data.segments ?? [])
      .filter(
        (segment) =>
          typeof segment.start === 'number' &&
          typeof segment.end === 'number' &&
          typeof segment.text === 'string' &&
          segment.text.trim() !== '',
      )
      .map((segment) => ({
        start: segment.start as number,
        end: segment.end as number,
        text: (segment.text as string).trim(),
      }));

    const words = (data.words ?? [])
      .filter(
        (word) =>
          typeof word.start === 'number' &&
          typeof word.end === 'number' &&
          typeof word.word === 'string' &&
          word.word.trim() !== '',
      )
      .map((word) => ({
        start: word.start as number,
        end: word.end as number,
        word: (word.word as string).trim(),
      }));

    return {
      text: data.text,
      language: typeof data.language === 'string' ? data.language : 'en',
      segments,
      words,
    };
  }
}

const STRUCTURE_SYSTEM_PROMPT = `You turn a friend's spoken dating pitch into structured JSON.
Rules:
- Use only what the speaker actually said; never invent facts.
- "hook": one short, warm opening line in the introducer's voice.
- "relationship_context": how they know each other, from the transcript and the provided context.
- "three_specific_qualities": exactly 3 short qualities actually mentioned or clearly implied.
- "evidence_or_anecdote": the most concrete story or example from the transcript.
- "good_match_for": who would be a good match, per the speaker.
- "hard_claims_requiring_confirmation": verbatim claims that need the subject's confirmation (income, absolutes like always/never, health, ownership). Empty array if none.
- Write every field in the same language as the transcript.
Respond with JSON only.`;

export class OpenAiPitchStructureProvider implements PitchStructureProvider {
  constructor(private readonly apiKey: string) {}

  async structure(transcript: string, context: DraftInputs): Promise<PitchStructure> {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: STRUCTURE_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: STRUCTURE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Relationship: ${context.relationshipType}, duration: ${context.relationshipDuration}.\nTranscript:\n${transcript}`,
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new ProviderRequestError('pitch structure', response.status);
    }

    const data = (await response.json()) as {
      readonly choices?: readonly { readonly message?: { readonly content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new ProviderRequestError('pitch structure', 502);
    }

    return pitchStructureSchema.parse(JSON.parse(content));
  }
}

/** Real moderation. For images, storagePath must be a fetchable (signed) URL. */
export class OpenAiModerationProvider implements ModerationProvider {
  constructor(private readonly apiKey: string) {}

  async checkText(text: string): Promise<ModerationResult> {
    return this.moderate({ input: text });
  }

  async checkImage(storagePath: string): Promise<ModerationResult> {
    return this.moderate({
      input: [{ type: 'image_url', image_url: { url: storagePath } }],
    });
  }

  private async moderate(payload: Readonly<Record<string, unknown>>): Promise<ModerationResult> {
    const response = await fetch(`${OPENAI_BASE_URL}/moderations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: MODERATION_MODEL, ...payload }),
    });
    if (!response.ok) {
      throw new ProviderRequestError('moderation', response.status);
    }

    const data = (await response.json()) as {
      readonly results?: readonly {
        readonly flagged?: boolean;
        readonly categories?: Readonly<Record<string, boolean>>;
      }[];
    };
    const result = data.results?.[0];
    if (result === undefined) {
      throw new ProviderRequestError('moderation', 502);
    }

    return {
      allowed: result.flagged !== true,
      categories: Object.entries(result.categories ?? {})
        .filter(([, flagged]) => flagged)
        .map(([category]) => category),
    };
  }
}

/**
 * Identity verification has no real provider yet (vendor + keys are a launch
 * gate the user owns). This placeholder fails loudly at call time so nothing
 * can quietly ship a fake verification.
 */
export class UnconfiguredIdentityVerificationProvider implements IdentityVerificationProvider {
  startLivenessCheck(): Promise<LivenessCheckReference> {
    return Promise.reject(new Error('identity verification provider is not configured'));
  }

  getResult(): Promise<IdentityVerificationResult> {
    return Promise.reject(new Error('identity verification provider is not configured'));
  }
}
