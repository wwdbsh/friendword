'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  BenefitsRepo,
  CreatorCreditRequiredError,
  KitNotPublishedError,
  PitchDraftRepo,
  type BrowserSupabaseClient,
} from '@friendword/data';

import { EmailSignIn } from '@/components/EmailSignIn';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { useSession } from '@/lib/useSession';

import styles from '@/styles/flowCard.module.css';

type KitState =
  | { readonly step: 'loading' }
  | { readonly step: 'locked'; readonly headline: string | null; readonly slug: string | null }
  | {
      readonly step: 'unlocked';
      readonly headline: string | null;
      readonly slug: string | null;
      readonly imageUrl: string | null;
    }
  | { readonly step: 'needs-credit' }
  | { readonly step: 'not-published' }
  | { readonly step: 'error' };

function captions(headline: string | null, slug: string | null): readonly string[] {
  const link = slug === null ? '' : ` friendword — /p/${slug}`;
  const hook = headline ?? 'My friend, in my own words.';

  return [
    `${hook}${link}`,
    `I recorded a pitch about my favorite person. Listen before you swipe.${link}`,
    `Friend-verified. Voice-first. No bios written at 1am.${link}`,
  ];
}

/**
 * Creator Launch share kit (Slice F): the unlock consumed exactly one
 * credit server-side; this page renders the benefit — a 9:16 share card
 * plus a caption pack for Instagram/TikTok stories.
 */
export function KitView({ draftId }: { readonly draftId: string }) {
  const clientRef = useRef<BrowserSupabaseClient | null | undefined>(undefined);
  if (clientRef.current === undefined) {
    clientRef.current = getSupabaseBrowserClient();
  }
  const client = clientRef.current;
  const { session, loading } = useSession(client);

  const [state, setState] = useState<KitState>({ step: 'loading' });
  const [unlocking, setUnlocking] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (client === null) {
      return;
    }
    try {
      const draft = await new PitchDraftRepo(client).getDraft(draftId);
      const { data: campaign } = await client
        .from('campaigns')
        .select('slug')
        .eq('pitch_draft_id', draftId)
        .maybeSingle();
      const slug = campaign?.slug ?? null;
      const { data: kit } = await client
        .from('share_kits')
        .select('id')
        .eq('pitch_draft_id', draftId)
        .maybeSingle();

      if (kit === null) {
        setState({ step: 'locked', headline: draft.headline ?? null, slug });
        return;
      }

      const { data: sessionData } = await client.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? '';
      const response = await fetch(`/api/kit-image?draftId=${draftId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const imageUrl = response.ok ? URL.createObjectURL(await response.blob()) : null;
      setState({ step: 'unlocked', headline: draft.headline ?? null, slug, imageUrl });
    } catch {
      setState({ step: 'error' });
    }
  }, [client, draftId]);

  useEffect(() => {
    if (session !== null) {
      void load();
    }
  }, [session, load]);

  async function unlock() {
    if (client === null) {
      return;
    }
    setUnlocking(true);
    try {
      await new BenefitsRepo(client).unlockShareKit(draftId);
      await load();
    } catch (error: unknown) {
      if (error instanceof CreatorCreditRequiredError) {
        setState({ step: 'needs-credit' });
      } else if (error instanceof KitNotPublishedError) {
        setState({ step: 'not-published' });
      } else {
        setState({ step: 'error' });
      }
    } finally {
      setUnlocking(false);
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

        {client !== null && !loading && session === null && (
          <section className={styles.card}>
            <span className={styles.badge}>Social launch kit</span>
            <h1 className={styles.title}>Sign in to open your kit.</h1>
            <EmailSignIn client={client} reason="Use the email you pitch your friends with." />
          </section>
        )}

        {client !== null && session !== null && state.step === 'loading' && (
          <section className={styles.card} aria-live="polite">
            <h1 className={styles.title}>Opening your launch kit…</h1>
          </section>
        )}

        {state.step === 'error' && (
          <section className={styles.card}>
            <span className={styles.badgeDanger}>Hold up</span>
            <h1 className={styles.title}>We hit a snag.</h1>
            <p className={styles.muted}>The kit could not load. Refresh to try again.</p>
          </section>
        )}

        {state.step === 'not-published' && (
          <section className={styles.card}>
            <h1 className={styles.title}>Almost — your friend goes first.</h1>
            <p className={styles.muted}>
              The launch kit uses only approved content, so it unlocks after your friend approves
              and publishes the pitch.
            </p>
          </section>
        )}

        {state.step === 'needs-credit' && (
          <section className={styles.card}>
            <span className={styles.badge}>Creator Launch</span>
            <h1 className={styles.title}>Unlock the launch kit.</h1>
            <p className={styles.muted}>
              The kit needs a Creator Launch purchase ($4.99, one per pitch). Buy it in the
              Friendword app on this pitch&apos;s share screen, then come back here.
            </p>
          </section>
        )}

        {state.step === 'locked' && (
          <section className={styles.card}>
            <span className={styles.badge}>Social launch kit</span>
            <h1 className={styles.title}>Turn the pitch into a launch.</h1>
            <p className={styles.muted}>
              A 9:16 share card built from the approved pitch plus a caption pack for stories.
              Unlocking uses your Creator Launch credit for this pitch — once, permanently.
            </p>
            <button
              className={styles.primary}
              type="button"
              disabled={unlocking}
              onClick={() => {
                void unlock();
              }}
            >
              {unlocking ? 'Unlocking…' : 'Unlock with my credit'}
            </button>
          </section>
        )}

        {state.step === 'unlocked' && (
          <>
            <section className={styles.card}>
              <span className={styles.badgeFresh}>Unlocked</span>
              <h1 className={styles.title}>Your launch kit.</h1>
              {state.imageUrl === null ? (
                <p className={styles.muted}>
                  The share card could not render right now — refresh to retry. Your unlock is
                  saved.
                </p>
              ) : (
                <>
                  <img
                    className={styles.photo}
                    src={state.imageUrl}
                    alt="9:16 share card preview"
                    style={{ maxWidth: '270px', width: '100%', height: 'auto' }}
                  />
                  <a
                    className={styles.secondary}
                    href={state.imageUrl}
                    download="friendword-launch-card.png"
                  >
                    Download the share card
                  </a>
                </>
              )}
            </section>

            <section className={styles.card}>
              <h2 className={styles.subTitle}>Caption pack</h2>
              {captions(state.headline, state.slug).map((caption, index) => (
                <div key={caption} className={styles.actionRow}>
                  <p className={styles.muted} style={{ flex: 1 }}>
                    {caption}
                  </p>
                  <button
                    className={styles.secondary}
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(caption).then(() => setCopied(index));
                    }}
                  >
                    {copied === index ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
