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
