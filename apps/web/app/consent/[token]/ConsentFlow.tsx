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
  type PitchDraftRow,
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

type FlowState =
  | { readonly step: 'loading' }
  | { readonly step: 'setup-missing' }
  | { readonly step: 'invalid' }
  | { readonly step: 'closed'; readonly preview: ConsentPreview }
  | { readonly step: 'signin'; readonly preview: ConsentPreview }
  | { readonly step: 'link-sent'; readonly preview: ConsentPreview; readonly email: string }
  | { readonly step: 'claiming'; readonly preview: ConsentPreview }
  | {
      readonly step: 'name-confirmation';
      readonly preview: ConsentPreview;
      readonly draft: PitchDraftRow;
      readonly voiceUrl: string | null;
      readonly photos: readonly { readonly assetId: string; readonly url: string }[];
    }
  | {
      readonly step: 'review';
      readonly preview: ConsentPreview;
      readonly draft: PitchDraftRow;
      readonly voiceUrl: string | null;
      readonly photos: readonly { readonly assetId: string; readonly url: string }[];
    }
  | { readonly step: 'publishing'; readonly preview: ConsentPreview }
  | { readonly step: 'error'; readonly message: string };

function claimErrorMessage(error: unknown): string {
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
  const [displayName, setDisplayName] = useState('');
  const [confirmingName, setConfirmingName] = useState(false);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [excludedIds, setExcludedIds] = useState<readonly string[]>([]);
  const [campaignDays, setCampaignDays] = useState<7 | 30 | 90>(30);
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
        trackEvent(activeClient, 'dater_verified', { pitch_draft_id: pitchDraftId });
        const draft = await repo.getDraftForReview(pitchDraftId);
        const voiceUrl = await repo.createVoicePlaybackUrl(pitchDraftId).catch(() => null);
        const assets = await repo.listAssets(pitchDraftId).catch(() => []);
        const photos = (
          await Promise.all(
            assets
              .filter((asset) => asset.asset_type === 'photo')
              .map((asset) =>
                repo
                  .createAssetViewUrl(asset.storage_path)
                  .then((url) => ({ assetId: asset.id, url }))
                  .catch(() => null),
              ),
          )
        ).filter((photo): photo is { assetId: string; url: string } => photo !== null);
        const nameStatus = await getDisplayNameStatus(activeClient);
        if (nameStatus.confirmed) {
          setState({ step: 'review', preview, draft, voiceUrl, photos });
        } else {
          setDisplayName(nameStatus.displayName);
          setState({ step: 'name-confirmation', preview, draft, voiceUrl, photos });
        }
      } catch (error: unknown) {
        if (!(error instanceof Error)) {
          throw error;
        }
        claimStartedRef.current = false;
        setState({ step: 'error', message: claimErrorMessage(error) });
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

    const { preview, draft } = state;
    setState({ step: 'publishing', preview });
    try {
      const repo = new ConsentRepo(client);
      for (const assetId of excludedIds) {
        await repo.excludeAsset(assetId);
      }
      const { campaignId, campaignSlug } = await repo.approveAndPublish(draft.id, campaignDays);
      trackEvent(client, 'pitch_approved', { pitch_draft_id: draft.id });
      trackEvent(client, 'campaign_published', { campaign_id: campaignId });
      router.push(`/p/${campaignSlug}`);
    } catch (error: unknown) {
      if (!(error instanceof Error)) {
        throw error;
      }
      setState({ step: 'error', message: claimErrorMessage(error) });
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
                    const excluded = excludedIds.includes(photo.assetId);
                    return (
                      <button
                        key={photo.assetId}
                        type="button"
                        className={`${styles.photoToggle} ${excluded ? styles.photoExcluded : ''}`}
                        aria-pressed={excluded}
                        aria-label={
                          excluded
                            ? `Keep suggested photo ${index + 1}`
                            : `Remove suggested photo ${index + 1}`
                        }
                        onClick={() =>
                          setExcludedIds((current) =>
                            excluded
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
                          {excluded ? 'Removed' : 'Keeping'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className={styles.finePrint}>
                  Tap a photo to remove it — only what you keep goes live.
                </p>
              </div>
            )}

            <div className={styles.windowBlock}>
              <h2 className={styles.photoHeading}>How long should your page stay up?</h2>
              <div className={styles.chipRow} role="radiogroup" aria-label="Visibility window">
                {([7, 30, 90] as const).map((days) => (
                  <button
                    key={days}
                    type="button"
                    role="radio"
                    aria-checked={campaignDays === days}
                    className={`${styles.chip} ${campaignDays === days ? styles.chipActive : ''}`}
                    onClick={() => setCampaignDays(days)}
                  >
                    {days} days
                  </button>
                ))}
              </div>
            </div>

            {(state.draft.headline !== null || state.draft.body !== null) && (
              <div className={styles.notes}>
                {state.draft.headline !== null && <h2>{state.draft.headline}</h2>}
                {state.draft.body !== null && <p>{state.draft.body}</p>}
              </div>
            )}

            <div className={styles.controlNote}>
              <span aria-hidden="true">✓</span>
              <p>
                You stay in control: approving creates your page, and you can take it down anytime.
                Not ready? Just close this tab — nothing publishes without you.
              </p>
            </div>

            <button className={styles.primary} type="button" onClick={handleApprove}>
              Approve &amp; publish my page
            </button>
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
