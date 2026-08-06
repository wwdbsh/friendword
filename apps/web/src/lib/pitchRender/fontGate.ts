// The capture page's font gate (T013). Client-safe on purpose: the render
// stage imports it, so nothing here may touch Node APIs.
//
// WHY THIS EXISTS. next/font emits TWO @font-face rules per family: the real
// one (`src: url(...woff2)`) and a size-adjusted metric fallback whose only
// source is `src: local("Arial")`. The generated CSS variable carries BOTH —
// verified in the build output at apps/web/.next-build/static/css:
//
//   --font-display: "Unbounded","Unbounded Fallback"
//   @font-face{font-family:Unbounded Fallback;src:local("Arial");
//              ascent-override:73.93%;...;size-adjust:134.59%}
//
// Passing that whole stack to FontFaceSet.load() asks the browser to
// instantiate the local() face too. Under the production renderer (sparticuz
// headless-shell, `--single-process`) local() lookup is unavailable —
// Chromium logs "font_unique_name_lookup_linux.cc ... local() instantiation
// only available when connected to browser process" — the fallback FontFace
// ends in the error state, and the aggregate load() promise rejects with
// `DOMException: NetworkError`. That killed the production bench at
// stage `payload-load` while Chromium itself exited 0.
//
// So the gate loads only the families a url() source actually backs, and it
// verifies each one with check(). It must never pass quietly: a capture that
// fell back to Arial is not the frame the Dater approved (P3 determinism), so
// a family that will not load is an explicit error, not a soft warning.
//
// Nothing here hardcodes a family name. The families come from the same CSS
// variables the stage renders with; the local()-only faces are excluded by
// reading the @font-face rules, not by position in the stack.

/** One @font-face rule, reduced to the two properties the gate reasons about. */
export type FontFaceSource = {
  /** The rule's `font-family` value, as CSS serialized it (may be quoted). */
  readonly family: string;
  /** The rule's `src` value. */
  readonly src: string;
};

/** A minimal structural view of the one style API this module calls. */
type StyleQueryable = {
  getPropertyValue(property: string): string;
};

function isStyleQueryable(value: unknown): value is StyleQueryable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getPropertyValue' in value &&
    typeof value.getPropertyValue === 'function'
  );
}

/**
 * Only `length` plus numeric indices are assumed: a real `CSSRuleList` has
 * `item()`, but jsdom's CSS engine hands back a plain array, and the gate must
 * read the same rules under both.
 */
function isArrayLike(value: unknown): value is ArrayLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'length' in value &&
    typeof value.length === 'number'
  );
}

function ruleList(value: unknown): readonly unknown[] | null {
  return isArrayLike(value) ? Array.from(value) : null;
}

/**
 * `CSSFontFaceRule` is not a global in every DOM implementation the tests run
 * on (jsdom exposes the class only through the instance), so the rule is
 * identified by what it carries rather than by `instanceof`: a declaration
 * block that answers both `font-family` and `src`. Only @font-face can.
 */
function ruleStyle(rule: unknown): StyleQueryable | null {
  if (typeof rule !== 'object' || rule === null) {
    return null;
  }
  const style: unknown = 'style' in rule ? rule.style : null;
  return isStyleQueryable(style) ? style : null;
}

function nestedRules(rule: unknown): readonly unknown[] | null {
  if (typeof rule !== 'object' || rule === null) {
    return null;
  }
  return ruleList('cssRules' in rule ? rule.cssRules : null);
}

/** Depth cap: @media/@supports wrappers nest, malformed input must not loop. */
const MAX_RULE_DEPTH = 4;

function collectFromRules(rules: readonly unknown[], out: FontFaceSource[], depth: number): void {
  if (depth > MAX_RULE_DEPTH) {
    return;
  }
  for (const rule of rules) {
    const style = ruleStyle(rule);
    if (style !== null) {
      const family = style.getPropertyValue('font-family');
      const src = style.getPropertyValue('src');
      if (family !== '' && src !== '') {
        out.push({ family, src });
      }
    }
    const nested = nestedRules(rule);
    if (nested !== null) {
      collectFromRules(nested, out, depth + 1);
    }
  }
}

/**
 * Every @font-face rule the document can read. A cross-origin sheet throws on
 * `cssRules`; that sheet is skipped, and if the result ends up carrying no
 * url() source for a needed family the gate fails loudly rather than guessing.
 */
export function collectFontFaceSources(sheets: StyleSheetList): readonly FontFaceSource[] {
  const faces: FontFaceSource[] = [];
  for (let index = 0; index < sheets.length; index += 1) {
    const sheet: CSSStyleSheet | undefined = sheets[index];
    if (sheet === undefined) {
      continue;
    }
    let rules: readonly unknown[] | null = null;
    try {
      rules = ruleList(sheet.cssRules);
    } catch {
      // SecurityError on a cross-origin sheet: nothing readable here.
      rules = null;
    }
    if (rules === null) {
      continue;
    }
    collectFromRules(rules, faces, 0);
  }
  return faces;
}

/**
 * Split a serialized font-family list into its families, unquoted and with
 * runs of whitespace collapsed. Chromium quotes names containing spaces
 * ("Unbounded Fallback"); jsdom does not, so both forms must parse the same.
 */
export function parseFontStack(stack: string): readonly string[] {
  const families: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const character of stack) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (quote !== null) {
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === quote) {
        quote = null;
        continue;
      }
      current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ',') {
      families.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  families.push(current);
  return families
    .map((family) => family.trim().replace(/\s+/g, ' '))
    .filter((family) => family.length > 0);
}

/** True when the rule can fetch a real font file, not only borrow a local one. */
function hasUrlSource(src: string): boolean {
  return /(?:^|[\s,])url\(/i.test(src);
}

/**
 * The families in `stack` that a url()-backed @font-face rule defines, in
 * stack order. Generic keywords (sans-serif) have no rule; next/font's metric
 * fallback has one but only a local() source — both are therefore excluded
 * WITHOUT this module knowing any family name or relying on stack position.
 */
export function webFontFamilies(
  stack: string,
  faces: readonly FontFaceSource[],
): readonly string[] {
  const urlBacked = new Set<string>();
  for (const face of faces) {
    if (!hasUrlSource(face.src)) {
      continue;
    }
    for (const family of parseFontStack(face.family)) {
      urlBacked.add(family.toLowerCase());
    }
  }
  const found: string[] = [];
  for (const family of parseFontStack(stack)) {
    if (!urlBacked.has(family.toLowerCase()) || found.includes(family)) {
      continue;
    }
    found.push(family);
  }
  return found;
}

/** A `font` shorthand FontFaceSet accepts, with the family safely quoted. */
function fontSpec(family: string): string {
  return `16px "${family.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export type LoadRenderFontsInput = {
  /** One computed `font-family` value per warmup element on the stage. */
  readonly stacks: readonly string[];
  /** Every readable @font-face rule (see collectFontFaceSources). */
  readonly faces: readonly FontFaceSource[];
  readonly load: (spec: string) => Promise<unknown>;
  readonly check: (spec: string) => boolean;
};

/**
 * The first-frame font gate. Resolves with the families it proved loaded, and
 * throws — never resolves quietly — when any of them is missing, so a capture
 * can never be encoded in a fallback face.
 */
export async function loadRenderFonts(input: LoadRenderFontsInput): Promise<readonly string[]> {
  if (input.stacks.length === 0) {
    throw new Error('font gate found no [data-render-font-warmup] elements');
  }
  const wanted: string[] = [];
  for (const stack of input.stacks) {
    const families = webFontFamilies(stack, input.faces);
    if (families.length === 0) {
      throw new Error(
        `font gate found no url()-backed @font-face for stack "${stack}" ` +
          `(${input.faces.length} font faces readable)`,
      );
    }
    for (const family of families) {
      if (!wanted.includes(family)) {
        wanted.push(family);
      }
    }
  }
  for (const family of wanted) {
    const spec = fontSpec(family);
    try {
      await input.load(spec);
    } catch (error) {
      throw new Error(`font gate could not load "${family}": ${errorMessage(error)}`);
    }
    if (!input.check(spec)) {
      // load() resolved but the face is not usable — capturing now would bake
      // a fallback typeface into the MP4.
      throw new Error(`font gate loaded "${family}" but the face is still unavailable`);
    }
  }
  return wanted;
}
