import type { PitchSceneV2 } from '@friendword/contracts';

// §2.7 — the non-generative photo grade.
//
// This is renderer chrome in the same sense the caption band is: a CSS filter
// the capture page puts over the APPROVED scene layer, evaluated once per
// template and constant for the whole render. It is deliberately the weakest
// tool that does the job:
//
//   - No geometry. The crop ladder the Dater approved is the only thing that
//     moves a face inside the frame; nothing here translates, scales or warps.
//   - No pixel synthesis. contrast/saturate/brightness are per-channel curves
//     over what the camera recorded — no face is reconstructed, sharpened into
//     a different face, or "enhanced" by a model.
//   - No randomness. The grain is one fixed-seed feTurbulence, so the same
//     scene grades to the same pixels on every machine and every rerun (P7).
//
// The numbers are the design document's, not tuned per photo: a per-photo
// "auto" grade would make two shots of the same person disagree about their
// skin tone inside one reel.
//
// Client-safe: the capture page imports this, so nothing here may touch Node.

export type PhotoGradePreset = {
  /** The CSS `filter` value applied to the scene layer, verbatim. */
  readonly filter: string;
  /** Opacity of the vignette overlay (0 = none). */
  readonly vignetteOpacity: number;
  /** Opacity of the grain overlay. */
  readonly grainOpacity: number;
  /** feTurbulence seed — fixed per template, never generated. */
  readonly grainSeed: number;
};

export const PHOTO_GRADE_WARM: PhotoGradePreset = {
  filter: 'contrast(1.06) saturate(1.08) brightness(1.02)',
  vignetteOpacity: 0.18,
  grainOpacity: 0.06,
  grainSeed: 7,
};

export const PHOTO_GRADE_HYPE: PhotoGradePreset = {
  filter: 'contrast(1.12) saturate(1.18)',
  vignetteOpacity: 0,
  grainOpacity: 0.04,
  grainSeed: 11,
};

export function photoGradeForTemplate(template: PitchSceneV2['template']): PhotoGradePreset {
  return template === 'hype' ? PHOTO_GRADE_HYPE : PHOTO_GRADE_WARM;
}

/**
 * The grain tile as a data: URI. An SVG feTurbulence with an explicit seed —
 * the same generator the scene's own grain layer uses — so the capture page
 * fetches nothing (P3) and two runs produce identical bytes.
 */
export function grainDataUri(seed: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180">` +
    `<filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${seed}" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="0"/></filter>` +
    `<rect width="180" height="180" filter="url(#g)"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
