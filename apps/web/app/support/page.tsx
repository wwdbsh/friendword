import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalPage, legalStyles as styles } from '@/legal/LegalPage';

/*
 * SUPPORT — DRAFT (App Store submission blocker B1; the Support URL is a
 * required App Store Connect field).
 *
 * Every route and gesture named below exists today: the in-app report controls,
 * the block-and-leave controls in an intro room, "Take it down for good" on
 * /inbox, and the account deletion path documented in docs/OPS.md:41-48 and
 * docs/PRIVACY_DATA_MAP.md:30-50. Nothing here promises a response time,
 * because none is committed to anywhere in the repo.
 *
 * THIS PAGE IS NOT SHIPPABLE UNTIL THE FIRST ITEM IS ANSWERED:
 *
 *   [TO CONFIRM: **the public support email address.** The repo has none
 *     (docs/APP_STORE_SUBMISSION.md D1b, docs/PRIVACY_DATA_MAP.md:104). The
 *     owner's personal address in docs/OPS.md is an ops alert channel and must
 *     not be published here. `notify@friendword.com` appears only as an example
 *     env value and is not a monitored inbox. App Store Connect requires a
 *     working contact, so a real mailbox has to exist before submission.]
 *   [TO CONFIRM: **the child-safety contact address**, which Google Play and
 *     docs/COMMUNITY_GUIDELINES.md:16 both require to be published separately
 *     from general support.]
 *   [TO CONFIRM: a support response-time commitment, if any. docs/OPS.md says
 *     the report queue is checked at least daily during beta — that is an
 *     internal floor, not an SLA, so this page states it as what we do rather
 *     than as a promise.]
 *   [TO CONFIRM: whether data access/export requests will be offered, and
 *     through what channel. No export path exists in the codebase.]
 *   [TO CONFIRM: the canonical public hostname. docs/APP_STORE_SUBMISSION.md
 *     §12 records two Vercel projects deploying on push and no confirmed
 *     friendword.com HTTPS, so the URL printed in App Store Connect has to be
 *     verified against whatever actually serves this page.]
 */

/**
 * Rendered wherever a contact address would go. Kept as one constant so the
 * owner replaces a single string, and so a UI test can assert that no address
 * was quietly invented in the meantime.
 */
const SUPPORT_EMAIL_PLACEHOLDER = '[TO CONFIRM: support email]';

export const metadata: Metadata = {
  title: 'Support — Friendword',
  description:
    'How to reach Friendword, report content, block someone, take your page down, delete your account, or ask about a purchase.',
};

export default function SupportPage() {
  return (
    <LegalPage
      current="/support"
      eyebrow="Support"
      title="Getting help, and getting out"
      lede="Most of what people need here is something they can do themselves, right now, without waiting for us. Those come first."
    >
      <section className={styles.section} id="report">
        <h2>Reporting something</h2>
        <p>
          Every public pitch page has a report link at the bottom. Inside a conversation you can
          report the other person, block them, or leave. You do not need an account to report a
          public page.
        </p>
        <p>
          Serious reports from more than one person about the same page within a day hide it
          automatically while it is reviewed. Everything else goes into a queue that we check at
          least once a day during the beta. We do not currently promise a reply time.
        </p>
        <div className={styles.callout}>
          If someone is in immediate danger, contact your local emergency services first. We cannot
          respond at that speed.
        </div>

        <h3>Content involving a minor</h3>
        <p>
          Friendword is 18 and over. Content that sexualises or endangers a child is removed and the
          account permanently closed. Report it through the in-app report link, and by email so it
          is escalated directly.
        </p>
        <p>
          Child safety contact: <strong>{SUPPORT_EMAIL_PLACEHOLDER}</strong>
        </p>
        {/* [TO CONFIRM: a dedicated child-safety address, separate from general
            support, as Google Play policy and COMMUNITY_GUIDELINES.md:16
            require.] */}

        <h3>Someone used my photo, voice or name</h3>
        <p>
          Nobody may upload another person’s photos, recording or personal details without their
          permission. Report the page and email us. You do not need a Friendword account to ask for
          a page about you to be taken down.
        </p>
      </section>

      <section className={styles.section} id="control">
        <h2>Taking control of your own page</h2>
        <h3>Pause it or take it down</h3>
        <p>
          Open your <Link href="/inbox">inbox</Link>. A published page can be paused, or taken down
          for good, from there — it stops being publicly readable immediately and stops accepting
          new interest.
        </p>
        <p>
          Taking a page down leaves the conversations and interest that already happened intact,
          because those belong to the other people in them as much as to you.
        </p>

        <h3>Change what is on it</h3>
        <p>
          The words, the photos, who may express interest, and how long the page lives are all set
          by the person being introduced during the approval step, before anything goes public.
        </p>

        <h3>Block someone</h3>
        <p>
          Blocking is available on a person and inside a conversation. It stops visibility and
          messaging in both directions straight away.
        </p>
      </section>

      <section className={styles.section} id="account">
        <h2>Deleting your account</h2>
        <p>
          In the Friendword app: <strong>Your activity → Account</strong>. On this site: the bottom
          of your <Link href="/inbox">inbox</Link>, under “Your account”. Both need a two-step
          confirmation, and both do exactly the same thing.
        </p>
        <p>
          We cannot do this for you — there is deliberately no way for anyone at Friendword to
          delete your account on your behalf, and no way to restore one afterwards. What is removed
          and what is kept is set out in the <Link href="/privacy">privacy policy</Link>.
        </p>
        <p>
          Deletion closes the account immediately. The physical erasure of the rest runs on a
          scheduled job after that, and we do not promise how long it takes.
        </p>

        <h3>I only want to remove one pitch</h3>
        <p>
          A pitch you drafted that never became a published page can be deleted outright in the app.
          A pitch that <em>did</em> become a page is taken down from the inbox instead, so the
          record of what was approved survives.
        </p>

        <h3>Take my address off the waitlist</h3>
        <p>
          Email us and say so. A waitlist address is used for exactly one message — the day the iOS
          app is out — and the record is deleted as that message goes out, so there is nothing to
          unsubscribe from afterwards.
        </p>
      </section>

      <section className={styles.section} id="purchases">
        <h2>Purchases and refunds</h2>
        <p>
          Friendword sells two one-time items inside the iOS app: Creator Launch ($4.99) and the
          30-Day Campaign Pass ($19.99). There are no subscriptions and nothing renews.
        </p>
        <p>
          Apple takes the payment and holds the receipt, so refunds are requested from Apple —
          through Report a Problem, or in your Apple account’s purchase history. Email us as well if
          something did not unlock after a purchase, and include the date and the item; we can see
          the purchase record on our side.
        </p>
        <p>
          Nothing you can buy is a safety feature. Reporting, blocking, pausing your page,
          withdrawing consent and deleting your account are all free.
        </p>
      </section>

      <section className={styles.section} id="data">
        <h2>Questions about your data</h2>
        <p>
          What we collect, who receives it, and how long it stays is written out in the{' '}
          <Link href="/privacy">privacy policy</Link>. For anything that page does not answer —
          including a request for a copy of your data — email us.
        </p>
        {/* [TO CONFIRM: whether a data export/access request path will be
            offered and what its response time is. Deletion is currently the
            only self-service data right that exists.] */}
      </section>

      <section className={styles.section} id="contact">
        <h2>Contacting us</h2>
        <p>
          Email: <strong>{SUPPORT_EMAIL_PLACEHOLDER}</strong>
        </p>
        <p>
          Friendword is a small project and this is currently the only support channel. There is no
          phone line and no live chat. Tell us what you were doing, on which screen, and roughly
          when — that is usually enough for us to find it.
        </p>
        <p>
          Please do not send passwords, sign-in codes, or identity documents. We will never ask you
          for them.
        </p>
      </section>
    </LegalPage>
  );
}
