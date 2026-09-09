/**
 * The one name the exported pitch carries onto someone's phone.
 *
 * It lives in its own module because BOTH sides of the download need it and
 * they must not be able to drift: the route writes it into
 * `content-disposition`, and the kit card writes it into the anchor's
 * `download` attribute for the same-origin blob. A mismatch would be invisible
 * in review and visible only as a differently-named file, which is exactly the
 * class of bug GAP-9 was.
 *
 * The client component cannot import it from the route module — that module
 * pulls in the service-role Supabase client (`server-only`).
 */
export const RENDER_DOWNLOAD_FILENAME = 'friendword-pitch.mp4';

/**
 * The name the export card writes onto the anchor (0063 / T005 §4).
 *
 * The variant is part of the name because one campaign can, over its life,
 * finish a full render and later a highlight one: two files in the same
 * downloads folder that are NOT interchangeable, and a single name would
 * silently overwrite one with the other.
 *
 * The route keeps `RENDER_DOWNLOAD_FILENAME` in `content-disposition`: that
 * header never names the saved file on this path (the card downloads a
 * same-origin blob and the anchor's `download` wins), and the route would have
 * to re-read the job row to learn a variant it does not otherwise need.
 */
export function renderDownloadFilename(variant: 'full' | 'highlight' | null): string {
  return variant === null ? RENDER_DOWNLOAD_FILENAME : `friendword-pitch-${variant}.mp4`;
}
