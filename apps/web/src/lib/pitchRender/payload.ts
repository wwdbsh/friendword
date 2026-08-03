import type { PitchSceneV2 } from '@friendword/contracts';

import type { SceneTextFields, SceneWord } from '@/pitch/sceneV2';

// The wire shape the render engine injects into the capture page
// (app/internal/render/[revisionId]). Client-safe on purpose: the page imports
// these types, so nothing in this module may touch Node APIs.

export type RenderPayloadPhoto = {
  /** pitch_assets id the scene's shots reference. */
  readonly assetId: string;
  /** A data: URI. The capture page never fetches over the network (P3). */
  readonly src: string;
};

/**
 * The end card is renderer chrome, not scene content (2026-08-03): both fields
 * are platform constants plus the canonical campaign URL, and the type carries
 * no free-text slot a Dater- or Introducer-authored string could ride in on.
 */
export type RenderEndCard = {
  readonly brand: string;
  /** host + /p/slug, built by endCardUrlText() from the configured origin. */
  readonly urlText: string;
};

export type RenderPayload = {
  readonly scene: PitchSceneV2;
  readonly photos: readonly RenderPayloadPhoto[];
  readonly words: readonly SceneWord[];
  readonly text: SceneTextFields | null;
  readonly endCard: RenderEndCard;
};

/** What the capture page exposes on `window` for the Node driver. */
export type RenderHarnessApi = {
  /** Mounts the payload, then resolves only after fonts + photo decode (P3). */
  readonly loadPayload: (payload: RenderPayload) => Promise<void>;
  /**
   * Steps the interpreter to `tMs` and resolves once the DOM provably shows the
   * frame for that millisecond (the committed frame's signature matches the
   * interpreter's expected signature). Returns the signature for diagnostics.
   */
  readonly seek: (tMs: number) => Promise<string>;
  /** Swaps the stage to the appended end card and resolves after paint. */
  readonly showEndCard: () => Promise<void>;
};

declare global {
  interface Window {
    __friendwordRender?: RenderHarnessApi;
    /** Set by the page once the API above is installed. */
    __friendwordRenderReady?: boolean;
  }
}
