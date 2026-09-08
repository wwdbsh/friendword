import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalPage, legalStyles as styles } from '@/legal/LegalPage';

/*
 * PRIVACY POLICY — DRAFT (App Store submission blocker B1).
 *
 * Every factual claim below is traceable to something in this repository:
 * docs/PRIVACY_DATA_MAP.md (the authoritative collect/retain/delete table),
 * docs/DATA_MODEL.md, docs/ANALYTICS_PLAN.md, docs/OPS.md, docs/THREAT_MODEL.md
 * and the migrations they cite. Nothing here describes a control that is not
 * actually implemented — in particular there is no claim of identity
 * verification, background checks, or breach-notification commitments, because
 * none of those exist yet.
 *
 * OPEN ITEMS FOR THE OWNER AND FOR LEGAL REVIEW. None of these can be answered
 * from the codebase; each is marked in place below as well.
 *
 *   [TO CONFIRM: legal entity name, registered address, and the controller of
 *     record. docs/APP_STORE_SUBMISSION.md D3 flags the same gap.]
 *   [TO CONFIRM: public support email. The repo has none —
 *     docs/APP_STORE_SUBMISSION.md D1b. Referenced from /support.]
 *   [TO CONFIRM: GDPR/UK legal bases per processing purpose, EU/UK
 *     representative, and the international transfer mechanism (SCCs) for
 *     Supabase, OpenAI, Resend and Vercel. docs/PRIVACY_DATA_MAP.md:3 records
 *     this as undecided.]
 *   [TO CONFIRM: CCPA/CPRA notice at collection, "Do Not Sell or Share"
 *     handling, and authorized-agent process.]
 *   [TO CONFIRM: a data access/portability (DSAR) channel and its response
 *     time. Only deletion is self-service today; nothing else exists.]
 *   [TO CONFIRM: retention periods for everything docs/PRIVACY_DATA_MAP.md
 *     lines 79-96 still mark 확정 필요 — account records, dates of birth, invite
 *     contact hashes, pitch assets, interests, messages, safety records,
 *     purchase records and analytics. Only the five windows stated on this page
 *     are actually implemented.]
 *   [TO CONFIRM: Resend's own retention of send metadata
 *     (docs/PRIVACY_DATA_MAP.md:24) before we describe it here.]
 *   [TO CONFIRM: breach-notification policy. docs/THREAT_MODEL.md covers abuse
 *     threats only, not security incident response, so this page makes no
 *     notification promise.]
 *   [TO CONFIRM: App Store privacy manifest / Play Data Safety answers,
 *     including whether dating_intent is declared as sensitive info.]
 */

export const metadata: Metadata = {
  title: 'Privacy Policy — Friendword',
  description:
    'What Friendword collects, why, who it goes to, how long it is kept, and how to delete it.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      current="/privacy"
      eyebrow="Privacy"
      title="What we hold, and what we do with it"
      lede="Friendword handles a friend’s voice, someone’s face, and a decision about who may contact them. This page says exactly what is collected, who else sees it, how long it stays, and how to remove it."
    >
      <nav className={styles.toc} aria-label="On this page">
        <ol>
          <li>
            <a href="#short">The short version</a>
          </li>
          <li>
            <a href="#collect">What we collect, and why</a>
          </li>
          <li>
            <a href="#ai">AI processing, and the consent it needs</a>
          </li>
          <li>
            <a href="#share">Who else receives it</a>
          </li>
          <li>
            <a href="#keep">How long we keep it</a>
          </li>
          <li>
            <a href="#delete">Deleting your account</a>
          </li>
          <li>
            <a href="#choices">Your controls</a>
          </li>
          <li>
            <a href="#limits">What we do not claim</a>
          </li>
          <li>
            <a href="#contact">Contact and changes</a>
          </li>
        </ol>
      </nav>

      <section className={styles.section} id="short">
        <h2>The short version</h2>
        <ul>
          <li>
            Nothing about you becomes public until you approve it, item by item — the words, each
            photo, who may reach out, and for how long.
          </li>
          <li>
            Your email address lives in our authentication system only. We never copy it into the
            product tables, and sign-in is a one-time emailed code — there is no password and no
            social login.
          </li>
          <li>
            Nothing is sent to an external AI provider unless you separately agree to it on the
            screen that asks. Uploading a recording or a photo reaches our own storage and stops
            there.
          </li>
          <li>
            We do not sell your data. There is no advertising network, no advertising identifier, no
            third-party analytics SDK, and no crash-reporting SDK in the app.
          </li>
          <li>
            Reporting, blocking, pausing your page, withdrawing consent and deleting your account
            are free, and none of them is behind a purchase.
          </li>
        </ul>
      </section>

      <section className={styles.section} id="collect">
        <h2>What we collect, and why</h2>

        <h3>Your account</h3>
        <p>
          An email address, held in our Supabase authentication store, and an account record with
          your display name, date of birth and account status. We need the address to sign you in
          and to send the few transactional emails listed below; the date of birth is how we keep
          the service to adults only.
        </p>
        <p>
          A display name is seeded from the first part of your email address when the account is
          created. Until you confirm a name of your own, that seeded value is never shown on any
          public page — you appear as “A friend”.
        </p>

        <h3>Your profile</h3>
        <p>
          If you are the person being introduced: photos, a short bio, what you are looking for, and
          an approximate location. You choose how precisely the location is shown — city, region, or
          hidden entirely. We never collect a precise location, and the app never asks for the
          location permission.
        </p>

        <h3>The pitch itself</h3>
        <p>
          A 30–60 second voice recording made by your friend, the photos they suggest, the
          transcript of that recording, and the structured text built from it. These live in private
          storage. They are not public, and cannot become public, until the person being introduced
          approves them.
        </p>
        <p>
          When a pitch is approved we freeze a snapshot of exactly what was approved — the headline,
          the text, the transcript and the list of photos. That snapshot is the record of what the
          person actually agreed to publish, and it is kept even after the campaign ends.
        </p>

        <h3>The invitation to approve</h3>
        <p>
          When your friend invites you to review a pitch, the email address or phone number they
          used is stored as a one-way hash, never as the address itself. It exists only to bind that
          invitation to the account that claims it.
        </p>

        <h3>Interest and conversations</h3>
        <p>
          If someone expresses interest, we store that interest and — once both sides agree — the
          text messages in the private one-to-one room. Message contents are never written to our
          analytics, and are never sent to an AI provider.
        </p>

        <h3>Purchases</h3>
        <p>
          Purchases are made through Apple and processed by RevenueCat. We store the purchase
          events, the product identifier, and which campaign or pitch the purchase applies to. Your
          Friendword account identifier is the identifier RevenueCat knows you by. We never see or
          store your card details.
        </p>

        <h3>Product analytics</h3>
        <p>
          We record a small set of usage events in our own database. The properties an event may
          carry are restricted by a server-side allowlist — a campaign or pitch identifier, a source
          or channel label, a duration, a product identifier — and nothing else is accepted. Outcome
          events are written by the database itself rather than by the app, so the numbers cannot be
          inflated from a client.
        </p>

        <h3>Reports</h3>
        <p>
          When content is reported we store the report, the target, and who reported it. A report
          from someone who is not signed in is attributed to a salted hash of the network address
          instead, so that repeated reports can be recognised without keeping the address.
        </p>

        <h3>The waitlist</h3>
        <p>
          If you leave your address on the landing page we store the address and which link brought
          you. It is used for exactly one email — the day the iOS app is available — and the record
          is deleted as that email goes out.
        </p>
      </section>

      <section className={styles.section} id="ai">
        <h2>AI processing, and the consent it needs</h2>
        <p>
          Building a pitch uses an external AI provider — currently OpenAI — to transcribe the
          recording, structure it into text, and run a safety review over the text and photos. The
          same provider runs the safety review over a photo and note attached to an expression of
          interest.
        </p>
        <div className={styles.callout}>
          None of that happens until you agree to it on the screen that asks. Without that agreement
          your recording and photos reach Friendword’s own storage and go no further: the server
          refuses to make the external call at all, and the agreement is recorded against the exact
          version of the disclosure you were shown.
        </div>
        <p>
          Private one-to-one messages are never sent to an AI provider. That is a deliberate
          trade-off: those conversations are not screened before they are delivered, and are
          reviewed only when someone reports them.
        </p>
        <p>
          We do not synthesise faces, generate AI avatars, clone voices, or produce lip-synced
          video. A pitch is your friend’s actual recording. The AI drafts words from it, a human
          edits them, and the person being introduced approves them before anything is public.
        </p>
      </section>

      <section className={styles.section} id="share">
        <h2>Who else receives it</h2>
        <p>We use these companies to run the service. Each receives only what its job requires.</p>
        <ul>
          <li>
            <strong>Supabase</strong> — the database, the authentication store (where your email
            address lives) and the private media storage.
          </li>
          <li>
            <strong>OpenAI</strong> — the recording, photos and text you have agreed to send, for
            transcription, structuring and safety review.
          </li>
          <li>
            <strong>RevenueCat and Apple</strong> — purchase processing and receipt validation.
          </li>
          <li>
            <strong>Resend</strong> — the recipient address, resolved at send time and not retained
            by us, for a small number of transactional emails and the single waitlist email. Those
            emails contain your own display name only — never the other person’s name, photo, note,
            message text, or the address of a page.
          </li>
          <li>
            <strong>Vercel</strong> — hosting for this website and the public pitch pages.
          </li>
        </ul>
        <p>
          We do not sell personal information, and we do not share it with advertising networks or
          data brokers. Beyond the companies above, we disclose information only where the law
          requires it.
        </p>
      </section>

      <section className={styles.section} id="keep">
        <h2>How long we keep it</h2>
        <p>These are the retention rules the service actually enforces today.</p>
        <ul>
          <li>
            <strong>The original voice recording</strong> is removed seven days after the pitch is
            approved and rendered.
          </li>
          <li>
            <strong>A published page</strong> stays public for the window its owner chose — 14 days
            for a free campaign, 30 days for a purchased pass — and then expires automatically.
          </li>
          <li>
            <strong>Media that never got attached to anything</strong> is swept away after 48 hours.
          </li>
          <li>
            <strong>Emails we queued but could not send</strong> are closed out after 72 hours.
          </li>
          <li>
            <strong>Payment records held for manual review</strong> have their personal details
            scrubbed 90 days after the review is resolved; a summary is kept.
          </li>
        </ul>
        <div className={styles.callout}>
          Retention periods for the remaining categories — account records, dates of birth, pitch
          text, interests, messages, safety records, purchase records and analytics — are not yet
          fixed. We would rather say so than print a number we do not enforce.
        </div>
      </section>

      <section className={styles.section} id="delete">
        <h2>Deleting your account</h2>
        <p>
          You can delete your account yourself, from the Friendword app under “Your activity →
          Account”, or on this site from the bottom of your <Link href="/inbox">inbox</Link>. It
          takes a two-step confirmation. Nobody at Friendword can press it for you, by design.
        </p>
        <p>
          Confirming closes the account immediately: every part of the service stops accepting
          requests from it, your own voice recordings are removed, and any page of yours that
          depended on them is taken out of public view. The physical erasure of the rest runs on a
          scheduled job afterwards. We do not promise a completion time, and a deleted account
          cannot be restored.
        </p>
        <h3>What is removed</h3>
        <ul>
          <li>
            Your account, profile, dating profile and profile photos, along with the pages, pitches
            and media you own.
          </li>
          <li>
            Interest you sent — it disappears from the other person’s inbox rather than becoming
            anonymous.
          </li>
          <li>
            The one-to-one rooms you were in, including the other person’s messages in them, since
            those rooms have only two participants.
          </li>
        </ul>
        <h3>What is kept, and why</h3>
        <ul>
          <li>
            If you recorded a pitch <em>about someone else</em> and they published it, your voice
            recording and every video rendered from it are erased — but the text of that pitch and
            the snapshot of what they approved remain. That snapshot is their record of what they
            consented to publish, and it is not yours to withdraw.
          </li>
          <li>
            Safety reports are kept with the reporter and reported identifiers removed, so that a
            pattern of abuse does not vanish when an account does.
          </li>
          <li>
            Analytics, provider-usage and moderation records are kept with the link to your account
            severed.
          </li>
          <li>A single record that a deletion ran, so we can show the erasure was carried out.</li>
        </ul>
        <p>
          Anything that was already public and has been downloaded, screenshotted or reshared by
          someone else is outside our reach. Deleting your account cannot recall it.
        </p>
        <p>
          If you only want to remove a pitch you drafted that never became a page, the app deletes
          that outright — text, transcript and media together — because there is no approver whose
          record needs preserving.
        </p>
      </section>

      <section className={styles.section} id="choices">
        <h2>Your controls</h2>
        <ul>
          <li>
            <strong>Approve, edit, or refuse.</strong> Before anything is public you can rewrite the
            words, drop individual photos, set who may reach out, and choose how long the page lives
            — or decline the pitch entirely.
          </li>
          <li>
            <strong>Take it down.</strong> A published page can be paused or taken down for good
            from your inbox at any time.
          </li>
          <li>
            <strong>Refuse the AI step.</strong> A pitch can be written by hand instead. Declining
            means nothing leaves our storage.
          </li>
          <li>
            <strong>Report and block.</strong> Available on public pages, on people, and inside
            one-to-one rooms. Blocking stops visibility and messaging in both directions
            immediately.
          </li>
          <li>
            <strong>Delete your account</strong>, as described above.
          </li>
        </ul>
        <p>
          None of these is a paid feature, and none of them is affected by whether you have bought
          anything.
        </p>
        {/* [TO CONFIRM: access / portability / rectification requests. Deletion
            is the only self-service right implemented; there is no export path
            in the codebase, so this page does not offer one.] */}
      </section>

      <section className={styles.section} id="limits">
        <h2>What we do not claim</h2>
        <p>
          Friendword is 18 and over. We check a date of birth and a confirmed phone number; we do
          not run identity verification, face matching, or background checks, and we do not describe
          anyone on this service as verified or vetted.
        </p>
        <p>
          A recommendation from a friend is not proof. A friend and the person they are introducing
          can be mistaken, or can agree to say something untrue. Treat what you read here as what it
          is — one person’s account of another.
        </p>
      </section>

      <section className={styles.section} id="contact">
        <h2>Contact and changes</h2>
        <p>
          Questions about this policy, or about the data we hold on you, go through our{' '}
          <Link href="/support">support page</Link>.
        </p>
        {/* [TO CONFIRM: controller identity and postal address — the entity name
            to print here is still open (docs/APP_STORE_SUBMISSION.md D3).] */}
        <p>
          If this policy changes in a way that affects what we collect or who we send it to, we will
          update the review date at the top of this page, and say so in the app before the change
          takes effect.
        </p>
      </section>
    </LegalPage>
  );
}
