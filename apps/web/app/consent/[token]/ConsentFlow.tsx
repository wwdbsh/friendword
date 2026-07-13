'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import {
  confirmDisplayName,
  ConsentRepo,
  DataLayerError,
  ensureUserRow,
  getDisplayNameStatus,
  signInWithOtp,
  type BrowserSupabaseClient,
  type ConsentPreview,
  type ConsentReview,
} from '@friendword/data';

import { getSupabaseBrowserClient } from '@/lib/supabaseClient';

import styles from './page.module.css';

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
  | { readonly step: 'link-sent'; readonly preview: ConsentPreview; readonly email: string }
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

function locationSummary(locationPrecision: LocationPrecision): string {
  if (locationPrecision === 'hidden') {
    return 'Location hidden';
  }
  return locationPrecision === 'region' ? 'Region-level location' : 'City-level location';
}

export function ConsentFlow({ token }: { readonly token: string }) {
  const router = useRouter();
  const clientRef = useRef<BrowserSupabaseClient | null | undefined>(undefined);
  if (clientRef.current === undefined) {
    clientRef.current = getSupabaseBrowserClient();
  }
  const client = clientRef.current;

  const [state, setState] = useState<FlowState>({ step: 'loading' });
  const [email, setEmail] = useState('');
  const [sendingLink, setSendingLink] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [confirmingName, setConfirmingName] = useState(false);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [includedAssetIds, setIncludedAssetIds] = useState<readonly string[]>([]);
  const [editHeadline, setEditHeadline] = useState('');
  const [editBody, setEditBody] = useState('');
  const [savingEdits, setSavingEdits] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [editStatus, setEditStatus] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [publishDays, setPublishDays] = useState<PublishDays>(14);
  const [locationPrecision, setLocationPrecision] = useState<LocationPrecision>('city');
  const [minimumAge, setMinimumAge] = useState('18');
  const [maximumAge, setMaximumAge] = useState('');
  const [selectedIntents, setSelectedIntents] = useState<readonly DatingIntent[]>([]);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [hardClaimsConfirmed, setHardClaimsConfirmed] = useState(false);
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [responseNote, setResponseNote] = useState('');
  const [responding, setResponding] = useState(false);
  const [responseError, setResponseError] = useState<string | null>(null);
  const responseNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const claimStartedRef = useRef(false);
  const approvalStartedRef = useRef(false);

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
        setIncludedAssetIds(context.photos.map((photo) => photo.assetId));
        setEditHeadline(review.revision.headline);
        setEditBody(review.revision.body);
        setEditStatus(null);
        setEditError(null);
        setHardClaimsConfirmed(false);
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

  async function handleSendLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (client === null || (state.step !== 'signin' && state.step !== 'link-sent')) {
      return;
    }

    setSendingLink(true);
    try {
      await signInWithOtp(client, email, { emailRedirectTo: window.location.href });
      setState({ step: 'link-sent', preview: state.preview, email });
    } catch {
      setState({
        step: 'error',
        message: 'We could not send the sign-in link. Check the email address and try again.',
      });
    } finally {
      setSendingLink(false);
    }
  }

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
    approvalStartedRef.current = true;
    setState({ step: 'publishing', preview });
    try {
      const repo = new ConsentRepo(client);
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

    setSavingEdits(true);
    setEditError(null);
    setEditStatus(null);
    try {
      const repo = new ConsentRepo(client);
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
      setEmail('');
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

        {(state.step === 'signin' ||
          state.step === 'link-sent' ||
          state.step === 'claiming' ||
          state.step === 'publishing') && (
          <section className={styles.card} aria-live="polite">
            <span className={styles.badge}>{relationshipLine(state.preview)}</span>
            <h1 className={styles.title}>
              {state.preview.introducerDisplayName} recorded a pitch about you.
            </h1>
            <p className={styles.lede}>
              Nothing goes public until you hear it and say yes. First, confirm it’s really you.
            </p>

            {state.step === 'signin' && (
              <form className={styles.form} onSubmit={handleSendLink}>
                <label className={styles.label} htmlFor="consent-email">
                  Your email
                </label>
                <input
                  id="consent-email"
                  className={styles.input}
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <button className={styles.primary} type="submit" disabled={sendingLink}>
                  {sendingLink ? 'Sending…' : 'Email me a sign-in link'}
                </button>
                <p className={styles.finePrint}>
                  No password, no signup forms — the link brings you right back here.
                </p>
              </form>
            )}

            {state.step === 'link-sent' && (
              <div className={styles.linkSent}>
                <p className={styles.lede}>
                  Check <strong>{state.email}</strong> — your sign-in link is on the way. Open it on
                  this device to continue.
                </p>
                <form onSubmit={handleSendLink}>
                  <button className={styles.secondary} type="submit" disabled={sendingLink}>
                    {sendingLink ? 'Sending…' : 'Resend the link'}
                  </button>
                </form>
              </div>
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

            <div className={styles.editBlock}>
              <h2 className={styles.sectionHeading}>Make it yours</h2>
              <p className={styles.muted}>
                Edit every word and choose every photo before you approve.
              </p>

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
                disabled={uploadingPhoto || savingEdits}
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
            </div>

            <fieldset className={styles.preferenceBlock}>
              <legend className={styles.sectionHeading}>Who can see this &amp; for how long</legend>

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
                <span className={styles.label}>Dating intents (optional)</span>
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

            {state.review.hardClaims.length > 0 && (
              <div className={styles.claimBlock}>
                <h2 className={styles.photoHeading}>Claims that need your confirmation</h2>
                <ul className={styles.claimList}>
                  {state.review.hardClaims.map((claim) => (
                    <li key={claim}>{claim}</li>
                  ))}
                </ul>
                <label className={styles.confirmationRow}>
                  <input
                    type="checkbox"
                    checked={hardClaimsConfirmed}
                    onChange={(event) => setHardClaimsConfirmed(event.target.checked)}
                  />
                  <span>I confirm all of these claims are true.</span>
                </label>
              </div>
            )}

            <div className={styles.profileSummary}>
              <h2 className={styles.sectionHeading}>This is how your page will look</h2>
              <dl className={styles.summaryList}>
                <div>
                  <dt>Display name</dt>
                  <dd>{displayName}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>{locationSummary(locationPrecision)}</dd>
                </div>
                <div>
                  <dt>Public duration</dt>
                  <dd>{publishDays} days</dd>
                </div>
                <div>
                  <dt>Included photos</dt>
                  <dd>{includedAssetIds.length}</dd>
                </div>
              </dl>
            </div>

            <div className={styles.controlNote}>
              <span aria-hidden="true">✓</span>
              <p>
                You stay in control: approving creates your page, and you can take it down anytime.
                Not ready? Just close this tab — nothing publishes without you.
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
                includedAssetIds.length === 0 ||
                (state.review.hardClaims.length > 0 && !hardClaimsConfirmed)
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
