'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import { DataLayerError, InterestRepo, type BrowserSupabaseClient } from '@friendword/data';

import { EmailSignIn } from '@/components/EmailSignIn';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { useSession } from '@/lib/useSession';

import styles from '@/styles/flowCard.module.css';

const DATING_INTENTS = [
  { value: 'long-term', label: 'Long-term' },
  { value: 'open-to-either', label: 'Open to either' },
  { value: 'short-term', label: 'Short-term' },
] as const;

type InterestFlowProps = {
  readonly campaignId: string;
  readonly campaignSlug: string;
  readonly daterName: string;
};

type UploadedPhoto = {
  readonly storagePath: string;
  readonly previewUrl: string;
};

function errorCopy(error: unknown): string {
  const cause = error instanceof DataLayerError ? error.cause : error;
  const detail =
    typeof cause === 'object' &&
    cause !== null &&
    'message' in cause &&
    typeof cause.message === 'string'
      ? cause.message
      : '';
  if (detail.includes('already answered')) {
    return 'This interest was already answered, so it cannot be resubmitted.';
  }
  if (detail.includes('own campaign')) {
    return 'This is your own page — interest is for people who want to meet you.';
  }
  if (detail.includes('not open for interest')) {
    return 'This campaign is not accepting interest right now.';
  }
  if (detail.includes('adult birth date')) {
    return 'Friendword is 18+. Add your real birth date to continue.';
  }
  if (detail.includes('complete your dating profile')) {
    return 'Finish your profile first: a bio, an intent, and at least 2 photos.';
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
  const [birthDate, setBirthDate] = useState('');
  const [intent, setIntent] = useState<string>('long-term');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<readonly UploadedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [prefillDone, setPrefillDone] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (client === null || session === null || prefillDone) {
      return;
    }

    let cancelled = false;
    const repo = new InterestRepo(client);
    void repo
      .getMyDatingProfile()
      .then(async (profile) => {
        if (cancelled || profile === null) {
          return;
        }
        setBio(profile.bio ?? '');
        setIntent(profile.dating_intent ?? 'long-term');
        setLocation(profile.approximate_location ?? '');
        const previews = await Promise.all(
          profile.photos.map((path) =>
            repo
              .createPhotoViewUrl(path)
              .then((url) => ({ storagePath: path, previewUrl: url }))
              .catch(() => null),
          ),
        );
        if (!cancelled) {
          setPhotos(previews.filter((photo): photo is UploadedPhoto => photo !== null));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setPrefillDone(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, session, prefillDone]);

  async function handlePhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    if (client === null || event.target.files === null) {
      return;
    }
    const files = Array.from(event.target.files);
    event.target.value = '';
    setUploading(true);
    setError(null);
    try {
      const repo = new InterestRepo(client);
      const uploaded: UploadedPhoto[] = [];
      for (const [index, file] of files.entries()) {
        const extension = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
        const safeExtension = /^[a-z0-9]{1,5}$/.test(extension) ? extension : 'jpg';
        const fileName = `photo-${Date.now()}-${index}.${safeExtension}`;
        const storagePath = await repo.uploadProfilePhoto(fileName, file);
        uploaded.push({ storagePath, previewUrl: URL.createObjectURL(file) });
      }
      setPhotos((current) => [...current, ...uploaded].slice(0, 6));
    } catch (uploadError: unknown) {
      setError(errorCopy(uploadError));
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (client === null) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const repo = new InterestRepo(client);
      await repo.saveDatingProfile({
        bio: bio.trim(),
        datingIntent: intent,
        approximateLocation: location.trim() === '' ? null : location.trim(),
        photos: photos.map((photo) => photo.storagePath),
        birthDate,
      });
      await repo.submitInterest(campaignId, note.trim() === '' ? null : note.trim());
      setSubmitted(true);
    } catch (submitError: unknown) {
      setError(errorCopy(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <p className={styles.wordmark}>Friendword</p>

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
            <span className={styles.badge}>Verified interest</span>
            <h1 className={styles.title}>Want to meet {daterName}?</h1>
            <EmailSignIn
              client={client}
              reason={`${daterName} only sees interest from verified, signed-in people — never anonymous taps.`}
            />
          </section>
        )}

        {client !== null && !loading && session !== null && submitted && (
          <section className={styles.card}>
            <span className={styles.badgeFresh}>Sent!</span>
            <h1 className={styles.title}>Your interest is with {daterName}.</h1>
            <p className={styles.lede}>
              {daterName} will review your profile and decide. If they accept, a private intro room
              opens for the two of you — your email and phone number stay hidden either way.
            </p>
            <Link className={styles.secondary} href={`/p/${campaignSlug}`}>
              Back to the pitch
            </Link>
          </section>
        )}

        {client !== null && !loading && session !== null && !submitted && (
          <section className={styles.card}>
            <span className={styles.badge}>Verified interest</span>
            <h1 className={styles.title}>Introduce yourself to {daterName}.</h1>
            <p className={styles.muted}>
              {daterName} sees this profile before deciding. Contact details are never shared.
            </p>

            <form className={styles.form} onSubmit={handleSubmit}>
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
                  <img
                    key={photo.storagePath}
                    className={styles.photo}
                    src={photo.previewUrl}
                    alt={`Your photo ${index + 1}`}
                  />
                ))}
              </div>
              <input
                aria-label="Add photos"
                type="file"
                accept="image/*"
                multiple
                disabled={uploading}
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
