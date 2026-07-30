'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import {
  buildPitchSceneV2,
  characterLength,
  DATER_HARD_CLAIM_ERRORS,
  DATER_PITCH_FIELD_LIMITS,
  daterPitchStructureEditSchema,
  deriveDaterPitchBody,
  deriveDaterPitchHeadline,
  PITCH_SCENE_TEMPLATES,
  rendersBlank,
  type DaterPitchStructureEdit,
  type PitchSceneAnyVersion,
  type PitchSceneTemplate,
} from '@friendword/contracts';
import {
  ageFromBirthDate,
  canonicalApproximateLocation,
  confirmDisplayName,
  ConsentRepo,
  DataLayerError,
  ensureUserRow,
  getDisplayNameStatus,
  type BrowserSupabaseClient,
  type ConsentPreview,
  type ConsentReview,
  type EditablePitchStructure,
} from '@friendword/data';

import { EmailSignIn } from '@/components/EmailSignIn';
import { MotionPitchPlayer } from '@/components/MotionPitchPlayer';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { requestDaterPitchModeration } from '@/lib/moderateText';
import {
  consentEditsDirty,
  DEFAULT_PITCH_SCENE_TEMPLATE,
  sameStructure,
  sceneMatchesPhotos,
  sceneTemplate,
} from '@/pitch/consentEdits';

import styles from './page.module.css';

// Dater AI-processing disclosure (third audit P0-NEW-3). Adding a new photo or
// editing the copy sends it to an external AI safety review before the page is
// public; that transfer needs an affirmative, draft-scoped consent first.
const DATER_AI_DISCLOSURE_COPY =
  'Adding a new photo or rewriting this text runs it through an external AI safety review (OpenAI) before your page goes public. Uploading only reaches Friendword’s storage — nothing is sent to the AI until you agree here.';
const DATER_AI_CONSENT_REQUIRED_COPY =
  'Agree to the AI safety review above before adding a photo or rewriting the text. Choosing from the current photos and approving stay open either way.';
const DATER_AI_UNAVAILABLE_COPY =
  'The AI safety review needed for new photos and text edits is unavailable right now. You can still choose from the current photos, approve, or request changes.';
const DATER_TEXT_FLAGGED_COPY =
  'That wording didn’t pass our safety review. Edit it and try saving again.';
const LEGACY_STRUCTURE_COPY =
  'This pitch was drafted before the section-by-section editor, so you edit the headline and introduction here. Everything published comes from these two fields.';

// Fifth audit P0: the public page prints these exact labels above each field
// (apps/web/app/p/[campaignSlug]/page.tsx), so what the Dater edits is visibly
// the same thing their readers see.
const STRUCTURE_LABELS = {
  hook: 'The hook',
  relationship_context: 'How they know each other',
  three_specific_qualities: 'Three specific things',
  evidence_or_anecdote: 'A moment that shows it',
  good_match_for: 'A good match for',
} as const;

const STRUCTURE_HINTS = {
  hook: 'The opening line at the top of your page.',
  relationship_context: 'How you and your friend know each other.',
  three_specific_qualities: 'Three things your page lists about you, in this order.',
  evidence_or_anecdote: 'The moment your friend told to show it.',
  good_match_for: 'Who your friend thinks you’d click with.',
} as const;

/**
 * The two free templates (docs/MOTION_PITCH_PLAN_2026-07-29.md §D4). Named for
 * what the Dater will see change, not for the parameters underneath: the template
 * moves timing, grade and colour, and cannot add or remove a word or a photo.
 */
const TEMPLATE_LABELS: Record<PitchSceneTemplate, string> = {
  warm: 'Warm — gentler cuts, warm colour',
  hype: 'Hype — faster cuts, louder colour',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  friend: 'Friend',
  coworker: 'Coworker',
  family: 'Family',
  roommate: 'Roommate',
  other: 'Knows you well',
};

const DURATION_LABELS: Record<string, string> = {
  lt1y: 'under a year',
  y1to3: '1–3 years',
  y3to10: '3–10 years',
  gt10y: '10+ years',
};

const CLAIM_ERROR_COPY: readonly (readonly [string, string])[] = [
  [
    'introducer cannot claim',
    'This link is for the friend you pitched — they need to approve it, not you.',
  ],
  ['linked to another account', 'This invite was already claimed with a different account.'],
  ['no longer claimable', 'This invite has already been answered or is no longer active.'],
];

const DATING_INTENTS = [
  { value: 'long-term', label: 'Long-term' },
  { value: 'open-to-either', label: 'Open to either' },
  { value: 'short-term', label: 'Short-term' },
] as const;
const PUBLISH_DAY_OPTIONS = [7, 14] as const;

// Third audit §8 acceptance 1: the review is broken into legible steps with a
// sticky progress rail. This is purely a structure/presentation layer — every
// input stays mounted, so the RPC call order and validation are unchanged.
type ReviewStepId = 'listen' | 'edit' | 'about' | 'reach' | 'claims' | 'approve';
type ReviewStepDef = { readonly id: ReviewStepId; readonly label: string; readonly nav: string };
const REVIEW_STEP_DEFS: readonly ReviewStepDef[] = [
  { id: 'listen', label: 'Listen to the voice note', nav: 'Listen' },
  { id: 'edit', label: 'Make it yours', nav: 'Make it yours' },
  { id: 'about', label: 'About you', nav: 'About you' },
  { id: 'reach', label: 'Who can reach out & for how long', nav: 'Reach & length' },
  { id: 'claims', label: 'Confirm your claims', nav: 'Confirm' },
  { id: 'approve', label: 'Preview & approve your page', nav: 'Preview & approve' },
];

type DatingIntent = (typeof DATING_INTENTS)[number]['value'];
type LocationPrecision = 'city' | 'region' | 'hidden';
type PublishDays = 7 | 14;

type ReviewContext = {
  readonly preview: ConsentPreview;
  readonly review: ConsentReview;
  readonly voiceUrl: string | null;
  readonly photos: readonly { readonly assetId: string; readonly url: string }[];
};

type FlowState =
  | { readonly step: 'loading' }
  | { readonly step: 'setup-missing' }
  | { readonly step: 'invalid' }
  | { readonly step: 'closed'; readonly preview: ConsentPreview }
  | { readonly step: 'signin'; readonly preview: ConsentPreview }
  | { readonly step: 'claiming'; readonly preview: ConsentPreview }
  | { readonly step: 'contact-mismatch'; readonly preview: ConsentPreview }
  | ({ readonly step: 'name-confirmation' } & ReviewContext)
  | ({ readonly step: 'review' } & ReviewContext)
  | { readonly step: 'publishing'; readonly preview: ConsentPreview }
  | { readonly step: 'revision-stale'; readonly preview: ConsentPreview }
  | {
      readonly step: 'responded';
      readonly action: 'request_changes' | 'decline';
    }
  | { readonly step: 'error'; readonly message: string };

function claimErrorDetail(error: unknown): string {
  const cause = error instanceof DataLayerError ? error.cause : error;
  // PostgREST errors are plain objects in some supabase-js versions, so read
  // .message structurally instead of requiring an Error instance.
  const detail =
    typeof cause === 'object' &&
    cause !== null &&
    'message' in cause &&
    typeof cause.message === 'string'
      ? cause.message
      : typeof cause === 'string'
        ? cause
        : String(cause);

  return detail;
}

function claimErrorMessage(detail: string): string {
  // MOTION PHASE 1: approve_and_publish_pitch refuses to publish when the
  // approved scene references a different set of photos than the ones being
  // included — it deletes the excluded assets, so publishing would leave the
  // timeline pointing at nothing. Name the fix instead of "something went
  // wrong": saving rebuilds the scene around the current selection.
  if (detail.toLowerCase().includes('scene')) {
    return 'Your photo choice changed after your page’s motion was built. Save your edits once more, then approve.';
  }
  const known = CLAIM_ERROR_COPY.find(([fragment]) => detail.includes(fragment));

  return known?.[1] ?? 'Something went wrong on our side. Refresh the page to try again.';
}

function relationshipLine(preview: ConsentPreview): string {
  const kind =
    preview.relationshipType === null
      ? 'Someone who knows you'
      : (RELATIONSHIP_LABELS[preview.relationshipType] ?? 'Someone who knows you');
  const duration =
    preview.relationshipDuration === null
      ? null
      : (DURATION_LABELS[preview.relationshipDuration] ?? null);

  return duration === null ? kind : `${kind} · ${duration}`;
}

async function loadReviewContext(
  repo: ConsentRepo,
  preview: ConsentPreview,
  review: ConsentReview,
): Promise<ReviewContext> {
  const voiceUrl =
    review.revision.voice_asset_path === null
      ? null
      : await repo.createAssetViewUrl(review.revision.voice_asset_path);
  const photoAssets = review.assets.filter((asset) => asset.asset_type === 'photo');
  const photos = await Promise.all(
    photoAssets.map(async (asset) => ({
      assetId: asset.id,
      url: await repo.createAssetViewUrl(asset.storage_path),
    })),
  );
  return { preview, review, voiceUrl, photos };
}

/**
 * Client-side mirror of private.normalized_dater_pitch_structure, phrased for
 * the person editing. The RPC re-checks all of it; this only saves the Dater a
 * round trip and names the field that needs attention.
 *
 * `rendersBlank` and `characterLength` come from the contract on purpose: a
 * field of zero-width spaces passes both `.trim()` and the server's `btrim`,
 * and `.length` counts UTF-16 units while the server counts characters. Using
 * the shared helpers keeps this check and the save schema in step.
 */
function structureFieldProblem(value: string, label: string, limit: number): string | null {
  if (rendersBlank(value)) {
    return `“${label}” can’t be empty — write it in your own words, or ask your friend for changes.`;
  }
  const length = characterLength(value.trim());
  if (length > limit) {
    return `“${label}” is ${length} characters — trim it to ${limit} or fewer.`;
  }
  return null;
}

/** Every problem, not just the first: an over-long AI draft can hit several. */
function structureProblems(structure: EditablePitchStructure): readonly string[] {
  const { hook, relationshipContext, quality, evidenceOrAnecdote, goodMatchFor } =
    DATER_PITCH_FIELD_LIMITS;
  return [
    structureFieldProblem(structure.hook, STRUCTURE_LABELS.hook, hook),
    structureFieldProblem(
      structure.relationship_context,
      STRUCTURE_LABELS.relationship_context,
      relationshipContext,
    ),
    ...structure.three_specific_qualities.map((value, index) =>
      structureFieldProblem(
        value,
        `${STRUCTURE_LABELS.three_specific_qualities} ${index + 1}`,
        quality,
      ),
    ),
    structureFieldProblem(
      structure.evidence_or_anecdote,
      STRUCTURE_LABELS.evidence_or_anecdote,
      evidenceOrAnecdote,
    ),
    structureFieldProblem(structure.good_match_for, STRUCTURE_LABELS.good_match_for, goodMatchFor),
  ].filter((problem): problem is string => problem !== null);
}

/**
 * Turns the RPC's rejection into something the Dater can act on. The matched
 * substrings are the verbatim strings raised by create_dater_revision; each one
 * has a different fix, so a single generic message would leave them stuck.
 */
function saveErrorCopy(detail: string): string {
  // create_dater_revision refuses a scene that does not match this revision's
  // transcript segments or photo snapshot (migration 0048). Reloading is the
  // honest fix: the client rebuilds the timeline from the server's own snapshot.
  if (detail.includes('pitch scene')) {
    return 'We couldn’t save the motion for your page. Reload this page and save again — your words and photos are untouched.';
  }
  if (detail.includes(DATER_HARD_CLAIM_ERRORS.notFlagged)) {
    return 'Your page changed while you were working on it. Reload to see the current claims and choose again.';
  }
  if (detail.includes('moderation verdict')) {
    return 'Our safety review hasn’t cleared this wording yet. Change something and save again, or request changes from your friend.';
  }
  if (detail.includes('pitch structure')) {
    return 'We couldn’t save that — every part has to be filled in and within its length limit.';
  }
  if (detail.includes('too long')) {
    return 'Keep the headline under 120 characters and the introduction under 2,000.';
  }
  return 'We could not save your edits. Please try again.';
}

/**
 * The claims the Dater says are still true. Order follows the flagged list so
 * the array the RPC receives is a stable subset of what it flagged.
 */
function retainedClaims(
  flagged: readonly string[],
  removed: ReadonlySet<number>,
): readonly string[] {
  return flagged.filter((_claim, index) => !removed.has(index));
}

/**
 * Included photo ids in play order. `photos` arrives in the revision's
 * sort_order with any new upload appended, which is the order the page plays and
 * the order the thumbnails below show; `includedAssetIds` is a selection, so its
 * own order (the order the Dater happened to tap) must not decide the timeline.
 */
function orderedIncludedPhotoIds(
  photos: readonly { readonly assetId: string }[],
  includedAssetIds: readonly string[],
): readonly string[] {
  return photos
    .map((photo) => photo.assetId)
    .filter((assetId) => includedAssetIds.includes(assetId));
}

function revisionAssetIds(
  review: ConsentReview,
  includedPhotoAssetIds: readonly string[],
): readonly string[] {
  const selectedPhotos = new Set(includedPhotoAssetIds);
  const assetsById = new Map(review.assets.map((asset) => [asset.id, asset]));
  const retainedRevisionAssets = review.revision.asset_ids.filter((assetId) => {
    const asset = assetsById.get(assetId);
    return asset?.asset_type !== 'photo' || selectedPhotos.has(assetId);
  });
  const retainedIds = new Set(retainedRevisionAssets);
  return [
    ...retainedRevisionAssets,
    ...includedPhotoAssetIds.filter((assetId) => !retainedIds.has(assetId)),
  ];
}

function audienceError(minAge: string, maxAge: string): string | null {
  const parsedMinAge = Number(minAge);
  if (!Number.isInteger(parsedMinAge) || parsedMinAge < 18) {
    return 'Minimum age must be 18 or older.';
  }
  if (maxAge.trim() === '') {
    return null;
  }
  const parsedMaxAge = Number(maxAge);
  if (!Number.isInteger(parsedMaxAge) || parsedMaxAge < parsedMinAge) {
    return 'Maximum age must be a whole number at or above the minimum.';
  }
  return null;
}

function datingIntentLabel(value: DatingIntent): string {
  return DATING_INTENTS.find((intent) => intent.value === value)?.label ?? value;
}

/**
 * Client-side gate mirroring the server's set_dater_profile checks (CP-1): the
 * dater confirms an 18+ birth date, a region, and what they're looking for
 * before the page can publish. The server re-validates all three.
 */
function daterProfileError(
  birthDate: string,
  region: string,
  ownIntent: DatingIntent | '',
): string | null {
  if (birthDate === '') {
    return 'Add your date of birth so we can confirm you’re 18 or older.';
  }
  const age = ageFromBirthDate(birthDate, new Date());
  if (age === null) {
    return 'Enter a valid date of birth.';
  }
  if (age < 18) {
    return 'You must be 18 or older to publish a page.';
  }
  if (region.trim() === '') {
    return 'Add your region (state, metro area, or region).';
  }
  if (ownIntent === '') {
    return 'Choose what you’re looking for.';
  }
  return null;
}

export function ConsentFlow({ token }: { readonly token: string }) {
  const router = useRouter();
  const clientRef = useRef<BrowserSupabaseClient | null | undefined>(undefined);
  if (clientRef.current === undefined) {
    clientRef.current = getSupabaseBrowserClient();
  }
  const client = clientRef.current;

  const [state, setState] = useState<FlowState>({ step: 'loading' });
  const [signingOut, setSigningOut] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [confirmingName, setConfirmingName] = useState(false);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [includedAssetIds, setIncludedAssetIds] = useState<readonly string[]>([]);
  const [editHeadline, setEditHeadline] = useState('');
  const [editBody, setEditBody] = useState('');
  // The five published fields. Null on a legacy snapshot the editor can't
  // parse — the flow then falls back to headline/body and says so.
  const [editStructure, setEditStructure] = useState<EditablePitchStructure | null>(null);
  // The motion template this save will build with. Seeded from the scene the
  // server already stored, so the switcher starts on what the Dater is watching.
  const [template, setTemplate] = useState<PitchSceneTemplate>(DEFAULT_PITCH_SCENE_TEMPLATE);
  const [savingEdits, setSavingEdits] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [daterAiConsent, setDaterAiConsent] = useState<'pending' | 'granted'>('pending');
  const [aiDisclosureRevision, setAiDisclosureRevision] = useState<string | null>(null);
  const [consentingAi, setConsentingAi] = useState(false);
  const [editStatus, setEditStatus] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [publishDays, setPublishDays] = useState<PublishDays>(14);
  const [locationPrecision, setLocationPrecision] = useState<LocationPrecision>('city');
  const [minimumAge, setMinimumAge] = useState('18');
  const [maximumAge, setMaximumAge] = useState('');
  const [selectedIntents, setSelectedIntents] = useState<readonly DatingIntent[]>([]);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  // CP-1: the dater confirms their own age, location, and intent here.
  const [birthDate, setBirthDate] = useState('');
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [ownIntent, setOwnIntent] = useState<DatingIntent | ''>('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [hardClaimsConfirmed, setHardClaimsConfirmed] = useState(false);
  // Fifth audit P0 (decision D2): the Dater disposes of each flagged claim.
  // Indices into `review.hardClaims` that they marked as taken off the page —
  // those are dropped from the published structure, and the confirmation they
  // sign covers only what is left.
  const [removedClaimIndexes, setRemovedClaimIndexes] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [responseNote, setResponseNote] = useState('');
  const [responding, setResponding] = useState(false);
  const [responseError, setResponseError] = useState<string | null>(null);
  const responseNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const claimStartedRef = useRef(false);
  const approvalStartedRef = useRef(false);
  const [activeReviewStep, setActiveReviewStep] = useState<ReviewStepId>('listen');

  const enterReview = useCallback(
    async (activeClient: BrowserSupabaseClient, preview: ConsentPreview) => {
      if (claimStartedRef.current) {
        return;
      }
      claimStartedRef.current = true;
      setState({ step: 'claiming', preview });

      const repo = new ConsentRepo(activeClient);
      try {
        await ensureUserRow(activeClient);
        const { pitchDraftId } = await repo.claim(token);
        const review = await repo.getConsentReview(pitchDraftId);
        const context = await loadReviewContext(repo, preview, review);
        const disclosureRevision = await repo.getAiDisclosureRevision().catch(() => null);
        setAiDisclosureRevision(disclosureRevision);
        setDaterAiConsent('pending');
        setIncludedAssetIds(context.photos.map((photo) => photo.assetId));
        setEditHeadline(review.revision.headline);
        setEditBody(review.revision.body);
        setEditStructure(review.editableStructure);
        setTemplate(sceneTemplate(review.scene));
        setEditStatus(null);
        setEditError(null);
        setHardClaimsConfirmed(false);
        setRemovedClaimIndexes(new Set());
        setBirthDate('');
        setRegion('');
        setCity('');
        setOwnIntent('');
        setProfileError(null);
        setRequestingChanges(false);
        setResponseNote('');
        setResponseError(null);
        const nameStatus = await getDisplayNameStatus(activeClient);
        setDisplayName(nameStatus.displayName);
        if (nameStatus.confirmed) {
          setState({ step: 'review', ...context });
        } else {
          setState({ step: 'name-confirmation', ...context });
        }
      } catch (error: unknown) {
        if (!(error instanceof Error)) {
          throw error;
        }
        claimStartedRef.current = false;
        const detail = claimErrorDetail(error);
        if (detail.includes('different contact')) {
          setState({ step: 'contact-mismatch', preview });
          return;
        }
        setState({ step: 'error', message: claimErrorMessage(detail) });
      }
    },
    [token],
  );

  useEffect(() => {
    if (client === null) {
      setState({ step: 'setup-missing' });
      return;
    }

    let cancelled = false;
    let cleanupAuthListener: (() => void) | undefined;
    const repo = new ConsentRepo(client);

    void (async () => {
      const preview = await repo.getPreview(token).catch(() => null);
      if (cancelled) {
        return;
      }
      if (preview === null) {
        setState({ step: 'invalid' });
        return;
      }
      if (preview.requestStatus !== 'pending' && preview.requestStatus !== 'claimed') {
        setState({ step: 'closed', preview });
        return;
      }

      const { data } = await client.auth.getSession();
      if (cancelled) {
        return;
      }
      if (data.session !== null) {
        void enterReview(client, preview);
        return;
      }

      setState({ step: 'signin', preview });

      const { data: subscription } = client.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN') {
          void enterReview(client, preview);
        }
      });
      cleanupAuthListener = () => subscription.subscription.unsubscribe();
      if (cancelled) {
        cleanupAuthListener();
      }
    })();

    return () => {
      cancelled = true;
      cleanupAuthListener?.();
    };
  }, [client, token, enterReview]);

  async function handleApprove() {
    if (client === null || state.step !== 'review' || approvalStartedRef.current) {
      return;
    }

    const { preview, review } = state;
    const validationMessage = audienceError(minimumAge, maximumAge);
    if (validationMessage !== null) {
      setPreferenceError(validationMessage);
      return;
    }
    const profileValidation = daterProfileError(birthDate, region, ownIntent);
    if (profileValidation !== null || ownIntent === '') {
      setProfileError(profileValidation ?? 'Choose what you’re looking for.');
      return;
    }
    approvalStartedRef.current = true;
    setState({ step: 'publishing', preview });
    try {
      const repo = new ConsentRepo(client);
      // CP-1: confirm the dater's own profile (age/location/intent) before the
      // publish preferences and approval snapshot are written.
      await repo.setDaterProfile({
        birthDate,
        region: region.trim(),
        ...(city.trim() === '' ? {} : { city: city.trim() }),
        intent: ownIntent,
      });
      await repo.setPublishPreferences({
        draftId: review.revision.pitch_draft_id,
        audience: {
          minAge: Number(minimumAge),
          ...(maximumAge.trim() === '' ? {} : { maxAge: Number(maximumAge) }),
          ...(selectedIntents.length === 0 ? {} : { intents: selectedIntents }),
        },
        locationPrecision,
        publishDays,
      });
      const { campaignSlug } = await repo.approveAndPublish({
        draftId: review.revision.pitch_draft_id,
        campaignDays: publishDays,
        revisionId: review.revision.id,
        includedAssetIds,
        hardClaimsConfirmed,
      });
      router.push(`/p/${campaignSlug}`);
    } catch (error: unknown) {
      if (!(error instanceof Error)) {
        throw error;
      }
      const detail = claimErrorDetail(error);
      if (detail.includes('latest consent revision')) {
        setState({ step: 'revision-stale', preview });
        return;
      }
      setState({ step: 'error', message: claimErrorMessage(detail) });
    }
  }

  async function handleDaterAiConsent() {
    if (client === null || state.step !== 'review' || aiDisclosureRevision === null) {
      return;
    }
    setConsentingAi(true);
    setEditError(null);
    try {
      const repo = new ConsentRepo(client);
      await repo.recordDaterAiConsent(state.review.revision.pitch_draft_id, aiDisclosureRevision);
      setDaterAiConsent('granted');
    } catch (error: unknown) {
      if (!(error instanceof Error)) {
        throw error;
      }
      setEditError('We could not record your agreement to the AI review. Please try again.');
    } finally {
      setConsentingAi(false);
    }
  }

  async function handleSaveEdits() {
    if (client === null || state.step !== 'review') {
      return;
    }
    const review = state.review;
    // Fifth audit P0: on the structure path the five published fields are the
    // approved content and headline/body are derived with the RPC's formula, so
    // the page can never show sentences the Dater didn't approve.
    let editedStructure: DaterPitchStructureEdit | undefined;
    let headline: string;
    let body: string;
    let textChanged: boolean;
    if (editStructure !== null) {
      // Lockout fix (fifth audit, verdicts 4 and 6). create_dater_revision
      // derives headline/body from the published structure on EVERY path, so a
      // photo-only save that omitted the structure would still be gated on the
      // five-part moderation string. The structure therefore goes with every
      // save, which also keeps what we moderate byte-identical to what the RPC
      // hashes: it normalizes with btrim, and these values are already trimmed.
      const problems = structureProblems(editStructure);
      if (problems.length > 0) {
        setEditError(problems.join(' '));
        return;
      }
      const parsedStructure = daterPitchStructureEditSchema.safeParse(editStructure);
      if (!parsedStructure.success) {
        setEditError('Check each part of your pitch before saving.');
        return;
      }
      editedStructure = parsedStructure.data;
      headline = deriveDaterPitchHeadline(parsedStructure.data);
      body = deriveDaterPitchBody(parsedStructure.data);
      textChanged = !sameStructure(editStructure, review.editableStructure);
    } else {
      headline = editHeadline.trim();
      body = editBody.trim();
      if (rendersBlank(editHeadline) || rendersBlank(editBody)) {
        setEditError('Headline and introduction are required.');
        return;
      }
      if (characterLength(headline) > 120 || characterLength(body) > 2000) {
        setEditError('Keep the headline under 120 characters and the introduction under 2,000.');
        return;
      }
      textChanged = headline !== review.revision.headline || body !== review.revision.body;
    }

    // A real text edit needs the Dater's AI-processing consent before the copy
    // leaves for the external safety review. An unchanged save still registers
    // its verdict below, but /api/moderate-text answers that from its
    // content-addressed ledger without calling the provider, so it needs no
    // consent — and skipping the check here is what keeps a photo-only save
    // possible while the AI review is unavailable.
    if (textChanged && daterAiConsent !== 'granted') {
      setEditError(DATER_AI_CONSENT_REQUIRED_COPY);
      return;
    }

    // Per-claim disposition (decision D2). Omitted when nothing was removed:
    // absent means "keep them all", which is also what a pre-0047 function does
    // with no such parameter. An empty array is NOT the same thing — it means
    // the Dater took every flagged claim off the page.
    const retained = retainedClaims(review.hardClaims, removedClaimIndexes);
    const claimsChanged = retained.length !== review.hardClaims.length;

    setSavingEdits(true);
    setEditError(null);
    setEditStatus(null);
    try {
      const repo = new ConsentRepo(client);
      // Every save, not only a text edit: create_dater_revision checks the
      // verdict for the words it is about to freeze on every call, so the
      // client has to register that exact string every time. Repeats are
      // answered from the ledger and cost no provider call.
      {
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (sessionError !== null || accessToken === undefined) {
          throw new Error('text moderation requires a session');
        }
        const outcome = await requestDaterPitchModeration(
          review.revision.pitch_draft_id,
          headline,
          body,
          accessToken,
          // The three qualities publish verbatim but are absent from the
          // derived body, so they must be inside the moderated text.
          editedStructure?.three_specific_qualities,
        );
        if (outcome === 'flagged') {
          setEditError(DATER_TEXT_FLAGGED_COPY);
          return;
        }
        if (outcome === 'consent-required') {
          setDaterAiConsent('pending');
          setEditError(DATER_AI_CONSENT_REQUIRED_COPY);
          return;
        }
        // 'passed' or 'unavailable' (501/502/429): proceed. The DB revision gate
        // fails closed on a missing verdict while enforcement is on.
      }
      // The motion timeline this save freezes. Built from the revision's own
      // transcript segments and words and the photos still included, in play
      // order — never from a measured audio duration, so the scene is identical
      // on every device. Null (too short, no segments) omits the argument, and
      // the RPC then forward-copies the previous scene against the new asset
      // snapshot.
      //
      // `words` is omitted rather than empty when this recording has none (a
      // pre-A7 transcript, or a manual pitch): the builder then degrades to
      // segment rhythm and emits no wordPop, which is also the only thing the DB
      // will accept for such a row.
      //
      // `structure` is the structure THIS save writes, so a text card can only
      // ever name a sentence this same revision carries. It is omitted on the
      // legacy headline/body path: that revision's structure was never reviewed
      // section by section, and a 92px card is not the place to find out.
      const newScene = buildPitchSceneV2({
        template,
        photoAssetIds: orderedIncludedPhotoIds(state.photos, includedAssetIds),
        segments: review.transcriptSegments,
        ...(review.transcriptWords.length === 0 ? {} : { words: review.transcriptWords }),
        ...(editedStructure === undefined
          ? {}
          : {
              structure: {
                ...editedStructure,
                hard_claims_requiring_confirmation: [...retained],
              },
            }),
      });
      await repo.createDaterRevision({
        draftId: review.revision.pitch_draft_id,
        headline,
        body,
        includedAssetIds: revisionAssetIds(review, includedAssetIds),
        ...(editedStructure === undefined ? {} : { structure: editedStructure }),
        ...(claimsChanged ? { retainedHardClaims: retained } : {}),
        ...(newScene === null ? {} : { newScene }),
      });
      const latestReview = await repo.getConsentReview(review.revision.pitch_draft_id);
      const context = await loadReviewContext(repo, state.preview, latestReview);
      setState({ step: 'review', ...context });
      setIncludedAssetIds(context.photos.map((photo) => photo.assetId));
      setEditHeadline(latestReview.revision.headline);
      setEditBody(latestReview.revision.body);
      setEditStructure(latestReview.editableStructure);
      setTemplate(sceneTemplate(latestReview.scene));
      setHardClaimsConfirmed(false);
      setRemovedClaimIndexes(new Set());
      setEditStatus(
        claimsChanged
          ? 'Saved. The claims you took off your page are gone from it.'
          : 'Your edits are saved in a new review version.',
      );
    } catch (error: unknown) {
      if (!(error instanceof Error)) {
        throw error;
      }
      const detail = claimErrorDetail(error);
      setEditError(saveErrorCopy(detail));
    } finally {
      setSavingEdits(false);
    }
  }

  function updateStructureField(
    field: 'hook' | 'relationship_context' | 'evidence_or_anecdote' | 'good_match_for',
    value: string,
  ) {
    setEditStructure((current) => (current === null ? current : { ...current, [field]: value }));
    setEditStatus(null);
    setEditError(null);
  }

  /**
   * Records one claim's disposition. The confirmation checkbox resets: it
   * covers "the claims I kept", and that set just changed.
   */
  function setClaimRemoved(index: number, removed: boolean) {
    setRemovedClaimIndexes((current) => {
      const next = new Set(current);
      if (removed) {
        next.add(index);
      } else {
        next.delete(index);
      }
      return next;
    });
    setHardClaimsConfirmed(false);
    setEditStatus(null);
    setEditError(null);
  }

  function updateQuality(index: number, value: string) {
    setEditStructure((current) =>
      current === null
        ? current
        : {
            ...current,
            three_specific_qualities: current.three_specific_qualities.map((quality, position) =>
              position === index ? value : quality,
            ),
          },
    );
    setEditStatus(null);
    setEditError(null);
  }

  async function handlePhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.item(0) ?? null;
    event.target.value = '';
    if (client === null || state.step !== 'review' || file === null) {
      return;
    }
    // Consent precedes processing: never send a new photo to validation (and on
    // to the AI provider) until the Dater has affirmed the AI disclosure.
    if (daterAiConsent !== 'granted') {
      setEditStatus(null);
      setEditError(DATER_AI_CONSENT_REQUIRED_COPY);
      return;
    }

    setUploadingPhoto(true);
    setEditStatus(null);
    setEditError(null);
    try {
      const repo = new ConsentRepo(client);
      if (file.type !== 'image/jpeg' && file.type !== 'image/png' && file.type !== 'image/webp') {
        setEditError('Photo validation failed — try a different photo.');
        return;
      }
      const supportedContentType = file.type;
      const extension =
        supportedContentType === 'image/png'
          ? 'png'
          : supportedContentType === 'image/webp'
            ? 'webp'
            : 'jpg';
      const fileName = `dater-${crypto.randomUUID()}.${extension}`;
      const asset = await repo.uploadDaterPhoto(
        state.review.revision.pitch_draft_id,
        fileName,
        await file.arrayBuffer(),
        supportedContentType,
      );
      const { data, error } = await client.auth.getSession();
      const accessToken = data.session?.access_token;
      if (error !== null || accessToken === undefined) {
        throw new Error('photo validation requires a session');
      }
      const objectName = asset.storage_path.replace(/^pitch-media\//, '');
      const validationResponse = await fetch('/api/media/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ bucket: 'pitch-media', objectName }),
      });
      const verdict: unknown = await validationResponse.json().catch(() => null);
      const validated =
        validationResponse.ok &&
        typeof verdict === 'object' &&
        verdict !== null &&
        'ok' in verdict &&
        verdict.ok === true;
      if (!validated) {
        setEditError('Photo validation failed — try a different photo.');
        return;
      }

      const url = await repo.createAssetViewUrl(asset.storage_path);
      setState((current) =>
        current.step === 'review'
          ? { ...current, photos: [...current.photos, { assetId: asset.id, url }] }
          : current,
      );
      setIncludedAssetIds((current) => [...current, asset.id]);
      setEditStatus('Photo uploaded. Save your edits to add it to this review version.');
    } catch (error: unknown) {
      if (!(error instanceof Error)) {
        throw error;
      }
      setEditError('Photo validation failed — try a different photo.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleRequestChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (client === null || state.step !== 'review') {
      return;
    }

    setResponding(true);
    setResponseError(null);
    try {
      const repo = new ConsentRepo(client);
      await repo.respondToConsent(
        state.review.revision.pitch_draft_id,
        'request_changes',
        responseNote,
      );
      setState({ step: 'responded', action: 'request_changes' });
    } catch (error: unknown) {
      if (!(error instanceof Error)) {
        throw error;
      }
      setResponseError('We could not send your request. Check the note and try again.');
    } finally {
      setResponding(false);
    }
  }

  async function handleDecline() {
    if (client === null || state.step !== 'review') {
      return;
    }
    const confirmed = window.confirm(
      'Declining ends this consent request and archives the pitch. This cannot be undone. Decline this pitch?',
    );
    if (!confirmed) {
      return;
    }

    setResponding(true);
    setResponseError(null);
    try {
      const repo = new ConsentRepo(client);
      await repo.respondToConsent(
        state.review.revision.pitch_draft_id,
        'decline',
        'I do not consent to publication.',
      );
      setState({ step: 'responded', action: 'decline' });
    } catch (error: unknown) {
      if (!(error instanceof Error)) {
        throw error;
      }
      setResponseError('We could not decline this pitch. Please try again.');
    } finally {
      setResponding(false);
    }
  }

  async function handleRetryWithAnotherEmail() {
    if (client === null || state.step !== 'contact-mismatch') {
      return;
    }

    const { preview } = state;
    setSigningOut(true);
    try {
      const { error } = await client.auth.signOut();
      if (error !== null) {
        throw error;
      }
      claimStartedRef.current = false;
      setState({ step: 'signin', preview });
    } catch (error: unknown) {
      if (!(error instanceof Error)) {
        throw error;
      }
      setState({
        step: 'error',
        message: 'We could not sign you out. Refresh the page and try again.',
      });
    } finally {
      setSigningOut(false);
    }
  }

  async function handleConfirmDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (client === null || state.step !== 'name-confirmation') {
      return;
    }

    setConfirmingName(true);
    setDisplayNameError(null);
    try {
      await confirmDisplayName(client, displayName);
      setDisplayName(displayName.trim());
      setState({ ...state, step: 'review' });
    } catch (error: unknown) {
      if (error instanceof Error) {
        setDisplayNameError('We could not save your name. Check it and try again.');
        return;
      }
      throw error;
    } finally {
      setConfirmingName(false);
    }
  }

  const currentRevisionPhotoIds =
    state.step === 'review'
      ? state.review.assets.filter((asset) => asset.asset_type === 'photo').map((asset) => asset.id)
      : [];
  // Every section that would fail the save right now. Surfaced in the editor,
  // not just after a rejected save, because the AI draft can arrive over the
  // limit and the Dater has to know which section to shorten.
  const structureBlockers = editStructure === null ? [] : structureProblems(editStructure);
  const flaggedClaims = state.step === 'review' ? state.review.hardClaims : [];
  const claimsToKeep = retainedClaims(flaggedClaims, removedClaimIndexes);
  // A claim marked "I took that out" is only actually gone once the new revision
  // is written, so an undisposed choice counts as an unsaved edit.
  const claimsDirty = claimsToKeep.length !== flaggedClaims.length;
  // The template the server actually built this revision's motion with. Switching
  // away from it is an unsaved edit like any other, so the approve gate closes
  // until the save rebuilds the scene.
  const savedTemplate = sceneTemplate(state.step === 'review' ? state.review.scene : null);
  const editsDirty =
    state.step === 'review' &&
    consentEditsDirty({
      structure: editStructure,
      savedStructure: state.review.editableStructure,
      headline: editHeadline,
      savedHeadline: state.review.revision.headline,
      body: editBody,
      savedBody: state.review.revision.body,
      claimsDirty,
      includedAssetIds,
      revisionPhotoIds: currentRevisionPhotoIds,
      template,
      savedTemplate,
    });
  const currentAudienceError = audienceError(minimumAge, maximumAge);
  const currentProfileError = daterProfileError(birthDate, region, ownIntent);

  // CP-1 real output preview: the exact snapshot the public page will show,
  // built from the approval revision plus the dater's confirmed inputs.
  const reviewPhotos = state.step === 'review' ? state.photos : [];
  const previewIncludedPhotos = reviewPhotos.filter((photo) =>
    includedAssetIds.includes(photo.assetId),
  );
  const representativePhoto = previewIncludedPhotos[0] ?? null;
  // MOTION PHASE 1. The preview plays the scene the SERVER stored on this
  // revision — never a scene built here. Approval means "yes to that timeline",
  // which only holds if the bytes the Dater watched came back from the server.
  const serverScene: PitchSceneAnyVersion | null =
    state.step === 'review' ? state.review.scene : null;
  const orderedIncludedPhotos =
    state.step === 'review' ? orderedIncludedPhotoIds(state.photos, includedAssetIds) : [];
  // An unsaved photo change makes the stored scene describe a different set of
  // photos. Playing it anyway would show a photo the Dater just excluded, and
  // approve_and_publish_pitch would reject the mismatch — so the motion preview
  // waits for the save that rebuilds the scene.
  const previewScene = sceneMatchesPhotos(serverScene, orderedIncludedPhotos) ? serverScene : null;
  const previewCaptions = state.step === 'review' ? state.review.transcriptSegments : [];
  // The words and sentences the approved scene REFERENCES. Both come from the
  // server's own revision, like the scene itself: a card must print the reviewed
  // sentence, not the one being typed above, or "this is your page" would be a
  // claim about text nobody has saved yet. Unsaved edits are covered by the
  // stale note plus the approve gate.
  const previewSceneWords = state.step === 'review' ? state.review.transcriptWords : [];
  const previewSceneText = state.step === 'review' ? state.review.editableStructure : null;
  // The page's headline is the hook whenever the structure is editable, matching
  // what the server derives and what /p/[campaignSlug] prints.
  const previewHeadline = editStructure === null ? editHeadline : editStructure.hook;
  const previewAge = birthDate === '' ? null : ageFromBirthDate(birthDate, new Date());
  const previewLocation =
    locationPrecision === 'hidden'
      ? null
      : canonicalApproximateLocation(
          locationPrecision === 'region' ? 'region' : 'city',
          region.trim() === '' ? null : region.trim(),
          city.trim() === '' ? null : city.trim(),
          null,
        );
  const previewAudience = (() => {
    const min = minimumAge.trim() === '' ? '18' : minimumAge.trim();
    const range = maximumAge.trim() === '' ? `${min}+` : `${min}–${maximumAge.trim()}`;
    const intents =
      selectedIntents.length === 0
        ? 'any intent'
        : selectedIntents.map((intent) => datingIntentLabel(intent)).join(', ');
    return `Ages ${range} · ${intents}`;
  })();

  // The claims step only exists when there is something to confirm, so the
  // progress rail hides it otherwise (keeps step numbers honest).
  const showClaims =
    state.step === 'review' && (state.review.hardClaims.length > 0 || state.review.daterEdited);
  const reviewSteps = REVIEW_STEP_DEFS.filter(
    (definition) => definition.id !== 'claims' || showClaims,
  );
  const reviewStepCount = reviewSteps.length;
  const reviewStepNumber = (id: ReviewStepId) =>
    reviewSteps.findIndex((definition) => definition.id === id) + 1;

  // Scroll-spy: highlight the step nearest the viewport centre. Every step
  // section is rendered, so this only reflects position — it never gates input.
  useEffect(() => {
    if (state.step !== 'review') {
      return;
    }
    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-consent-step]'));
    if (sections.length === 0 || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const nearest = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const id = nearest?.target.getAttribute('data-consent-step');
        if (id !== null && id !== undefined) {
          setActiveReviewStep(id as ReviewStepId);
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [state.step, showClaims]);

  const goToReviewStep = useCallback((id: ReviewStepId) => {
    const section = document.getElementById(`consent-step-${id}`);
    if (section === null) {
      return;
    }
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
    const heading = section.querySelector<HTMLElement>('[data-step-heading]');
    heading?.focus();
    setActiveReviewStep(id);
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <p className={styles.wordmark}>Friendword</p>

        {state.step === 'loading' && (
          <section className={styles.card} aria-live="polite">
            <h1 className={styles.title}>Finding your invite…</h1>
            <p className={styles.muted}>One second while we pull up the pitch.</p>
          </section>
        )}

        {state.step === 'setup-missing' && (
          <section className={styles.card}>
            <h1 className={styles.title}>Almost ready</h1>
            <p className={styles.muted}>
              This environment is missing its Supabase configuration, so invites cannot load yet.
            </p>
          </section>
        )}

        {state.step === 'invalid' && (
          <section className={styles.card}>
            <span className={styles.badge}>Invite not found</span>
            <h1 className={styles.title}>This link doesn’t play.</h1>
            <p className={styles.muted}>
              The invite may have been mistyped or replaced. Ask your friend to send their newest
              link.
            </p>
          </section>
        )}

        {state.step === 'closed' && (
          <section className={styles.card}>
            <span className={styles.badge}>Already answered</span>
            <h1 className={styles.title}>This invite is wrapped up.</h1>
            <p className={styles.muted}>
              {state.preview.requestStatus === 'approved'
                ? 'You already approved this pitch — it’s live.'
                : 'This invite is no longer active.'}
            </p>
          </section>
        )}

        {state.step === 'contact-mismatch' && (
          <section className={styles.card}>
            <span className={styles.badge}>Email mismatch</span>
            <h1 className={styles.title}>Use the email that received this invite.</h1>
            <p className={styles.lede}>
              This invite was sent to a different email address. Sign in with the email that
              received it.
            </p>
            <button
              className={styles.secondary}
              type="button"
              disabled={signingOut}
              onClick={() => {
                void handleRetryWithAnotherEmail();
              }}
            >
              {signingOut ? 'Signing out…' : 'Sign out and use another email'}
            </button>
          </section>
        )}

        {(state.step === 'signin' || state.step === 'claiming' || state.step === 'publishing') && (
          <section className={styles.card} aria-live="polite">
            <span className={styles.badge}>{relationshipLine(state.preview)}</span>
            <h1 className={styles.title}>
              {state.preview.introducerDisplayName} recorded a pitch about you.
            </h1>
            <p className={styles.lede}>
              Nothing goes public until you hear it and say yes. First, confirm it’s really you.
            </p>

            {state.step === 'signin' && client !== null && (
              <EmailSignIn
                client={client}
                styles={styles}
                reason="Only you can approve this page, so we confirm the email this invite was sent to."
                finePrint="No password, no signup forms — the link brings you right back here."
              />
            )}

            {state.step === 'claiming' && <p className={styles.muted}>Unlocking your review…</p>}
            {state.step === 'publishing' && <p className={styles.muted}>Publishing your page…</p>}
          </section>
        )}

        {state.step === 'name-confirmation' && (
          <section className={styles.card}>
            <span className={styles.badge}>Before you review</span>
            <h1 className={styles.title}>What should we call you?</h1>
            <p className={styles.lede}>
              Check the name below before it appears on your Friendword page. You can change it now.
            </p>
            <form className={styles.form} onSubmit={handleConfirmDisplayName}>
              <label className={styles.label} htmlFor="consent-display-name">
                Your name
              </label>
              <input
                id="consent-display-name"
                className={styles.input}
                type="text"
                required
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              <button className={styles.secondary} type="submit" disabled={confirmingName}>
                {confirmingName ? 'Saving…' : 'Save & review the pitch'}
              </button>
              {displayNameError !== null && <p className={styles.error}>{displayNameError}</p>}
            </form>
          </section>
        )}

        {state.step === 'review' && (
          <section className={styles.card}>
            <span className={styles.badge}>{relationshipLine(state.preview)}</span>
            <h1 className={styles.title}>
              Hear what {state.preview.introducerDisplayName} says about you.
            </h1>
            <p className={styles.lede}>
              This is {state.preview.introducerDisplayName}’s original voice — exactly what people
              will hear if you approve it.
            </p>

            <nav className={styles.progressNav} aria-label="Review progress">
              <ol className={styles.progressList}>
                {reviewSteps.map((definition, index) => {
                  const active = activeReviewStep === definition.id;
                  return (
                    <li key={definition.id} className={styles.progressItem}>
                      <a
                        className={`${styles.progressLink} ${active ? styles.progressLinkActive : ''}`}
                        href={`#consent-step-${definition.id}`}
                        aria-current={active ? 'step' : undefined}
                        onClick={(event) => {
                          event.preventDefault();
                          goToReviewStep(definition.id);
                        }}
                      >
                        <span className={styles.progressIndex} aria-hidden="true">
                          {index + 1}
                        </span>
                        {definition.nav}
                      </a>
                    </li>
                  );
                })}
              </ol>
            </nav>

            <section
              className={styles.stepSection}
              id="consent-step-listen"
              data-consent-step="listen"
              aria-labelledby="consent-step-listen-heading"
            >
              <p className={styles.stepMarker}>
                Step {reviewStepNumber('listen')} of {reviewStepCount}
              </p>
              <h2
                id="consent-step-listen-heading"
                className={`${styles.sectionHeading} ${styles.stepHeading}`}
                data-step-heading
                tabIndex={-1}
              >
                Listen to the voice note
              </h2>
              <div className={styles.playerBlock}>
                {state.voiceUrl === null ? (
                  <p className={styles.muted}>
                    The voice note isn’t ready to play here yet. You can still review the details
                    below.
                  </p>
                ) : (
                  <audio className={styles.audio} controls preload="metadata" src={state.voiceUrl}>
                    Your browser cannot play this audio.
                  </audio>
                )}
              </div>

              {/* Fifth audit P0 (decision D1): the transcript is published — in
                  full under the pitch AND as the captions that run over the
                  photos — so "approve" cannot mean anything unless the Dater has
                  seen it. It is read-only on purpose: it is what their friend
                  actually said, and letting anyone rewrite it would end the one
                  guarantee the product makes about the recording. The way to
                  reject it is "Request changes" at the bottom of this page. */}
              <div className={styles.transcriptBlock} data-consent-transcript>
                {/* NOT "word for word": this is a speech-to-text transcription and
                    nothing guarantees it matches the recording exactly — the same
                    reason apps/web/src/pitch/copy.ts refuses that phrase on the
                    public page. What the code does guarantee is that this exact
                    text is what publishes, unedited. Say only that. */}
                <h3 className={styles.transcriptHeading}>
                  The transcript that will publish, in full
                </h3>
                {state.review.transcriptText === null ? (
                  <p className={styles.muted}>
                    We don’t have a written transcript of this recording, so your page will publish
                    no transcript and no captions — just the recording itself. Listen to the whole
                    thing before you approve.
                  </p>
                ) : (
                  <>
                    <p className={styles.muted}>
                      This text publishes on your page: it runs as the captions over your photos and
                      is printed in full underneath. You can’t edit it — it’s{' '}
                      {state.preview.introducerDisplayName}’s own words, transcribed. If any of it
                      is wrong or you don’t want it public, use <strong>Request changes</strong> at
                      the bottom instead of approving.
                    </p>
                    <blockquote className={styles.transcriptText} data-consent-transcript-text>
                      {state.review.transcriptText}
                    </blockquote>
                  </>
                )}
              </div>
            </section>

            <section
              className={`${styles.editBlock} ${styles.stepSection}`}
              id="consent-step-edit"
              data-consent-step="edit"
              aria-labelledby="consent-step-edit-heading"
            >
              <p className={styles.stepMarker}>
                Step {reviewStepNumber('edit')} of {reviewStepCount}
              </p>
              <h2
                id="consent-step-edit-heading"
                className={`${styles.sectionHeading} ${styles.stepHeading}`}
                data-step-heading
                tabIndex={-1}
              >
                Make it yours
              </h2>
              <p className={styles.muted}>
                Edit every word and choose every photo before you approve.
              </p>

              {daterAiConsent !== 'granted' && (
                <div className={styles.aiConsentBlock}>
                  {aiDisclosureRevision !== null ? (
                    <>
                      <p className={styles.muted}>{DATER_AI_DISCLOSURE_COPY}</p>
                      <button
                        className={styles.secondary}
                        type="button"
                        disabled={consentingAi}
                        onClick={() => {
                          void handleDaterAiConsent();
                        }}
                      >
                        {consentingAi ? 'Saving…' : 'Agree to the AI safety review'}
                      </button>
                    </>
                  ) : (
                    <p className={styles.muted} role="status">
                      {DATER_AI_UNAVAILABLE_COPY}
                    </p>
                  )}
                </div>
              )}

              {editStructure === null ? (
                <div className={styles.editFields}>
                  <p className={styles.muted} role="status">
                    {LEGACY_STRUCTURE_COPY}
                  </p>
                  <label className={styles.label} htmlFor="dater-headline">
                    Headline
                  </label>
                  <input
                    id="dater-headline"
                    className={styles.input}
                    type="text"
                    required
                    maxLength={120}
                    value={editHeadline}
                    onChange={(event) => {
                      setEditHeadline(event.target.value);
                      setEditStatus(null);
                      setEditError(null);
                    }}
                  />
                  <label className={styles.label} htmlFor="dater-body">
                    Introduction
                  </label>
                  <textarea
                    id="dater-body"
                    className={styles.textarea}
                    required
                    maxLength={2000}
                    rows={7}
                    value={editBody}
                    onChange={(event) => {
                      setEditBody(event.target.value);
                      setEditStatus(null);
                      setEditError(null);
                    }}
                  />
                </div>
              ) : (
                <div className={styles.editFields}>
                  <p className={styles.muted}>
                    Your page shows these five parts, in this order. Change any of them — what you
                    leave here is exactly what publishes.
                  </p>

                  {/* The AI draft is not bound by the edit limits, so a section
                      can arrive longer than the Dater is allowed to save. Say so
                      here rather than only on a failed save, and name every
                      section that needs trimming (fifth audit, verdict 5). */}
                  {structureBlockers.length > 0 && (
                    <div className={styles.error} role="status" data-structure-blockers>
                      <p>
                        Your friend’s draft is over the limit in{' '}
                        {structureBlockers.length === 1
                          ? 'one section'
                          : `${structureBlockers.length} sections`}
                        . Shorten {structureBlockers.length === 1 ? 'it' : 'them'} to save any
                        change here — or ask for a rewrite with “Request changes” below.
                      </p>
                      <ul>
                        {structureBlockers.map((problem) => (
                          <li key={problem}>{problem}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className={styles.fieldGroup}>
                    <label className={styles.label} htmlFor="dater-structure-hook">
                      {STRUCTURE_LABELS.hook}
                    </label>
                    <p className={styles.fieldHint} id="dater-structure-hook-hint">
                      {STRUCTURE_HINTS.hook}
                    </p>
                    <input
                      id="dater-structure-hook"
                      className={styles.input}
                      type="text"
                      required
                      aria-describedby="dater-structure-hook-hint"
                      maxLength={DATER_PITCH_FIELD_LIMITS.hook}
                      value={editStructure.hook}
                      onChange={(event) => updateStructureField('hook', event.target.value)}
                    />
                  </div>

                  <div className={styles.fieldGroup}>
                    <label className={styles.label} htmlFor="dater-structure-relationship">
                      {STRUCTURE_LABELS.relationship_context}
                    </label>
                    <p className={styles.fieldHint} id="dater-structure-relationship-hint">
                      {STRUCTURE_HINTS.relationship_context}
                    </p>
                    <textarea
                      id="dater-structure-relationship"
                      className={styles.textarea}
                      required
                      rows={3}
                      aria-describedby="dater-structure-relationship-hint"
                      maxLength={DATER_PITCH_FIELD_LIMITS.relationshipContext}
                      value={editStructure.relationship_context}
                      onChange={(event) =>
                        updateStructureField('relationship_context', event.target.value)
                      }
                    />
                  </div>

                  <fieldset className={styles.qualityFields}>
                    <legend className={styles.label}>
                      {STRUCTURE_LABELS.three_specific_qualities}
                    </legend>
                    <p className={styles.fieldHint}>{STRUCTURE_HINTS.three_specific_qualities}</p>
                    {editStructure.three_specific_qualities.map((quality, index) => (
                      <div className={styles.fieldGroup} key={`quality-${index}`}>
                        <label
                          className={styles.label}
                          htmlFor={`dater-structure-quality-${index}`}
                        >
                          Thing {index + 1}
                        </label>
                        <input
                          id={`dater-structure-quality-${index}`}
                          className={styles.input}
                          type="text"
                          required
                          maxLength={DATER_PITCH_FIELD_LIMITS.quality}
                          value={quality}
                          onChange={(event) => updateQuality(index, event.target.value)}
                        />
                      </div>
                    ))}
                  </fieldset>

                  <div className={styles.fieldGroup}>
                    <label className={styles.label} htmlFor="dater-structure-anecdote">
                      {STRUCTURE_LABELS.evidence_or_anecdote}
                    </label>
                    <p className={styles.fieldHint} id="dater-structure-anecdote-hint">
                      {STRUCTURE_HINTS.evidence_or_anecdote}
                    </p>
                    <textarea
                      id="dater-structure-anecdote"
                      className={styles.textarea}
                      required
                      rows={4}
                      aria-describedby="dater-structure-anecdote-hint"
                      maxLength={DATER_PITCH_FIELD_LIMITS.evidenceOrAnecdote}
                      value={editStructure.evidence_or_anecdote}
                      onChange={(event) =>
                        updateStructureField('evidence_or_anecdote', event.target.value)
                      }
                    />
                  </div>

                  <div className={styles.fieldGroup}>
                    <label className={styles.label} htmlFor="dater-structure-good-match">
                      {STRUCTURE_LABELS.good_match_for}
                    </label>
                    <p className={styles.fieldHint} id="dater-structure-good-match-hint">
                      {STRUCTURE_HINTS.good_match_for}
                    </p>
                    <textarea
                      id="dater-structure-good-match"
                      className={styles.textarea}
                      required
                      rows={3}
                      aria-describedby="dater-structure-good-match-hint"
                      maxLength={DATER_PITCH_FIELD_LIMITS.goodMatchFor}
                      value={editStructure.good_match_for}
                      onChange={(event) =>
                        updateStructureField('good_match_for', event.target.value)
                      }
                    />
                  </div>
                </div>
              )}

              {state.photos.length > 0 && (
                <div className={styles.photoBlock}>
                  <h3 className={styles.photoHeading}>Photos on your page</h3>
                  <div className={styles.photoGrid}>
                    {state.photos.map((photo, index) => {
                      const included = includedAssetIds.includes(photo.assetId);
                      return (
                        <button
                          key={photo.assetId}
                          type="button"
                          className={`${styles.photoToggle} ${included ? '' : styles.photoExcluded}`}
                          aria-pressed={included}
                          aria-label={
                            included
                              ? `Exclude suggested photo ${index + 1}`
                              : `Include suggested photo ${index + 1}`
                          }
                          onClick={() => {
                            setEditStatus(null);
                            setEditError(null);
                            setIncludedAssetIds((current) =>
                              included
                                ? current.filter((id) => id !== photo.assetId)
                                : [...current, photo.assetId],
                            );
                          }}
                        >
                          <img
                            className={styles.photo}
                            src={photo.url}
                            alt={`Suggested photo ${index + 1}`}
                          />
                          <span className={styles.photoState}>
                            {included ? 'Included' : 'Excluded'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className={styles.muted}>Choose which photos this review version includes.</p>
                </div>
              )}

              <label className={styles.uploadLabel} htmlFor="dater-photo-upload">
                {uploadingPhoto ? 'Uploading & validating…' : 'Upload my photo'}
              </label>
              <input
                id="dater-photo-upload"
                className={styles.fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploadingPhoto || savingEdits || daterAiConsent !== 'granted'}
                onChange={(event) => {
                  void handlePhotoUpload(event);
                }}
              />

              {includedAssetIds.length === 0 && (
                <p className={styles.muted} role="status">
                  Your page needs at least one photo — keep one to publish.
                </p>
              )}

              {/* The look switcher. Deliberately inside this step rather than a
                  step of its own: it is the same act as choosing a photo, and it
                  goes out with the same save. Switching rebuilds the motion, so
                  it counts as an unsaved edit and the approve button waits. */}
              <fieldset className={styles.preferenceBlock} data-consent-template={template}>
                <legend className={styles.label}>The look of your page</legend>
                <p className={styles.fieldHint}>
                  Your words, your photos and your friend’s recording don’t change — only how the
                  page moves and how it’s coloured. Save to see it.
                </p>
                <div className={styles.choiceRow}>
                  {PITCH_SCENE_TEMPLATES.map((option) => (
                    <label className={styles.choice} key={option}>
                      <input
                        type="radio"
                        name="pitch-template"
                        value={option}
                        checked={template === option}
                        onChange={() => {
                          setTemplate(option);
                          setEditStatus(null);
                          setEditError(null);
                        }}
                      />
                      <span>{TEMPLATE_LABELS[option]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {editStatus !== null && (
                <p className={styles.status} role="status">
                  {editStatus}
                </p>
              )}
              {editError !== null && (
                <p className={styles.error} role="status">
                  {editError}
                </p>
              )}
              <button
                className={styles.secondary}
                type="button"
                disabled={!editsDirty || savingEdits || uploadingPhoto}
                onClick={() => {
                  void handleSaveEdits();
                }}
              >
                {savingEdits ? 'Saving edits…' : 'Save my edits'}
              </button>
            </section>

            <section
              className={styles.stepSection}
              id="consent-step-about"
              data-consent-step="about"
              aria-labelledby="consent-step-about-heading"
            >
              <p className={styles.stepMarker}>
                Step {reviewStepNumber('about')} of {reviewStepCount}
              </p>
              <fieldset className={styles.preferenceBlock}>
                <legend
                  id="consent-step-about-heading"
                  className={`${styles.sectionHeading} ${styles.stepHeading}`}
                  data-step-heading
                  tabIndex={-1}
                >
                  About you
                </legend>
                <p className={styles.muted}>
                  Confirm a few details about yourself. Your date of birth stays private — only your
                  age appears on your page.
                </p>

                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="dater-birth-date">
                    Date of birth
                  </label>
                  <input
                    id="dater-birth-date"
                    className={styles.input}
                    type="date"
                    value={birthDate}
                    onChange={(event) => {
                      setBirthDate(event.target.value);
                      setProfileError(null);
                    }}
                  />
                </div>

                <div className={styles.ageGrid}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label} htmlFor="dater-region">
                      Region
                    </label>
                    <input
                      id="dater-region"
                      className={styles.input}
                      type="text"
                      maxLength={80}
                      placeholder="e.g. Puget Sound"
                      value={region}
                      onChange={(event) => {
                        setRegion(event.target.value);
                        setProfileError(null);
                      }}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label} htmlFor="dater-city">
                      City (optional)
                    </label>
                    <input
                      id="dater-city"
                      className={styles.input}
                      type="text"
                      maxLength={80}
                      placeholder="e.g. Seattle"
                      value={city}
                      onChange={(event) => {
                        setCity(event.target.value);
                        setProfileError(null);
                      }}
                    />
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="dater-own-intent">
                    What you’re looking for
                  </label>
                  <select
                    id="dater-own-intent"
                    className={styles.input}
                    value={ownIntent}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (
                        value === '' ||
                        value === 'long-term' ||
                        value === 'open-to-either' ||
                        value === 'short-term'
                      ) {
                        setOwnIntent(value);
                        setProfileError(null);
                      }
                    }}
                  >
                    <option value="">Choose one…</option>
                    {DATING_INTENTS.map((intent) => (
                      <option key={intent.value} value={intent.value}>
                        {intent.label}
                      </option>
                    ))}
                  </select>
                </div>

                {profileError !== null && (
                  <p className={styles.error} role="status">
                    {profileError}
                  </p>
                )}
              </fieldset>
            </section>

            <section
              className={styles.stepSection}
              id="consent-step-reach"
              data-consent-step="reach"
              aria-labelledby="consent-step-reach-heading"
            >
              <p className={styles.stepMarker}>
                Step {reviewStepNumber('reach')} of {reviewStepCount}
              </p>
              <fieldset className={styles.preferenceBlock}>
                <legend
                  id="consent-step-reach-heading"
                  className={`${styles.sectionHeading} ${styles.stepHeading}`}
                  data-step-heading
                  tabIndex={-1}
                >
                  Who can reach out &amp; for how long
                </legend>
                <p className={styles.muted}>
                  Your page is public — anyone with the link can watch it. These settings only
                  decide who is allowed to send you interest and how precisely your location shows.
                </p>

                <div className={styles.fieldGroup}>
                  <span className={styles.label}>Public duration</span>
                  <div className={styles.choiceRow}>
                    {PUBLISH_DAY_OPTIONS.map((days) => (
                      <label className={styles.choice} key={days}>
                        <input
                          type="radio"
                          name="publish-days"
                          value={days}
                          checked={publishDays === days}
                          onChange={() => setPublishDays(days)}
                        />
                        <span>{days} days</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="location-precision">
                    Location visibility
                  </label>
                  <select
                    id="location-precision"
                    className={styles.input}
                    value={locationPrecision}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === 'city' || value === 'region' || value === 'hidden') {
                        setLocationPrecision(value);
                      }
                    }}
                  >
                    <option value="city">City</option>
                    <option value="region">Region only</option>
                    <option value="hidden">Hidden</option>
                  </select>
                </div>

                <div className={styles.ageGrid}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label} htmlFor="audience-min-age">
                      Minimum age
                    </label>
                    <input
                      id="audience-min-age"
                      className={styles.input}
                      type="number"
                      min={18}
                      step={1}
                      inputMode="numeric"
                      value={minimumAge}
                      onChange={(event) => {
                        setMinimumAge(event.target.value);
                        setPreferenceError(null);
                      }}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label} htmlFor="audience-max-age">
                      Maximum age (optional)
                    </label>
                    <input
                      id="audience-max-age"
                      className={styles.input}
                      type="number"
                      min={18}
                      step={1}
                      inputMode="numeric"
                      value={maximumAge}
                      onChange={(event) => {
                        setMaximumAge(event.target.value);
                        setPreferenceError(null);
                      }}
                    />
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <span className={styles.label}>
                    Only accept interest from these intents (optional)
                  </span>
                  <div className={styles.checkboxList}>
                    {DATING_INTENTS.map((intent) => (
                      <label className={styles.choice} key={intent.value}>
                        <input
                          type="checkbox"
                          checked={selectedIntents.includes(intent.value)}
                          onChange={(event) =>
                            setSelectedIntents((current) =>
                              event.target.checked
                                ? [...current, intent.value]
                                : current.filter((value) => value !== intent.value),
                            )
                          }
                        />
                        <span>{intent.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {(preferenceError ?? currentAudienceError) !== null && (
                  <p className={styles.error} role="status">
                    {preferenceError ?? currentAudienceError}
                  </p>
                )}
              </fieldset>
            </section>

            {showClaims && (
              <section
                className={`${styles.claimBlock} ${styles.stepSection}`}
                id="consent-step-claims"
                data-consent-step="claims"
                aria-labelledby="consent-step-claims-heading"
              >
                <p className={styles.stepMarker}>
                  Step {reviewStepNumber('claims')} of {reviewStepCount}
                </p>
                <h2
                  id="consent-step-claims-heading"
                  className={`${styles.photoHeading} ${styles.stepHeading}`}
                  data-step-heading
                  tabIndex={-1}
                >
                  {flaggedClaims.length === 0
                    ? 'Confirm your edits are accurate'
                    : 'Claims that need your decision'}
                </h2>
                {state.review.daterEdited && (
                  <p className={styles.muted}>
                    You rewrote part of this introduction — confirm the wording is truthful before
                    it goes live.
                  </p>
                )}
                {/* Fifth audit P0 (decision D2): the old screen listed the
                    flagged claims and made the Dater attest that ALL of them
                    were true — including a claim they had just deleted from
                    their page, possibly because it was false. Each claim now
                    gets its own answer, and only the kept ones are covered by
                    the confirmation below. Marking one "I took that out"
                    removes it from the published page when you save. */}
                {flaggedClaims.length > 0 && (
                  <>
                    <p className={styles.muted}>
                      Our AI flagged these as specific claims about you. For each one, say whether
                      it’s still true and staying on your page, or that you’ve taken it out.
                    </p>
                    <ul className={styles.claimList}>
                      {flaggedClaims.map((claim, index) => {
                        const removed = removedClaimIndexes.has(index);
                        const groupName = `hard-claim-${index}`;
                        return (
                          <li
                            className={removed ? styles.claimRemoved : undefined}
                            key={groupName}
                            data-hard-claim
                            data-hard-claim-removed={removed ? 'true' : 'false'}
                          >
                            <p className={styles.claimText}>{claim}</p>
                            <div className={styles.claimChoices} role="group" aria-label={claim}>
                              <label className={styles.claimChoice}>
                                <input
                                  type="radio"
                                  name={groupName}
                                  checked={!removed}
                                  onChange={() => setClaimRemoved(index, false)}
                                />
                                <span>Still true — keep it on my page</span>
                              </label>
                              <label className={styles.claimChoice}>
                                <input
                                  type="radio"
                                  name={groupName}
                                  checked={removed}
                                  onChange={() => setClaimRemoved(index, true)}
                                />
                                <span>I took that out of my page</span>
                              </label>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                {claimsDirty && (
                  <div className={styles.claimSaveRow}>
                    <p className={styles.muted} role="status">
                      {claimsToKeep.length === 0
                        ? 'Save to take every flagged claim off your page.'
                        : `Save to take ${flaggedClaims.length - claimsToKeep.length} of these off your page.`}
                    </p>
                    <button
                      className={styles.secondary}
                      type="button"
                      disabled={savingEdits || uploadingPhoto}
                      onClick={() => {
                        void handleSaveEdits();
                      }}
                    >
                      {savingEdits ? 'Saving…' : 'Save my choices'}
                    </button>
                  </div>
                )}
                <label className={styles.confirmationRow}>
                  <input
                    type="checkbox"
                    checked={hardClaimsConfirmed}
                    onChange={(event) => setHardClaimsConfirmed(event.target.checked)}
                  />
                  <span>
                    {claimsToKeep.length === 0
                      ? 'I confirm the introduction on my page is truthful and accurate.'
                      : claimsToKeep.length === flaggedClaims.length
                        ? 'I confirm the claims above are true.'
                        : 'I confirm the claims I kept are true.'}
                  </span>
                </label>
              </section>
            )}

            <section
              className={styles.stepSection}
              id="consent-step-approve"
              data-consent-step="approve"
              aria-labelledby="consent-step-approve-heading"
            >
              <p className={styles.stepMarker}>
                Step {reviewStepNumber('approve')} of {reviewStepCount}
              </p>
              <div className={styles.profileSummary}>
                <h2
                  id="consent-step-approve-heading"
                  className={`${styles.sectionHeading} ${styles.stepHeading}`}
                  data-step-heading
                  tabIndex={-1}
                >
                  This is your page — exactly what people will see
                </h2>
                <p className={styles.muted}>
                  {previewScene === null
                    ? `A still preview built from what you approved above. On the live page, ${state.preview.introducerDisplayName}’s voice plays over these photos.`
                    : `Press play: this is your page moving, on the exact timeline your published page will use. ${state.preview.introducerDisplayName}’s voice, your photos, your words.`}
                </p>
                <div className={styles.previewFrame}>
                  {previewScene !== null && previewIncludedPhotos.length > 0 ? (
                    <div className={styles.previewMotion} data-consent-motion-preview>
                      <MotionPitchPlayer
                        photos={previewIncludedPhotos.map((photo, index) => ({
                          assetId: photo.assetId,
                          src: photo.url,
                          alt: `Your photo ${index + 1}`,
                        }))}
                        scene={previewScene}
                        sceneWords={previewSceneWords}
                        sceneText={previewSceneText}
                        captions={previewCaptions}
                        audioUrl={state.voiceUrl}
                        fallbackDurationMs={previewScene.durationMs}
                        location={previewLocation}
                        playLabel={`Play ${state.preview.introducerDisplayName}’s pitch over your photos`}
                        pauseLabel="Pause the preview"
                        noAudioNote="The voice note isn’t ready to play here, so this preview can’t move yet — your published page still plays it."
                        // Signed storage URLs: the image optimizer only accepts
                        // allowlisted hosts, so it must not sit between the Dater
                        // and their own photo.
                        imageMode="plain"
                        header={
                          <header className={styles.previewMotionMeta}>
                            <span className={styles.previewName}>
                              {displayName}
                              {previewAge === null ? '' : `, ${previewAge}`}
                            </span>
                            <span className={styles.previewSub}>
                              {relationshipLine(state.preview)}
                            </span>
                          </header>
                        }
                      />
                    </div>
                  ) : representativePhoto === null ? (
                    <p className={styles.muted}>Keep at least one photo to preview your cover.</p>
                  ) : (
                    <div className={styles.previewCover}>
                      <img
                        className={styles.previewCoverImg}
                        src={representativePhoto.url}
                        alt="Your page cover"
                      />
                      <div className={styles.previewCoverMeta}>
                        <span className={styles.previewName}>
                          {displayName}
                          {previewAge === null ? '' : `, ${previewAge}`}
                        </span>
                        {previewLocation !== null && (
                          <span className={styles.previewSub}>{previewLocation}</span>
                        )}
                        <span className={styles.previewSub}>{relationshipLine(state.preview)}</span>
                      </div>
                    </div>
                  )}

                  {editsDirty && serverScene !== null && (
                    <p className={styles.muted} role="status" data-consent-motion-stale>
                      Save your edits to see your page move with the words, photos and look you just
                      chose.
                    </p>
                  )}

                  {previewHeadline.trim() !== '' && (
                    <p className={styles.previewHeadline}>{previewHeadline}</p>
                  )}

                  {previewIncludedPhotos.length > 1 && (
                    <div className={styles.previewThumbs}>
                      {previewIncludedPhotos.map((photo, index) => (
                        <div key={photo.assetId} className={styles.previewThumb}>
                          <img src={photo.url} alt={`Photo ${index + 1} in play order`} />
                          {index === 0 && <span className={styles.repTag}>Cover</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {editStructure === null ? (
                    editBody.trim() !== '' && <p className={styles.previewBody}>{editBody}</p>
                  ) : (
                    <div className={styles.previewStructure}>
                      <div>
                        <span className={styles.previewLabel}>
                          {STRUCTURE_LABELS.relationship_context}
                        </span>
                        <p className={styles.previewBody}>{editStructure.relationship_context}</p>
                      </div>
                      <div>
                        <span className={styles.previewLabel}>
                          {STRUCTURE_LABELS.three_specific_qualities}
                        </span>
                        <ul className={styles.previewList}>
                          {editStructure.three_specific_qualities.map((quality, index) => (
                            <li key={`preview-quality-${index}`}>{quality}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <span className={styles.previewLabel}>
                          {STRUCTURE_LABELS.evidence_or_anecdote}
                        </span>
                        <p className={styles.previewBody}>{editStructure.evidence_or_anecdote}</p>
                      </div>
                      <div>
                        <span className={styles.previewLabel}>
                          {STRUCTURE_LABELS.good_match_for}
                        </span>
                        <p className={styles.previewBody}>{editStructure.good_match_for}</p>
                      </div>
                    </div>
                  )}

                  <dl className={styles.summaryList}>
                    <div>
                      <dt>Looking for</dt>
                      <dd>{ownIntent === '' ? 'Choose above' : datingIntentLabel(ownIntent)}</dd>
                    </div>
                    <div>
                      <dt>Can reach out</dt>
                      <dd>{previewAudience}</dd>
                    </div>
                    <div>
                      <dt>Location shown</dt>
                      <dd>{previewLocation ?? 'Hidden'}</dd>
                    </div>
                    <div>
                      <dt>Public for</dt>
                      <dd>{publishDays} days</dd>
                    </div>
                    <div>
                      <dt>Voice</dt>
                      <dd>
                        {state.voiceUrl === null
                          ? 'Not ready to play here'
                          : 'Your friend’s original recording'}
                      </dd>
                    </div>
                  </dl>
                </div>
                <p className={styles.muted}>
                  Photos play in your friend’s original order — you choose which to include, not the
                  order. You control the words and photos here; the voice recording itself can’t be
                  trimmed, but you can request changes or decline below.
                </p>
              </div>

              <div className={styles.controlNote}>
                <span aria-hidden="true">✓</span>
                <p>
                  You stay in control: approving creates your page, and you can take it down
                  anytime. Not ready? Just close this tab — nothing publishes without you.
                </p>
              </div>

              {editsDirty && (
                <p className={styles.muted} role="status">
                  Save your edits before approving this page.
                </p>
              )}

              <button
                className={styles.primary}
                type="button"
                disabled={
                  responding ||
                  savingEdits ||
                  uploadingPhoto ||
                  editsDirty ||
                  currentAudienceError !== null ||
                  currentProfileError !== null ||
                  includedAssetIds.length === 0 ||
                  ((state.review.hardClaims.length > 0 || state.review.daterEdited) &&
                    !hardClaimsConfirmed)
                }
                onClick={handleApprove}
              >
                Approve &amp; publish my page
              </button>

              <div className={styles.responseActions}>
                <button
                  className={styles.secondary}
                  type="button"
                  disabled={responding}
                  aria-expanded={requestingChanges}
                  aria-controls="consent-change-request-form"
                  onClick={() => {
                    const nextRequestingChanges = !requestingChanges;
                    setRequestingChanges(nextRequestingChanges);
                    setResponseError(null);
                    if (nextRequestingChanges) {
                      window.requestAnimationFrame(() => responseNoteRef.current?.focus());
                    }
                  }}
                >
                  Request changes
                </button>
                <button
                  className={`${styles.secondary} ${styles.declineAction}`}
                  type="button"
                  disabled={responding}
                  onClick={() => {
                    void handleDecline();
                  }}
                >
                  Politely decline
                </button>
              </div>

              {requestingChanges && (
                <form
                  id="consent-change-request-form"
                  className={styles.responseForm}
                  onSubmit={handleRequestChanges}
                >
                  <label className={styles.label} htmlFor="consent-change-note">
                    What should your friend change?
                  </label>
                  <textarea
                    ref={responseNoteRef}
                    id="consent-change-note"
                    className={styles.textarea}
                    required
                    rows={4}
                    value={responseNote}
                    onChange={(event) => setResponseNote(event.target.value)}
                  />
                  <button className={styles.secondary} type="submit" disabled={responding}>
                    {responding ? 'Sending…' : 'Send change request'}
                  </button>
                </form>
              )}

              {responseError !== null && <p className={styles.error}>{responseError}</p>}
            </section>
          </section>
        )}

        {state.step === 'revision-stale' && (
          <section className={styles.card}>
            <span className={styles.badge}>New version ready</span>
            <h1 className={styles.title}>The introduction was updated.</h1>
            <p className={styles.lede}>Review the newest version before you decide.</p>
            <button
              className={styles.primary}
              type="button"
              onClick={() => window.location.reload()}
            >
              Reload the latest version
            </button>
          </section>
        )}

        {state.step === 'responded' && (
          <section className={styles.card}>
            <span className={styles.badge}>Response sent</span>
            <h1 className={styles.title}>
              {state.action === 'request_changes' ? 'Changes requested.' : 'Pitch declined.'}
            </h1>
            <p className={styles.muted}>
              {state.action === 'request_changes'
                ? 'Your friend can revise the pitch and send you a new version.'
                : 'The consent request is closed and the pitch will not be published.'}
            </p>
          </section>
        )}

        {state.step === 'error' && (
          <section className={styles.card}>
            <span className={styles.badgeDanger}>Hold up</span>
            <h1 className={styles.title}>We hit a snag.</h1>
            <p className={styles.muted}>{state.message}</p>
          </section>
        )}
      </div>
    </main>
  );
}
