import { pitchSceneV2Schema, type PitchSceneV2 } from '@friendword/contracts';

// P6: this renderer interprets PitchScene v2 and nothing else. v1 rows play on
// the legacy web path and were never approved as a shot list; v3 (clip shots)
// is Phase 3b+ and needs its own interpreter. Both are refused loudly — the
// error strings below are pinned by tests-render/renderValidate.render.test.ts.

export function schemaVersionError(got: string): string {
  return `pitch render supports PitchScene schemaVersion 2 only; got ${got}`;
}

export const INVALID_V2_SCENE_ERROR =
  'scene JSON claims schemaVersion 2 but fails PitchScene v2 validation';

/**
 * The approved scene JSON, or a thrown error. Version is checked before shape
 * so a v1/v3 document gets the version refusal, not a shape complaint.
 */
export function assertRenderableScene(value: unknown): PitchSceneV2 {
  const version =
    typeof value === 'object' && value !== null && 'schemaVersion' in value
      ? (value as { schemaVersion: unknown }).schemaVersion
      : undefined;
  if (version !== 2) {
    throw new Error(schemaVersionError(typeof version === 'number' ? String(version) : 'none'));
  }
  const parsed = pitchSceneV2Schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(INVALID_V2_SCENE_ERROR);
  }
  return parsed.data;
}
