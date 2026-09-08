import type { DraftInputs, PitchStructure } from '@friendword/contracts';

export type AudioInput = {
  readonly uri: string;
  readonly durationMs: number;
};

export type TranscriptSegment = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

export type TranscriptWord = {
  readonly start: number;
  readonly end: number;
  readonly word: string;
};

export type TranscriptionResult = {
  readonly text: string;
  readonly language: string;
  /** Segment-level timestamps when the provider supplies them (CP-2). */
  readonly segments?: readonly TranscriptSegment[];
  /**
   * Word-level timestamps when the provider supplies them (A7). Additive: every
   * caption and scene boundary is still derived from `segments`, so a provider
   * that returns no words changes nothing.
   */
  readonly words?: readonly TranscriptWord[];
  /**
   * Length of the audio the provider actually decoded, in seconds, when it
   * reports one. T001 uses it as the denominator for speech coverage; without a
   * provider-reported duration there is no trustworthy one (the request cap is
   * a ceiling, not a measurement), so callers must treat it as optional.
   */
  readonly durationSeconds?: number;
};

export interface TranscriptionProvider {
  transcribe(audio: AudioInput): Promise<TranscriptionResult>;
}

export interface PitchStructureProvider {
  structure(transcript: string, context: DraftInputs): Promise<PitchStructure>;
}

export type LivenessCheckReference = {
  readonly reference: string;
};

export type IdentityVerificationStatus = 'pending' | 'verified' | 'failed';

export type IdentityVerificationResult = {
  readonly status: IdentityVerificationStatus;
};

export interface IdentityVerificationProvider {
  startLivenessCheck(userId: string): Promise<LivenessCheckReference>;
  // The provider boundary returns status only; raw identity documents must never be stored.
  getResult(reference: string): Promise<IdentityVerificationResult>;
}

export type ModerationResult = {
  readonly allowed: boolean;
  readonly categories: readonly string[];
};

export interface ModerationProvider {
  checkText(text: string): Promise<ModerationResult>;
  checkImage(storagePath: string): Promise<ModerationResult>;
}

export type MockProviderOptions = {
  readonly delayMs?: number;
};

export type Providers = {
  readonly transcription: TranscriptionProvider;
  readonly pitchStructure: PitchStructureProvider;
  readonly identityVerification: IdentityVerificationProvider;
  readonly moderation: ModerationProvider;
};
