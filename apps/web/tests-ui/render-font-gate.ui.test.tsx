/* global beforeEach, describe, expect, it */

// T013: the capture page's font gate. The production bench died at
// `payload-load` with `DOMException: NetworkError` because the gate handed
// FontFaceSet.load() the WHOLE computed stack, including next/font's metric
// fallback face whose only source is `local("Arial")` — unavailable to the
// `--single-process` headless shell.
//
// These tests pin the two properties that fix demands and the old behaviour
// violated:
//   1. only url()-backed families are ever loaded (no local()-only face), and
//   2. a family that does not actually load is an EXPLICIT failure — a capture
//      must never be encoded in a fallback typeface.

import {
  collectFontFaceSources,
  loadRenderFonts,
  parseFontStack,
  webFontFamilies,
  type FontFaceSource,
} from '@/lib/pitchRender/fontGate';

/**
 * Copied VERBATIM from apps/web/.next-build/static/css (next/font's output for
 * apps/web/app/layout.tsx), so these tests fail if next/font ever changes the
 * shape this gate reads: two url() faces plus one local()-only metric fallback
 * per family, and a variable that carries both names.
 */
const NEXT_FONT_CSS = `
@font-face{font-family:Unbounded;font-style:normal;font-weight:200 900;font-display:swap;src:url(/_next/static/media/87bc17f7c8b98e48-s.woff2) format("woff2");unicode-range:u+0100-02ba}
@font-face{font-family:Unbounded;font-style:normal;font-weight:200 900;font-display:swap;src:url(/_next/static/media/29b98dbfba401fa9-s.p.woff2) format("woff2");unicode-range:u+00??}
@font-face{font-family:Unbounded Fallback;src:local("Arial");ascent-override:73.93%;descent-override:18.20%;line-gap-override:0.00%;size-adjust:134.59%}
@font-face{font-family:Bricolage Grotesque;font-style:normal;font-weight:200 800;font-display:swap;src:url(/_next/static/media/9d5a263311222317-s.p.woff2) format("woff2");unicode-range:u+00??}
@font-face{font-family:Bricolage Grotesque Fallback;src:local("Arial");ascent-override:88.21%;descent-override:25.61%;line-gap-override:0.00%;size-adjust:105.43%}
.variable{--font-display:"Unbounded","Unbounded Fallback";--font-body:"Bricolage Grotesque","Bricolage Grotesque Fallback"}
`;

/** What getComputedStyle(warmup).fontFamily returns on the real capture page. */
const DISPLAY_STACK = '"Unbounded", "Unbounded Fallback", sans-serif';
const BODY_STACK = '"Bricolage Grotesque", "Bricolage Grotesque Fallback", sans-serif';

function documentFaces(): readonly FontFaceSource[] {
  const style = document.createElement('style');
  style.textContent = NEXT_FONT_CSS;
  document.head.append(style);
  return collectFontFaceSources(document.styleSheets);
}

type LoadRecorder = {
  readonly specs: string[];
  load: (spec: string) => Promise<unknown>;
};

function recorder(behaviour?: (spec: string) => Promise<unknown>): LoadRecorder {
  const specs: string[] = [];
  return {
    specs,
    load: async (spec) => {
      specs.push(spec);
      return behaviour === undefined ? undefined : await behaviour(spec);
    },
  };
}

describe('font stack parsing', () => {
  it('splits quoted and unquoted families and drops empties', () => {
    expect(parseFontStack(DISPLAY_STACK)).toEqual([
      'Unbounded',
      'Unbounded Fallback',
      'sans-serif',
    ]);
    expect(parseFontStack('Unbounded Fallback,  sans-serif ,')).toEqual([
      'Unbounded Fallback',
      'sans-serif',
    ]);
  });
});

describe('reading the page @font-face rules', () => {
  beforeEach(() => {
    document.head.replaceChildren();
  });

  it('finds every next/font face, url()-backed and local()-only alike', () => {
    const faces = documentFaces();

    expect(faces).toHaveLength(5);
    expect(faces.filter((face) => face.src.includes('url(')).length).toBe(3);
    const fallbacks = faces.filter((face) => face.family.includes('Fallback'));
    expect(fallbacks).toHaveLength(2);
    for (const fallback of fallbacks) {
      expect(fallback.src).toContain('local(');
      expect(fallback.src).not.toContain('url(');
    }
  });

  it('keeps only the families a url() source actually backs', () => {
    const faces = documentFaces();

    // The metric fallback and the generic keyword are both excluded — the gate
    // never asks the browser to instantiate a local() face.
    expect(webFontFamilies(DISPLAY_STACK, faces)).toEqual(['Unbounded']);
    expect(webFontFamilies(BODY_STACK, faces)).toEqual(['Bricolage Grotesque']);
  });

  it('reports no web font when the stack is fallbacks and generics only', () => {
    const faces = documentFaces();

    expect(webFontFamilies('"Unbounded Fallback", sans-serif', faces)).toEqual([]);
  });
});

describe('the first-frame font gate', () => {
  beforeEach(() => {
    document.head.replaceChildren();
  });

  it('loads exactly the two real families, never a fallback face or generic', async () => {
    const faces = documentFaces();
    const load = recorder();

    const loaded = await loadRenderFonts({
      stacks: [DISPLAY_STACK, BODY_STACK],
      faces,
      load: load.load,
      check: () => true,
    });

    expect(loaded).toEqual(['Unbounded', 'Bricolage Grotesque']);
    expect(load.specs).toEqual(['16px "Unbounded"', '16px "Bricolage Grotesque"']);
    for (const spec of load.specs) {
      expect(spec).not.toContain('Fallback');
      expect(spec).not.toContain('sans-serif');
    }
  });

  it('fails explicitly when the real family cannot be fetched', async () => {
    const faces = documentFaces();
    const load = recorder(async (spec) => {
      // What headless Chromium rejects with when a face ends in the error
      // state — the exact production symptom, now named by family.
      throw new DOMException(`A network error occurred loading ${spec}`, 'NetworkError');
    });

    await expect(
      loadRenderFonts({ stacks: [DISPLAY_STACK], faces, load: load.load, check: () => true }),
    ).rejects.toThrow(/could not load "Unbounded".*NetworkError/s);
  });

  it('fails when load() resolves but the face is still unusable', async () => {
    const faces = documentFaces();
    const load = recorder();

    // Silent success here would encode the MP4 in Arial: the gate must refuse.
    await expect(
      loadRenderFonts({ stacks: [DISPLAY_STACK], faces, load: load.load, check: () => false }),
    ).rejects.toThrow(/loaded "Unbounded" but the face is still unavailable/);
  });

  it('fails when no readable @font-face backs the stack', async () => {
    const load = recorder();

    await expect(
      loadRenderFonts({ stacks: [DISPLAY_STACK], faces: [], load: load.load, check: () => true }),
    ).rejects.toThrow(/no url\(\)-backed @font-face for stack/);
    expect(load.specs).toEqual([]);
  });

  it('fails when the stage mounted no warmup elements', async () => {
    await expect(
      loadRenderFonts({ stacks: [], faces: [], load: async () => undefined, check: () => true }),
    ).rejects.toThrow(/no \[data-render-font-warmup\] elements/);
  });
});
