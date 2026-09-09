'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  BenefitsRepo,
  CreatorCreditRequiredError,
  DataLayerError,
  KitNotPublishedError,
  PitchDraftRepo,
  trackEvent,
  type BrowserSupabaseClient,
} from '@friendword/data';

import { EmailSignIn } from '@/components/EmailSignIn';
import { FlowNav } from '@/components/FlowNav';
import { SignedOutNotice } from '@/components/SignedOutNotice';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { useSession } from '@/lib/useSession';

import { PitchExportCard } from './PitchExportCard';

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
  | { readonly step: 'not-found' }
  | { readonly step: 'error' };

/**
 * M-10: is this "there is no such kit for you", or "the network dropped"?
 *
 * `PitchDraftRepo.getDraft` selects the draft with `.single()`, so PostgREST
 * answers PGRST116 ("0 rows") for BOTH a draft id that does not exist and one
 * that exists but the RLS policy hides from this caller. Neither is retryable
 * and both are the same sentence to the person reading — the kit is not
 * theirs. Every other failure (offline, 5xx, an expired token mid-flight) IS
 * retryable and keeps the "refresh" copy. Distinguishing them matters because
 * "refresh to try again" on a mistyped or foreign link is an instruction that
 * can never succeed.
 */
function isMissingDraft(error: unknown): boolean {
  const cause = error instanceof DataLayerError ? error.cause : error;

  return (
    typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'PGRST116'
  );
}

/**
 * Caption copy honesty (second audit CP-5/§11): the shared link is a full
 * public URL, and no caption claims identity verification — that gate is
 * not live yet.
 */
/** T005 §4 share tip, shown under the caption pack. */
const SHARE_TIP_COPY = 'Add a trending sound on TikTok/Reels when you upload.';

function captions(headline: string | null, slug: string | null): readonly string[] {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  // ?src=creator-kit ties public views back to the kit (H-4 attribution).
  const link = slug === null || origin === '' ? '' : ` ${origin}/p/${slug}?src=creator-kit`;
  const hook = headline ?? 'My friend, in my own words.';

  return [
    `${hook}${link}`,
    `I recorded a pitch about my favorite person. Listen before you swipe.${link}`,
    `A real friend's voice. No bios written at 1am.${link}`,
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
  const { session, loading, ended } = useSession(client);

  const [state, setState] = useState<KitState>({ step: 'loading' });
  const [unlocking, setUnlocking] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  // Kept outside KitState: the MP4 export card needs the campaign id in every
  // step (the free render is per-campaign, not gated on the paid share kit),
  // and the needs-credit transition would otherwise drop it.
  const [campaign, setCampaign] = useState<{
    readonly id: string;
    readonly slug: string | null;
  } | null>(null);

  const load = useCallback(async () => {
    if (client === null) {
      return;
    }
    try {
      const draft = await new PitchDraftRepo(client).getDraft(draftId);
      const { data: campaignRow } = await client
        .from('campaigns')
        .select('id, slug')
        .eq('pitch_draft_id', draftId)
        .maybeSingle();
      const slug = campaignRow?.slug ?? null;
      setCampaign(campaignRow ?? null);
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
    } catch (error: unknown) {
      setState({ step: isMissingDraft(error) ? 'not-found' : 'error' });
    }
  }, [client, draftId]);

  useEffect(() => {
    if (session === null) {
      // T008: the kit carries the campaign's headline, share card and captions.
      // It goes with the session rather than waiting in state for whoever signs
      // in next on this browser.
      setState({ step: 'loading' });
      setCampaign(null);
      return;
    }
    void load();
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
        {/* Account link off: the kit is the introducer's surface, and the
            account areas behind "My page" (interest received, interest sent,
            intro rooms, pages about you) are the dater's — offering them here
            invites the person who recorded the pitch into screens that are
            empty for them by definition. The published pitch is their real
            destination, so it is an explicit back link (the RoomView pattern)
            when we know the slug. */}
        <FlowNav
          tabs={false}
          {...(campaign?.slug === undefined || campaign.slug === null
            ? {}
            : { back: { href: `/p/${campaign.slug}`, label: 'The published pitch' } })}
        />

        {client === null && (
          <section className={styles.card}>
            <h1 className={styles.title}>Almost ready</h1>
            <p className={styles.muted}>This environment is missing its Supabase configuration.</p>
          </section>
        )}

        {client !== null && !loading && session === null && (
          <section className={styles.card}>
            <SignedOutNotice ended={ended} />
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

        {state.step === 'not-found' && (
          <section className={styles.card}>
            <span className={styles.badge}>Social launch kit</span>
            <h1 className={styles.title}>We can&rsquo;t find that kit.</h1>
            <p className={styles.muted}>
              This link doesn&rsquo;t point at a pitch on your account. Check that you opened it
              from the Friendword app, and that you&rsquo;re signed in with the email you recorded
              the pitch with.
            </p>
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
                    onClick={() => {
                      trackEvent(client, 'campaign_shared', {
                        campaign_slug: state.slug,
                        channel: 'kit_card_download',
                      });
                    }}
                  >
                    Download the share card
                  </a>
                </>
              )}
            </section>

            <section className={styles.card}>
              <h2 className={styles.subTitle}>Caption pack</h2>
              {captions(state.headline, state.slug).map((caption, index) => (
                <div key={caption} className={styles.captionRow}>
                  <p className={styles.muted} style={{ flex: 1 }}>
                    {caption}
                  </p>
                  <button
                    className={styles.secondary}
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(caption).then(() => setCopied(index));
                      trackEvent(client, 'campaign_shared', {
                        campaign_slug: state.slug,
                        channel: 'kit_caption_copy',
                      });
                    }}
                  >
                    {copied === index ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              ))}
              {/* T005 §4: the one distribution tip the kit can state without
                  claiming a result — adding a sound is something the poster
                  does on the platform, and our MP4 carries only approved
                  audio (plus the optional generated bed), so it never
                  conflicts with a trending track chosen at upload. */}
              <p className={styles.finePrint}>{SHARE_TIP_COPY}</p>
            </section>
          </>
        )}

        {/* MP4 export (Phase 4). Independent of the paid share-kit unlock —
            the campaign's first finished render is free — so it renders in
            every post-load step that has a campaign, including needs-credit. */}
        {client !== null &&
          session !== null &&
          campaign !== null &&
          (state.step === 'locked' ||
            state.step === 'unlocked' ||
            state.step === 'needs-credit') && (
            <PitchExportCard
              client={client}
              draftId={draftId}
              campaignId={campaign.id}
              campaignSlug={campaign.slug}
            />
          )}
      </div>
    </main>
  );
}
