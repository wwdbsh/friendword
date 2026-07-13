'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import {
  confirmDisplayName,
  ConsentRepo,
  DataLayerError,
  ensureUserRow,
  getDisplayNameStatus,
  signInWithOtp,
  trackEvent,
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
  const [hardClaimsConfirmed, setHardClaimsConfirmed] = useState(false);
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [responseNote, setResponseNote] = useState('');
  const [responding, setResponding] = useState(false);
  const [responseError, setResponseError] = useState<string | null>(null);
  const responseNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const claimStartedRef = useRef(false);

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
        setIncludedAssetIds(photoAssets.map((asset) => asset.id));
        setHardClaimsConfirmed(false);
        setRequestingChanges(false);
        setResponseNote('');
        setResponseError(null);
        const nameStatus = await getDisplayNameStatus(activeClient);
        if (nameStatus.confirmed) {
          setState({ step: 'review', preview, review, voiceUrl, photos });
        } else {
          setDisplayName(nameStatus.displayName);
          setState({ step: 'name-confirmation', preview, review, voiceUrl, photos });
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
    if (client === null || state.step !== 'review') {
      return;
    }

    const { preview, review } = state;
    setState({ step: 'publishing', preview });
    try {
      const repo = new ConsentRepo(client);
      const { campaignId, campaignSlug } = await repo.approveAndPublish({
        draftId: review.revision.pitch_draft_id,
        campaignDays: 14,
        revisionId: review.revision.id,
        includedAssetIds,
        hardClaimsConfirmed,
      });
      trackEvent(client, 'pitch_approved', { pitch_draft_id: review.revision.pitch_draft_id });
      trackEvent(client, 'campaign_published', { campaign_id: campaignId });
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
      trackEvent(client, 'draft_changes_requested', {
        pitch_draft_id: state.review.revision.pitch_draft_id,
      });
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

            {state.photos.length > 0 && (
              <div className={styles.photoBlock}>
                <h2 className={styles.photoHeading}>The photos they picked</h2>
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
                        onClick={() =>
                          setIncludedAssetIds((current) =>
                            included
                              ? current.filter((id) => id !== photo.assetId)
                              : [...current, photo.assetId],
                          )
                        }
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
                <p className={styles.muted}>
                  Choose which photos to include. Nothing is removed until you approve.
                </p>
                {includedAssetIds.length === 0 && (
                  <p className={styles.muted} role="status">
                    Your page needs at least one photo — keep one to publish.
                  </p>
                )}
              </div>
            )}

            <div className={styles.windowBlock}>
              <h2 className={styles.photoHeading}>Public for 14 days</h2>
              <p className={styles.muted}>Extension options are coming soon.</p>
            </div>

            <div className={styles.notes}>
              <h2>{state.review.revision.headline}</h2>
              <p>{state.review.revision.body}</p>
            </div>

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

            <div className={styles.controlNote}>
              <span aria-hidden="true">✓</span>
              <p>
                You stay in control: approving creates your page, and you can take it down anytime.
                Not ready? Just close this tab — nothing publishes without you.
              </p>
            </div>

            <button
              className={styles.primary}
              type="button"
              disabled={
                responding ||
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
