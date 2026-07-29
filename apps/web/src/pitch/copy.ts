import type { PitchView } from './view';

/**
 * Reader-facing provenance copy for the public pitch page.
 *
 * Kept out of the page component so every sentence can be unit-tested against
 * the state that makes it true. The rule these functions exist to enforce
 * (CLAUDE.md §12, fifth audit verdicts 2/4/6): a sentence may only claim what
 * the code actually guarantees for THAT row.
 *
 * What the code guarantees, per row:
 *  - every published row: the subject Dater called approve_and_publish_pitch,
 *    picked the included photos, the audience and the duration;
 *  - `daterReviewedStructure` rows only: the published `structure` came from
 *    the Dater's own section editor (create_dater_revision's structure path
 *    normalizes it, derives headline/body from it, and approval copies it onto
 *    the draft). Rows without the flag carry AI-organized sections;
 *  - never: an edited transcript. Only /api/transcribe writes it, only while
 *    the draft is pre-consent, the revision freezes it, and approval publishes
 *    that frozen snapshot — the same text the Dater read at consent.
 */

type ProvenanceInput = Pick<
  PitchView,
  'daterName' | 'introducerPseudonym' | 'daterReviewedStructure' | 'isDemo'
>;

type TranscriptInput = Pick<
  PitchView,
  'daterName' | 'introducerPseudonym' | 'transcriptText' | 'captions'
>;

type ControlInput = ProvenanceInput & Pick<PitchView, 'audioUrl'>;

/** Where the written sections came from, and how far the Dater's review went. */
export function structureProvenanceLine(pitch: ProvenanceInput): string {
  if (pitch.isDemo) {
    return 'A structured example of how a friend’s pitch is organized. Demo data — no live recording or approval yet.';
  }
  if (pitch.daterReviewedStructure) {
    return `Drawn from ${pitch.introducerPseudonym}’s voice note — ${pitch.daterName} reviewed and approved each section above before this page went live.`;
  }
  // No claim about the sections: this page predates the section editor (or its
  // Dater never saved a section edit), so we only state what did happen.
  return `Drawn from ${pitch.introducerPseudonym}’s voice note and organized automatically — ${pitch.daterName} agreed to publish this page.`;
}

/**
 * The transcript sentence. Null when there is no transcript, so the page never
 * points at text that isn't there. Mentions the captions only when captions
 * actually render (PitchPlayer draws them from these same segments; with none
 * it says captions aren't available instead).
 */
export function transcriptProvenanceLine(pitch: TranscriptInput): string | null {
  if (pitch.transcriptText === null) {
    return null;
  }
  const surfaces =
    pitch.captions.length > 0
      ? 'It runs as the captions over the photos above and is printed in full below'
      : 'It is printed in full below';
  // NOT "word for word": this is a speech-to-text transcription, and no
  // provider guarantees a perfect record. What the code does guarantee is that
  // nobody edits it afterwards — say that, and only that.
  return `The transcript is an automatic transcription of ${pitch.introducerPseudonym}’s recording. ${surfaces} — nobody rewrites it afterwards, not even ${pitch.daterName}.`;
}

const INTEREST_TERMS =
  'Interest requires signing in and completing a dating profile with 2 photos, a bio, and dating intent. Contact details stay private.';

/** What the Dater actually controlled. One clause per capability the code has. */
export function daterControlLine(pitch: ControlInput): string {
  const recording =
    pitch.audioUrl === null ? '' : ' The friend’s original voice recording plays as they made it.';

  if (pitch.isDemo) {
    return `On a real page, the person being introduced reviews the pitch before it goes live, approves each written section, chooses which photos appear, has the final say on every claim our AI flags for checking, chooses who can reach out, and sets how long the page stays up. The friend’s original voice recording publishes exactly as they made it, and its automatic transcript publishes unedited. ${INTEREST_TERMS}`;
  }

  if (pitch.daterReviewedStructure) {
    // "any claim", not "every claim": the reader cannot see how many claims were
    // flagged, and "every" implies some were. "any" is true when the count is 0.
    return `${pitch.daterName} reviewed this page before it went live: they approved each written section, chose which photos appear, had the final say on any claim our AI flagged for checking, chose who can reach out, and set how long this page stays up.${recording} The recording and its automatic transcript are the one part ${pitch.daterName} could not change — they publish unedited. ${INTEREST_TERMS}`;
  }

  // Pre-section-editor row: they approved publication, the photos, the audience
  // and the duration. They did not sign off on the sections, so we don't say so.
  return `${pitch.daterName} agreed to publish this page before it went live, chose which photos appear, chose who can reach out, and set how long this page stays up.${recording} The recording and its automatic transcript publish unedited. ${INTEREST_TERMS}`;
}
