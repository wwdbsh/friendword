import type { Metadata } from 'next';

import { RenderStage } from './RenderStage';

// The MP4 capture target (Phase 4). Headless Chromium loads this page, injects
// the approved scene through window.__friendwordRender, steps the interpreter
// frame by frame and screenshots the stage. The page fetches NOTHING by itself
// — without an injected payload it renders an empty stage, so the route leaks
// no pitch data. The [revisionId] segment exists so every render job has a
// stable, deterministic URL (P7); the page never reads it.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function RenderCapturePage() {
  return <RenderStage />;
}
