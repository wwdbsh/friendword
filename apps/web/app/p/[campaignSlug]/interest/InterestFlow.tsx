'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import {
  confirmDisplayName,
  DataLayerError,
  ensureUserRow,
  getDisplayNameStatus,
  InterestIntentRepo,
  InterestRepo,
  trackEvent,
  type BrowserSupabaseClient,
} from '@friendword/data';

import {
  AI_CONSENT_REQUIRED_COPY,
  AI_DISCLOSURE_COPY,
  canProcessOwnContentMedia,
  getAiDisclosureRevision,
  recordOwnContentAiConsent,
  type OwnContentConsentState,
} from '@/lib/aiConsent';
import { EmailSignIn } from '@/components/EmailSignIn';
import { FlowNav } from '@/components/FlowNav';
import { requestTextModeration } from '@/lib/moderateText';
import { removeOwnProfilePhotos } from '@/lib/profileMedia';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { useSession } from '@/lib/useSession';

import styles from '@/styles/flowCard.module.css';

const DATING_INTENTS = [
  { value: 'long-term', label: 'Long-term' },
  { value: 'open-to-either', label: 'Open to either' },
  { value: 'short-term', label: 'Short-term' },
] as const;

const MAX_PROFILE_PHOTOS = 6;

type InterestFlowProps = {
  readonly campaignId: string;
  readonly campaignSlug: string;
  readonly daterName: string;
};

type UploadedPhoto = {
  readonly storagePath: string;
  readonly previewUrl: string;
  /**
   * True only for objects uploaded during THIS session. Removing such a photo
   * deletes its storage object immediately (it is not yet referenced by a saved
   * profile). Prefilled photos (false) are still referenced by the saved
   * dating_profiles.photos, so they are unreferenced by re-submitting and swept
   * later by orphan cleanup — deleting them on Remove would break the saved
   * profile if the user never submits.
   */
  readonly uploadedThisSession: boolean;
};

/**
 * Interest is staged (viral-loop slice, decision D2):
 *  - S1 `offer`/`saved`: the visitor saves a private interest intent with a
 *    signed-in account only. Nothing reaches the Dater, and no free text is
 *    collected at this stage.
 *  - S2 `profile`: completing the dating profile promotes the intent through
 *    `promote_interest_intent`, a normal `interests` INSERT behind every
 *    existing gate. Only then is the interest delivered.
 * A promotion rejected by the private-beta gate is shown as "not open yet",
 * never as a failure — the intent stays saved.
 */
type IntentStage = 'checking' | 'offer' | 'saved' | 'profile';

function errorDetail(error: unknown): string {
  const cause = error instanceof DataLayerError ? error.cause : error;
  return typeof cause === 'object' &&
    cause !== null &&
    'message' in cause &&
    typeof cause.message === 'string'
    ? cause.message
    : '';
}

function isPrivateBetaRejection(error: unknown): boolean {
  return errorDetail(error).includes('private beta');
}

function errorCopy(error: unknown): string {
  const detail = errorDetail(error);
  if (detail.includes('already answered')) {
    return 'This interest was already answered, so it cannot be resubmitted.';
  }
  if (detail.includes('own campaign')) {
    return 'This is your own page — interest is for people who want to meet you.';
  }
  if (detail.includes('not open for interest')) {
    return 'This campaign is not accepting interest right now.';
  }
  if (detail.includes('private beta')) {
    return 'Friendword is in a private beta. Expressing interest is not open yet — check back later.';
  }
  if (detail.includes('adult birth date')) {
    return 'Friendword is 18+. Add your real birth date to continue.';
  }
  if (detail.includes('complete your dating profile')) {
    return 'Finish your profile first: a bio, an intent, and at least 2 photos.';
  }
  if (detail.includes('rate limit')) {
    return 'That is a lot of saved interest in a short window. Give it an hour and try again.';
  }
  return 'Something went wrong on our side. Try again in a moment.';
}

export function InterestFlow({ campaignId, campaignSlug, daterName }: InterestFlowProps) {
  const clientRef = useRef<BrowserSupabaseClient | null | undefined>(undefined);
  if (clientRef.current === undefined) {
    clientRef.current = getSupabaseBrowserClient();
  }
  const client = clientRef.current;
  const { session, loading } = useSession(client);

  const [bio, setBio] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [displayNameConfirmed, setDisplayNameConfirmed] = useState(false);
  const [displayNameLoaded, setDisplayNameLoaded] = useState(false);
  const [birthDate, setBirthDate] = useState('');
  const [intent, setIntent] = useState<string>('long-term');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<readonly UploadedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [prefillDone, setPrefillDone] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [intentStage, setIntentStage] = useState<IntentStage>('checking');
  const [intentBusy, setIntentBusy] = useState(false);
  const [betaClosed, setBetaClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // own_content AI consent gate (P0-NEW-2): affirmative, current-revision
  // consent must precede the first upload/moderation (external AI) request.
  const [aiConsentState, setAiConsentState] = useState<OwnContentConsentState>('pending');
  const [aiDisclosureRevision, setAiDisclosureRevision] = useState<string | null>(null);
  const [aiConsentChecked, setAiConsentChecked] = useState(false);
  const [aiConsentBusy, setAiConsentBusy] = useState(false);
  const aiConsentGranted = canProcessOwnContentMedia(aiConsentState);

  // Stage S1: is there already a saved intent for this campaign? A lookup
  // failure (including the intent RPCs not being deployed yet) falls back to
  // the offer stage — saving will then surface its own honest error.
  //
  // The run-once guard is a ref, NOT state: a state guard listed in the deps
  // and set synchronously inside the effect re-fires the effect, whose cleanup
  // cancels the in-flight lookup — the page then sticks on 'checking' forever.
  const intentCheckStartedRef = useRef(false);
  useEffect(() => {
    if (client === null || session === null || intentCheckStartedRef.current) {
      return;
    }
    intentCheckStartedRef.current = true;

    trackEvent(client, 'interest_started', {
      campaign_id: campaignId,
      source: window.sessionStorage.getItem('fw_attribution'),
    });

    let cancelled = false;
    void (async () => {
      await ensureUserRow(client);
      const intent = await new InterestIntentRepo(client).getMyIntent(campaignId);
      if (!cancelled) {
        setIntentStage(intent === null ? 'offer' : 'saved');
      }
    })().catch(() => {
      if (!cancelled) {
        setIntentStage('offer');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [client, session, campaignId]);

  // Stage S2: the profile form loads only after the visitor chooses to
  // complete their profile — S1 must stay a single fast step.
  useEffect(() => {
    if (client === null || session === null || intentStage !== 'profile' || prefillDone) {
      return;
    }

    let cancelled = false;
    const repo = new InterestRepo(client);
    void (async () => {
      const nameStatus = await getDisplayNameStatus(client);
      if (cancelled) {
        return;
      }
      setDisplayName(nameStatus.displayName);
      setDisplayNameConfirmed(nameStatus.confirmed);

      const revision = await getAiDisclosureRevision(client);
      if (cancelled) {
        return;
      }
      setAiDisclosureRevision(revision);

      const profile = await repo.getMyDatingProfile();
      if (cancelled) {
        return;
      }
      setDisplayNameLoaded(true);
      if (profile !== null) {
        setBio(profile.bio ?? '');
        setIntent(profile.dating_intent ?? 'long-term');
        setLocation(profile.approximate_location ?? '');
        const previews = await Promise.all(
          profile.photos.map((path) =>
            repo
              .createPhotoViewUrl(path)
              .then((url) => ({ storagePath: path, previewUrl: url, uploadedThisSession: false }))
              .catch(() => null),
          ),
        );
        if (cancelled) {
          return;
        }
        setPhotos(previews.filter((photo): photo is UploadedPhoto => photo !== null));
      }
    })()
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? 'We could not load your profile. Refresh the page to try again.'
              : 'We could not read the profile response. Refresh the page to try again.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPrefillDone(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, session, intentStage, prefillDone]);

  async function handleSaveIntent() {
    if (client === null) {
      return;
    }
    setIntentBusy(true);
    setError(null);
    try {
      await ensureUserRow(client);
      // S1 takes no free text: the intent RPC receives only the campaign id.
      // The RPC is idempotent, so a re-tap on a stored intent is success.
      await new InterestIntentRepo(client).saveIntent(campaignId);
      trackEvent(client, 's1_intent_created', { campaign_id: campaignId });
      setIntentStage('saved');
    } catch (saveError: unknown) {
      setError(errorCopy(saveError));
    } finally {
      setIntentBusy(false);
    }
  }

  async function handleAiConsent() {
    if (client === null || aiDisclosureRevision === null || !aiConsentChecked) {
      return;
    }
    setAiConsentBusy(true);
    setError(null);
    try {
      // Recorded BEFORE any photo upload or text moderation — the first
      // external-AI request cannot happen until this resolves.
      await recordOwnContentAiConsent(client, aiDisclosureRevision);
      setAiConsentState('granted');
    } catch {
      setError('We could not save your agreement. Refresh and try again before continuing.');
    } finally {
      setAiConsentBusy(false);
    }
  }

  async function handlePhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    if (client === null || event.target.files === null) {
      return;
    }
    // Guard: no external-AI processing (validate call) before consent.
    if (!aiConsentGranted) {
      event.target.value = '';
      setError(AI_CONSENT_REQUIRED_COPY);
      return;
    }
    const files = Array.from(event.target.files);
    event.target.value = '';
    const remainingSlots = MAX_PROFILE_PHOTOS - photos.length;
    if (files.length === 0) {
      return;
    }
    if (remainingSlots <= 0 || files.length > remainingSlots) {
      setError(`You can keep up to ${MAX_PROFILE_PHOTOS} photos. Remove one before adding more.`);
      return;
    }

    setUploading(true);
    setError(null);
    const uploadedStoragePaths: string[] = [];
    const previewUrls: string[] = [];
    let uploadFailureMessage = 'Those photos could not be uploaded. Please try again.';
    try {
      const repo = new InterestRepo(client);
      const { data: sessionData } = await client.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? '';
      const uploaded: UploadedPhoto[] = [];
      for (const [index, file] of files.entries()) {
        const extension = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
        const safeExtension = /^[a-z0-9]{1,5}$/.test(extension) ? extension : 'jpg';
        const fileName = `photo-${Date.now()}-${index}.${safeExtension}`;
        const storagePath = await repo.uploadProfilePhoto(fileName, file);
        uploadedStoragePaths.push(storagePath);
        // Server-authoritative validation: the API re-reads the object,
        // sniffs the real content, and records the verdict for the
        // submit_interest evidence gate. A failed verdict blocks this photo.
        const response = await fetch('/api/media/validate', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            bucket: 'profile-media',
            objectName: storagePath.replace(/^profile-media\//, ''),
          }),
        });
        const verdict: unknown = await response.json().catch(() => null);
        const verdictOk =
          response.ok &&
          typeof verdict === 'object' &&
          verdict !== null &&
          'ok' in verdict &&
          verdict.ok === true;
        if (!verdictOk && response.status !== 501) {
          uploadFailureMessage =
            'That photo could not be verified as a supported image. Try another one.';
          throw new Error('profile photo validation failed');
        }
        const previewUrl = URL.createObjectURL(file);
        previewUrls.push(previewUrl);
        uploaded.push({ storagePath, previewUrl, uploadedThisSession: true });
      }
      setPhotos((current) => [...current, ...uploaded]);
    } catch (uploadError: unknown) {
      const ownerUserId = session?.user.id ?? '';
      const rollback = await removeOwnProfilePhotos(client, uploadedStoragePaths, ownerUserId);
      // The user flow is never blocked by a cleanup failure; a residual object
      // is caught by the orphan-media sweep. But a persistent failure means the
      // 0037 DELETE policy or storage is wrong, so it is logged loudly.
      if (rollback.failed > 0) {
        console.warn(
          `interest rollback: removed ${rollback.removed}/${rollback.attempted} uploaded photo(s); ${rollback.failed} left for orphan cleanup`,
        );
      }
      for (const previewUrl of previewUrls) {
        URL.revokeObjectURL(previewUrl);
      }
      setError(uploadError instanceof Error ? uploadFailureMessage : errorCopy(uploadError));
    } finally {
      setUploading(false);
    }
  }

  async function handleRemovePhoto(target: UploadedPhoto) {
    if (client === null) {
      return;
    }
    // Only objects uploaded this session are deleted here (they are not yet
    // referenced by a saved profile). Prefilled photos are dropped from local
    // state only — re-submitting unreferences them and orphan cleanup sweeps
    // them; deleting a still-referenced object would break the saved profile.
    if (target.uploadedThisSession) {
      const ownerUserId = session?.user.id ?? '';
      const outcome = await removeOwnProfilePhotos(client, [target.storagePath], ownerUserId);
      if (outcome.removed === 0) {
        // Surface, do not silently hide: keep the photo so Remove is retryable.
        setError('We could not remove that photo. Try again in a moment.');
        return;
      }
    }
    if (target.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(target.previewUrl);
    }
    setPhotos((current) =>
      current.filter((candidate) => candidate.storagePath !== target.storagePath),
    );
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (client === null) {
      return;
    }
    // Guard: bio/note moderation is external AI — never before consent.
    if (!aiConsentGranted) {
      setError(AI_CONSENT_REQUIRED_COPY);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const repo = new InterestRepo(client);
      if (!displayNameConfirmed) {
        await confirmDisplayName(client, displayName);
        setDisplayNameConfirmed(true);
      }
      await repo.saveDatingProfile({
        bio: bio.trim(),
        datingIntent: intent,
        approximateLocation: location.trim() === '' ? null : location.trim(),
        photos: photos.map((photo) => photo.storagePath),
        birthDate,
      });
      // Text moderation (Slice 2): 'flagged' blocks honestly here;
      // 'unavailable' defers to the DB gate, which fails closed while
      // media_validation_enforcement is on.
      const { data: sessionData } = await client.auth.getSession();
      const moderationToken = sessionData.session?.access_token ?? '';
      const trimmedNote = note.trim();
      const bioVerdict = await requestTextModeration('profile_bio', bio.trim(), moderationToken);
      const noteVerdict = await requestTextModeration(
        'interest_note',
        trimmedNote,
        moderationToken,
      );
      if (bioVerdict === 'flagged' || noteVerdict === 'flagged') {
        setError(
          bioVerdict === 'flagged'
            ? 'Your bio did not pass moderation. Edit the wording and try again.'
            : 'Your note did not pass moderation. Edit the wording and try again.',
        );
        return;
      }
      // S2 promotion: the intent becomes a real `interests` row behind every
      // existing delivery gate. This is the moment the interest is delivered.
      await new InterestIntentRepo(client).promoteIntent(
        campaignId,
        trimmedNote === '' ? null : trimmedNote,
      );
      setSubmitted(true);
    } catch (submitError: unknown) {
      // The private-beta gate is a scheduled state, not a failure: the intent
      // and profile stay saved, and delivery is honestly "not open yet".
      if (isPrivateBetaRejection(submitError)) {
        setBetaClosed(true);
        return;
      }
      // Rethrowing here would reject this handler's promise, which React never
      // consumes: the failure would become an unhandled rejection and the form
      // would go silent with the button simply re-enabled. Every failure shape
      // is reported to the user; non-Error throws are logged so the original
      // value is not lost.
      if (!(submitError instanceof Error)) {
        console.error('interest submit failed with a non-Error value', submitError);
      }
      setError(errorCopy(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        {/* Tabs stay off while the profile-and-consent steps are in progress —
            losing them mid-flow costs the visitor the whole form. The wordmark
            is still a way out (WUI-6). */}
        <FlowNav tabs={false} />

        {client === null && (
          <section className={styles.card}>
            <h1 className={styles.title}>Almost ready</h1>
            <p className={styles.muted}>This environment is missing its Supabase configuration.</p>
          </section>
        )}

        {client !== null && loading && (
          <section className={styles.card} aria-live="polite">
            <h1 className={styles.title}>One second…</h1>
          </section>
        )}

        {client !== null && !loading && session === null && (
          <section className={styles.card}>
            {/* TODO(identity-provider): Restore verified-interest copy after verification ships. */}
            <span className={styles.badge}>Profile-backed interest</span>
            <h1 className={styles.title}>Want to meet {daterName}?</h1>
            <EmailSignIn
              client={client}
              reason={`${daterName} only reviews interest from signed-in people who complete a dating profile — never anonymous taps.`}
            />
          </section>
        )}

        {client !== null && !loading && session !== null && submitted && (
          <section className={styles.card}>
            <span className={styles.badgeFresh}>Sent!</span>
            <h1 className={styles.title}>Your interest is with {daterName}.</h1>
            <p className={styles.lede}>
              What happens next is up to {daterName} — a reply is not promised, and there is no
              timeline. If they accept, a private intro room opens for the two of you — your email
              and phone number stay hidden either way.
            </p>
            {/* T004: the room this sentence names is a real screen — link it
                instead of leaving the sender to guess the URL. */}
            <div className={styles.actionRow}>
              <Link className={styles.secondary} href={`/p/${campaignSlug}`}>
                Back to the pitch
              </Link>
              <Link className={styles.secondary} href="/rooms">
                My intro rooms
              </Link>
            </div>
          </section>
        )}

        {client !== null && !loading && session !== null && !submitted && betaClosed && (
          <section className={styles.card}>
            <span className={styles.badge}>Private beta</span>
            <h1 className={styles.title}>Not open yet — your interest is saved.</h1>
            <p className={styles.lede}>
              Friendword is in a private beta, so delivering interest is not open yet. Nothing has
              been sent to {daterName}. Your interest and profile are saved — nothing is sent
              automatically, so if Friendword opens up, come back here to send them yourself.
            </p>
            <Link className={styles.secondary} href={`/p/${campaignSlug}`}>
              Back to the pitch
            </Link>
          </section>
        )}

        {client !== null &&
          !loading &&
          session !== null &&
          !submitted &&
          !betaClosed &&
          intentStage === 'checking' && (
            <section className={styles.card} aria-live="polite">
              <h1 className={styles.title}>One second…</h1>
            </section>
          )}

        {client !== null &&
          !loading &&
          session !== null &&
          !submitted &&
          !betaClosed &&
          intentStage === 'offer' && (
            <section className={styles.card}>
              <span className={styles.badge}>Step 1 of 2</span>
              <h1 className={styles.title}>Want to meet {daterName}?</h1>
              <p className={styles.muted}>
                Save your interest first. It stays private — nothing reaches {daterName} unless you
                go on to complete a dating profile with 2 current photos, a short bio, and what
                you&apos;re looking for, and then send it.
              </p>
              <button
                className={styles.primary}
                type="button"
                disabled={intentBusy}
                onClick={() => {
                  void handleSaveIntent();
                }}
              >
                {intentBusy ? 'Saving…' : 'Save my interest'}
              </button>
              {error !== null && <p className={styles.error}>{error}</p>}
            </section>
          )}

        {client !== null &&
          !loading &&
          session !== null &&
          !submitted &&
          !betaClosed &&
          intentStage === 'saved' && (
            <section className={styles.card}>
              <span className={styles.badgeFresh}>Saved</span>
              <h1 className={styles.title}>Saved — not delivered to {daterName} yet.</h1>
              <p className={styles.lede}>
                Your interest is saved privately. Complete your profile — 2 current photos, a short
                bio, and your dating intent — to send it. What {daterName} does with it is their
                call; sending promises nothing, not even a reply.
              </p>
              <button
                className={styles.primary}
                type="button"
                onClick={() => setIntentStage('profile')}
              >
                Complete my profile
              </button>
              <Link className={styles.secondary} href={`/p/${campaignSlug}`}>
                Back to the pitch
              </Link>
            </section>
          )}

        {client !== null &&
          !loading &&
          session !== null &&
          !submitted &&
          !betaClosed &&
          intentStage === 'profile' &&
          !prefillDone && (
            <section className={styles.card} aria-live="polite">
              <h1 className={styles.title}>Loading your profile…</h1>
            </section>
          )}

        {client !== null &&
          !loading &&
          session !== null &&
          !submitted &&
          !betaClosed &&
          intentStage === 'profile' &&
          prefillDone &&
          !displayNameLoaded && (
            <section className={styles.card}>
              <h1 className={styles.title}>We couldn’t load your profile.</h1>
              <p className={styles.muted}>Refresh the page to try again before sending interest.</p>
            </section>
          )}

        {client !== null &&
          !loading &&
          session !== null &&
          !submitted &&
          !betaClosed &&
          intentStage === 'profile' &&
          prefillDone &&
          displayNameLoaded &&
          !aiConsentGranted && (
            <section className={styles.card}>
              <span className={styles.badge}>Before you continue</span>
              <h1 className={styles.title}>A quick safety review</h1>
              <p className={styles.muted}>{AI_DISCLOSURE_COPY.replace('{daterName}', daterName)}</p>
              {aiDisclosureRevision !== null && (
                <p className={styles.finePrint}>Disclosure version {aiDisclosureRevision}</p>
              )}
              <label className={styles.confirmationRow}>
                <input
                  type="checkbox"
                  checked={aiConsentChecked}
                  disabled={aiConsentBusy || aiDisclosureRevision === null}
                  onChange={(event) => setAiConsentChecked(event.target.checked)}
                />
                <span>
                  I agree that my photos and note are sent to an external AI provider for a safety
                  review.
                </span>
              </label>
              {aiDisclosureRevision === null && (
                <p className={styles.finePrint}>
                  The safety review is unavailable right now. Refresh the page to try again.
                </p>
              )}
              <button
                className={styles.primary}
                type="button"
                disabled={!aiConsentChecked || aiConsentBusy || aiDisclosureRevision === null}
                onClick={() => {
                  void handleAiConsent();
                }}
              >
                {aiConsentBusy ? 'Saving…' : 'Agree and continue'}
              </button>
              {error !== null && <p className={styles.error}>{error}</p>}
            </section>
          )}

        {client !== null &&
          !loading &&
          session !== null &&
          !submitted &&
          !betaClosed &&
          intentStage === 'profile' &&
          prefillDone &&
          displayNameLoaded &&
          aiConsentGranted && (
            <section className={styles.card}>
              <span className={styles.badge}>Step 2 of 2 — deliver it</span>
              <h1 className={styles.title}>Introduce yourself to {daterName}.</h1>
              <p className={styles.muted}>
                {daterName} sees this profile before deciding. Contact details are never shared.
              </p>

              <form className={styles.form} onSubmit={handleSubmit}>
                {!displayNameConfirmed && (
                  <>
                    <label className={styles.label} htmlFor="interest-display-name">
                      Your name
                    </label>
                    <input
                      id="interest-display-name"
                      className={styles.input}
                      type="text"
                      required
                      autoComplete="name"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                    <p className={styles.muted}>
                      Confirm how your name should appear before sending your profile.
                    </p>
                  </>
                )}

                <label className={styles.label} htmlFor="interest-bio">
                  Short bio
                </label>
                <textarea
                  id="interest-bio"
                  className={styles.textarea}
                  required
                  minLength={10}
                  placeholder="Museum lover, weekend cyclist, serious about pasta."
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                />

                <label className={styles.label} htmlFor="interest-birth-date">
                  Birth date (18+)
                </label>
                <input
                  id="interest-birth-date"
                  className={styles.input}
                  type="date"
                  required
                  value={birthDate}
                  onChange={(event) => setBirthDate(event.target.value)}
                />

                <span className={styles.label}>Looking for</span>
                <div className={styles.chipRow} role="radiogroup" aria-label="Dating intent">
                  {DATING_INTENTS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={intent === option.value}
                      className={`${styles.chip} ${intent === option.value ? styles.chipActive : ''}`}
                      onClick={() => setIntent(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <label className={styles.label} htmlFor="interest-location">
                  City or area (optional)
                </label>
                <input
                  id="interest-location"
                  className={styles.input}
                  type="text"
                  placeholder="Brooklyn, New York"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                />

                <span className={styles.label}>Current photos (at least 2)</span>
                <div className={styles.photoGrid}>
                  {photos.map((photo, index) => (
                    <figure key={photo.storagePath} style={{ margin: 0 }}>
                      <img
                        className={styles.photo}
                        src={photo.previewUrl}
                        alt={`Your photo ${index + 1}`}
                      />
                      <button
                        className={styles.quietAction}
                        type="button"
                        disabled={uploading || submitting}
                        onClick={() => {
                          void handleRemovePhoto(photo);
                        }}
                      >
                        Remove photo {index + 1}
                      </button>
                    </figure>
                  ))}
                </div>
                <input
                  aria-label="Add photos"
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={uploading || photos.length >= MAX_PROFILE_PHOTOS}
                  onChange={(event) => {
                    void handlePhotoUpload(event);
                  }}
                />
                {uploading && <p className={styles.muted}>Uploading…</p>}

                <label className={styles.label} htmlFor="interest-note">
                  A note for {daterName} (optional)
                </label>
                <textarea
                  id="interest-note"
                  className={styles.textarea}
                  placeholder="We keep almost meeting at the same shows…"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />

                <button
                  className={styles.primary}
                  type="submit"
                  disabled={submitting || uploading || photos.length < 2}
                >
                  {submitting ? 'Sending…' : `Send interest to ${daterName}`}
                </button>
                {photos.length < 2 && (
                  <p className={styles.finePrint}>Add at least 2 current photos to send.</p>
                )}
                {error !== null && <p className={styles.error}>{error}</p>}
              </form>
            </section>
          )}
      </div>
    </main>
  );
}
