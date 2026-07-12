import { HybridPitchDraftService } from './pitchDraftsSupabase';
import type { PitchDraftService } from './pitchDrafts';
import { getSupabaseClient } from './supabaseClient';

/** App-wide draft service: Supabase-backed submits when env is configured. */
export const pitchDraftService: PitchDraftService = new HybridPitchDraftService(
  getSupabaseClient(),
);
