import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalPage, legalStyles as styles } from '@/legal/LegalPage';

/*
 * TERMS OF SERVICE — DRAFT (App Store submission blocker B1).
 *
 * Grounded in docs/COMMUNITY_GUIDELINES.md (the conduct and format rules),
 * docs/PRODUCT.md (the consent model), docs/APP_STORE_SUBMISSION.md §5-§6 (the
 * two consumables and their store descriptions), docs/OPS.md §6 (the refund
 * mechanics) and docs/PRIVACY_DATA_MAP.md (what deletion does to other
 * people's material). The "what we don't promise" section restates
 * docs/THREAT_MODEL.md:27-28 rather than softening it.
 *
 * OPEN ITEMS FOR THE OWNER AND FOR LEGAL REVIEW:
 *
 *   [TO CONFIRM: the contracting legal entity, its registered address, and
 *     therefore who "we" is in this document. docs/APP_STORE_SUBMISSION.md D3.]
 *   [TO CONFIRM: governing law, jurisdiction and venue; whether arbitration and
 *     a class-action waiver are wanted. Nothing in the repo decides this, so
 *     the section below is a placeholder and is NOT enforceable as written.]
 *   [TO CONFIRM: the content licence grant a lawyer wants — scope, duration,
 *     sublicensing, and whether it survives deletion for the approved snapshot
 *     we deliberately retain. The wording below describes only what the code
 *     actually does with the content.]
 *   [TO CONFIRM: DMCA / copyright takedown agent and address, and the
 *     right-of-publicity process for a person whose photo or voice an
 *     introducer uploaded without permission. The product has a report path;
 *     the legal designation does not exist.]
 *   [TO CONFIRM: consumer refund wording. Apple treats consumables as final
 *     sale; docs/OPS.md §6 describes only the operator-side mechanics. Confirm
 *     the user-facing promise, especially for jurisdictions with statutory
 *     withdrawal rights.]
 *   [TO CONFIRM: public support and child-safety contact addresses
 *     (docs/APP_STORE_SUBMISSION.md D1b, docs/COMMUNITY_GUIDELINES.md:37).]
 *   [TO CONFIRM: whether a limitation-of-liability and indemnity clause is
 *     wanted. None is drafted here — an unreviewed one is worse than none.]
 */

export const metadata: Metadata = {
  title: 'Terms of Service — Friendword',
  description:
    'The rules for using Friendword: who may join, whose permission you need, what is not allowed, and what we do and do not promise.',
};

export default function TermsPage() {
  return (
    <LegalPage
      current="/terms"
      eyebrow="Terms"
      title="The deal between us"
      lede="Friendword lets one person speak on behalf of another. That only works if everyone involved agreed to it — so most of what follows is about permission, and about what happens when it is missing."
    >
      <nav className={styles.toc} aria-label="On this page">
        <ol>
          <li>
            <a href="#who">Who may use Friendword</a>
          </li>
          <li>
            <a href="#how">How a pitch becomes public</a>
          </li>
          <li>
            <a href="#permission">Content, and whose permission you need</a>
          </li>
          <li>
            <a href="#rules">What is not allowed</a>
          </li>
          <li>
            <a href="#ai">AI-drafted text</a>
          </li>
          <li>
            <a href="#purchases">Purchases</a>
          </li>
          <li>
            <a href="#enforcement">Reports, blocking and enforcement</a>
          </li>
          <li>
            <a href="#deletion">Ending your account, and other people’s</a>
          </li>
          <li>
            <a href="#promises">What we do not promise</a>
          </li>
          <li>
            <a href="#legal">Changes and governing law</a>
          </li>
        </ol>
      </nav>

      <section className={styles.section} id="who">
        <h2>Who may use Friendword</h2>
        <p>
          You must be 18 or older to create an account, to appear in a pitch, or to use any part of
          the service. People under 18 may not be the subject of a pitch, may not appear in the
          photos or the recording, and may not be introduced through it.
        </p>
        <p>
          By using Friendword you confirm you are 18 or older and that the information you give
          about yourself is true.
        </p>
      </section>

      <section className={styles.section} id="how">
        <h2>How a pitch becomes public</h2>
        <p>
          A friend records a pitch about you. You review it. Nothing about you is published until
          you approve it — the words, each individual photo, who may express interest, and how long
          the page stays up. You can change the words, drop photos, or decline entirely.
        </p>
        <p>
          Once published, a page is a public link: anyone with the address can open it, without
          signing in. Expressing interest requires an account. You can pause the page or take it
          down for good at any time, and it expires on its own at the end of the window you chose.
        </p>
        <div className={styles.callout}>
          A public page can be screenshotted, saved or reshared by anyone who opens it. Taking a
          page down stops us serving it; it cannot recall a copy someone else already has.
        </div>
      </section>

      <section className={styles.section} id="permission">
        <h2>Content, and whose permission you need</h2>
        <p>
          If you record a pitch about someone, you are speaking about a real person. Do not upload
          another person’s photos, voice, or personal details without their permission, and do not
          present yourself as someone you are not.
        </p>
        <p>
          You keep ownership of what you create. You give us permission to store it, process it as
          described in our <Link href="/privacy">privacy policy</Link>, and — only once the person
          being introduced has approved it — publish it at the address they chose to share, for the
          window they chose.
        </p>
        <p>
          When a pitch is approved we keep a snapshot of exactly what was approved. That record
          belongs to the approval, not to the person who recorded it: it stays even if the recorder
          later deletes their account, because it is the evidence of what the subject agreed to. The
          recording itself is erased in that case.
        </p>
      </section>

      <section className={styles.section} id="rules">
        <h2>What is not allowed</h2>
        <p>Using Friendword, you agree not to:</p>
        <ul>
          <li>
            publish anyone’s photo, voice or personal information without their permission, or
            impersonate anyone;
          </li>
          <li>
            send unwanted sexual messages, keep contacting someone who has stopped replying, or
            harass, insult or threaten anyone;
          </li>
          <li>post hateful, exploitative, fraudulent or illegal content;</li>
          <li>
            involve anyone under 18 in any way. Content that sexualises a minor is reported and the
            account permanently removed, with no warning;
          </li>
          <li>
            use synthesised faces, AI avatars, cloned or lip-synced voices — a pitch has to be a
            real person’s real recording;
          </li>
          <li>
            state as fact something the service has not actually verified, particularly about
            someone else’s health, criminal history, finances, work or education;
          </li>
          <li>
            attempt to scrape, enumerate or index other people’s pages, or work around the limits
            and gates the service applies.
          </li>
        </ul>
        <p>
          Friendword is also not built to be a rating system. There is no scoring of appearance, no
          public voting on people, and no anonymous or public commenting, and we will not add them.
        </p>
      </section>

      <section className={styles.section} id="ai">
        <h2>AI-drafted text</h2>
        <p>
          With your agreement, the words in a pitch are drafted by an AI model from your friend’s
          recording. That draft can be wrong. It is edited by a person, and the subject of the pitch
          approves the final text — so the text that goes public is the subject’s statement about
          themselves, not the model’s.
        </p>
        <p>
          Claims that are objective and consequential — about health, criminal history, wealth, work
          or education — have to be confirmed by the person being introduced before the page can be
          published. You are responsible for the accuracy of what you approve.
        </p>
      </section>

      <section className={styles.section} id="purchases">
        <h2>Purchases</h2>
        <p>
          Friendword sells two one-time items, both bought inside the iOS app through Apple. There
          are no subscriptions and nothing auto-renews.
        </p>
        <ul>
          <li>
            <strong>Creator Launch — $4.99.</strong> One share card and caption pack for one
            published pitch. The kit stays available after it is unlocked.
          </li>
          <li>
            <strong>30-Day Campaign Pass — $19.99.</strong> Adds 30 days to that campaign’s live
            window, on top of any time it already has left, and unlocks that campaign’s analytics.
          </li>
        </ul>
        <div className={styles.callout}>
          Neither purchase unlocks a safety feature. Reporting, blocking, pausing a page,
          withdrawing consent and deleting your account are free and always will be.
        </div>
        <p>
          Apple processes the payment and holds the receipt, so refund requests go through Apple.
          Where a refund is granted for an item that has not yet been delivered, the entitlement is
          withdrawn; a launch kit that was already generated and handed over is not clawed back.
        </p>
        {/* [TO CONFIRM: statutory withdrawal/cooling-off rights in the EU, UK
            and elsewhere, and how they interact with Apple's final-sale
            treatment of consumables.] */}
      </section>

      <section className={styles.section} id="enforcement">
        <h2>Reports, blocking and enforcement</h2>
        <p>
          Every public page, every person, and every one-to-one conversation can be reported.
          Blocking someone stops visibility and messaging in both directions immediately, and you
          can leave a conversation at any time.
        </p>
        <p>
          A page that draws serious reports from more than one person within a day is hidden
          automatically while it is reviewed. We can also archive a page, block accounts from each
          other, suspend an account, or delete stored media when these terms are broken.
        </p>
        <div className={styles.callout}>
          An honest limit: private one-to-one messages are not screened before they are delivered.
          The server enforces who may be in a room, message length and rate limits, and blocking —
          the rest is review after a report. During the current beta the report queue is checked at
          least once a day. We are not describing that as complete moderation.
        </div>
      </section>

      <section className={styles.section} id="deletion">
        <h2>Ending your account, and other people’s</h2>
        <p>
          You can delete your account at any time from the app or from your{' '}
          <Link href="/inbox">inbox</Link> on this site. Deletion cannot be undone and we cannot
          restore an account afterwards. What is removed and what is kept is set out in the{' '}
          <Link href="/privacy">privacy policy</Link>.
        </p>
        <p>Two consequences are worth stating plainly, because they involve other people:</p>
        <ul>
          <li>
            If the friend who recorded your pitch deletes their account, their recording is erased —
            and because a published page cannot exist without the voice it was built on, your page
            is taken out of public view.
          </li>
          <li>
            If someone you were talking to deletes their account, that conversation goes with them,
            including the messages you can currently see.
          </li>
        </ul>
        <p>
          We may suspend or close an account that breaks these terms, or where we are required to by
          law.
        </p>
      </section>

      <section className={styles.section} id="promises">
        <h2>What we do not promise</h2>
        <p>
          We do not verify identity, match faces, or run background checks, and nothing on
          Friendword should be read as us vouching for anyone. A friend’s recommendation is one
          person’s account of another — a friend and the person they are introducing can be
          mistaken, or can agree to say something untrue.
        </p>
        <p>
          The service is provided as it is. We do not promise it will be uninterrupted, that a page
          will always be reachable, or that a scheduled job will run at a particular moment. Meeting
          anyone in person is your own decision and your own risk.
        </p>
        {/* [TO CONFIRM: a warranty disclaimer, limitation of liability and
            indemnity clause, if wanted. Deliberately not drafted here — the
            paragraph above states the real limits without pretending to be a
            reviewed liability cap.] */}
      </section>

      <section className={styles.section} id="legal">
        <h2>Changes and governing law</h2>
        <p>
          If these terms change materially we will update the review date at the top of this page
          and tell you in the app before the change applies. Continuing to use Friendword after that
          means the new terms apply to you.
        </p>
        {/* [TO CONFIRM: governing law, jurisdiction, venue, and any dispute
            resolution mechanism. The sentence below is a placeholder pending
            that decision and the entity name.] */}
        <p>
          The governing law and the place where disputes are heard have not been settled yet, and
          will be stated here before Friendword leaves beta.
        </p>
        <p>
          Questions about these terms go through our <Link href="/support">support page</Link>.
        </p>
      </section>
    </LegalPage>
  );
}
