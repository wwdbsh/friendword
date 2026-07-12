import type { DraftInputs, PitchStructure } from '@friendword/contracts';

export type AudioInput = {
  readonly uri: string;
  readonly durationMs: number;
};

export type TranscriptionResult = {
  readonly text: string;
  readonly language: string;
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
