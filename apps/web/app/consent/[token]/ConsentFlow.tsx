'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

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
} from '@friendword/data';

import { EmailSignIn } from '@/components/EmailSignIn';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { requestDaterPitchModeration } from '@/lib/moderateText';

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

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
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
        setEditStatus(null);
        setEditError(null);
        setHardClaimsConfirmed(false);
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
    const headline = editHeadline.trim();
    const body = editBody.trim();
    if (headline.length === 0 || body.length === 0) {
      setEditError('Headline and introduction are required.');
      return;
    }
    if (headline.length > 120 || body.length > 2000) {
      setEditError('Keep the headline under 120 characters and the introduction under 2,000.');
      return;
    }

    // Text edits run an external AI safety review before the revision is cut, so
    // the moderation verdict exists for the DB gate and flagged copy never gets
    // frozen. Photo-only changes carry no new text and skip this.
    const textChanged =
      headline !== state.review.revision.headline || body !== state.review.revision.body;
    if (textChanged && daterAiConsent !== 'granted') {
      setEditError(DATER_AI_CONSENT_REQUIRED_COPY);
      return;
    }

    setSavingEdits(true);
    setEditError(null);
    setEditStatus(null);
    try {
      const repo = new ConsentRepo(client);
      if (textChanged) {
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (sessionError !== null || accessToken === undefined) {
          throw new Error('text moderation requires a session');
        }
        const outcome = await requestDaterPitchModeration(
          state.review.revision.pitch_draft_id,
          headline,
          body,
          accessToken,
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
      await repo.createDaterRevision({
        draftId: state.review.revision.pitch_draft_id,
        headline,
        body,
        includedAssetIds: revisionAssetIds(state.review, includedAssetIds),
      });
      const latestReview = await repo.getConsentReview(state.review.revision.pitch_draft_id);
      const context = await loadReviewContext(repo, state.preview, latestReview);
      setState({ step: 'review', ...context });
      setIncludedAssetIds(context.photos.map((photo) => photo.assetId));
      setEditHeadline(latestReview.revision.headline);
      setEditBody(latestReview.revision.body);
      setHardClaimsConfirmed(false);
      setEditStatus('Your edits are saved in a new review version.');
    } catch (error: unknown) {
      if (!(error instanceof Error)) {
        throw error;
      }
      const detail = claimErrorDetail(error);
      setEditError(
        detail.includes('too long')
          ? 'Keep the headline under 120 characters and the introduction under 2,000.'
          : 'We could not save your edits. Please try again.',
      );
    } finally {
      setSavingEdits(false);
    }
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
  const editsDirty =
    state.step === 'review' &&
    (editHeadline !== state.review.revision.headline ||
      editBody !== state.review.revision.body ||
      !sameIds(includedAssetIds, currentRevisionPhotoIds));
  const currentAudienceError = audienceError(minimumAge, maximumAge);
  const currentProfileError = daterProfileError(birthDate, region, ownIntent);

  // CP-1 real output preview: the exact snapshot the public page will show,
  // built from the approval revision plus the dater's confirmed inputs.
  const reviewPhotos = state.step === 'review' ? state.photos : [];
  const previewIncludedPhotos = reviewPhotos.filter((photo) =>
    includedAssetIds.includes(photo.assetId),
  );
  const representativePhoto = previewIncludedPhotos[0] ?? null;
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

              <div className={styles.editFields}>
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
                  {state.review.daterEdited && state.review.hardClaims.length === 0
                    ? 'Confirm your edits are accurate'
                    : 'Claims that need your confirmation'}
                </h2>
                {state.review.daterEdited && (
                  <p className={styles.muted}>
                    You rewrote part of this introduction — confirm the wording is truthful before
                    it goes live.
                  </p>
                )}
                {state.review.hardClaims.length > 0 && (
                  <ul className={styles.claimList}>
                    {state.review.hardClaims.map((claim) => (
                      <li key={claim}>{claim}</li>
                    ))}
                  </ul>
                )}
                <label className={styles.confirmationRow}>
                  <input
                    type="checkbox"
                    checked={hardClaimsConfirmed}
                    onChange={(event) => setHardClaimsConfirmed(event.target.checked)}
                  />
                  <span>
                    {state.review.daterEdited && state.review.hardClaims.length === 0
                      ? 'I confirm the introduction I edited is truthful and accurate.'
                      : 'I confirm all of these claims are true.'}
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
                  A still preview built from what you approved above. On the live page,{' '}
                  {state.preview.introducerDisplayName}’s voice plays over these photos.
                </p>
                <div className={styles.previewFrame}>
                  {representativePhoto === null ? (
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

                  {editHeadline.trim() !== '' && (
                    <p className={styles.previewHeadline}>{editHeadline}</p>
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

                  {editBody.trim() !== '' && <p className={styles.previewBody}>{editBody}</p>}

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
