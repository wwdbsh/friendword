import Link from 'next/link';
import Script from 'next/script';

import { AccountNavLink } from '@/components/AccountNavLink';
import { WaitlistForm } from '@/components/WaitlistForm';

import styles from './page.module.css';

const attributionScript = `(() => {
  const source = new URLSearchParams(window.location.search).get('src');
  if (source) window.sessionStorage.setItem('fw_attribution', source);
})();`;

const steps = [
  {
    number: '01',
    title: 'A friend records it',
    body: 'Someone who has known you for years says it out loud, in their own voice.',
  },
  {
    number: '02',
    title: 'You approve it',
    body: 'You edit the words, pick the photos, and set who can reach out before anything goes live.',
  },
  {
    number: '03',
    title: 'Share one link',
    body: 'Only the version you approved becomes a page — in your friend’s words, not an algorithm’s.',
  },
] as const;

function VoiceMark() {
  return (
    <svg className={styles.voiceMark} viewBox="0 0 360 120" aria-hidden="true">
      {[34, 58, 88, 46, 76, 104, 64, 42, 92, 72, 108, 52, 82, 62, 96, 38].map((height, index) => (
        <rect
          key={`${height}-${index}`}
          x={index * 22 + 4}
          y={(120 - height) / 2}
          width="12"
          height={height}
          rx="6"
        />
      ))}
    </svg>
  );
}

export default function HomePage() {
  return (
    <>
      <Script id="friendword-attribution" strategy="afterInteractive">
        {attributionScript}
      </Script>
      {/* Referral storage/claiming is mounted globally in app/layout.tsx. */}
      <main className={styles.page}>
        <header className={styles.nav}>
          <Link className={styles.wordmark} href="/" aria-label="Friendword home">
            Friendword
          </Link>
          <div className={styles.navLinks}>
            <Link className={styles.quietLink} href="/p/demo-blair">
              See the demo
            </Link>
            {/* Only rendered for a visitor who already has a session — see
                AccountNavLink. Signed out, the landing promises no inbox. */}
            <AccountNavLink className={styles.quietLink} />
          </div>
        </header>

        <section className={styles.hero} aria-labelledby="hero-heading">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Dating, in your friends&apos; words.</p>
            <h1 id="hero-heading">
              <span>Introductions that start</span>
              <span>with a friend’s voice</span>
            </h1>
            <p className={styles.heroBody}>
              A friend who actually knows you says it best. You approve every word before it goes
              public, and interest only opens after you say yes. Friendword makes the first
              introduction <span className={styles.noBreak}>human again.</span>
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryAction} href="/p/demo-blair">
                See a demo pitch
                <span aria-hidden="true">→</span>
              </Link>
              <Link className={styles.secondaryAction} href="#how-it-works">
                How does it work?
              </Link>
            </div>
          </div>

          <div className={styles.voiceCard} aria-label="Friendword voice pitch preview">
            <div className={styles.voiceCardTopline}>
              <span>FROM A FRIEND</span>
              <span>01:00</span>
            </div>
            <VoiceMark />
            <div className={styles.voiceQuote}>
              <span className={styles.quoteMark} aria-hidden="true">
                “
              </span>
              <span>She turns an ordinary Tuesday</span>
              <span>into the story</span>
              <span>you tell all year.</span>
            </div>
            <div className={styles.approvalLine}>
              <span className={styles.approvalDot} aria-hidden="true" />
              Approved by the person being introduced
            </div>
          </div>
        </section>

        <section className={styles.stepsSection} id="how-it-works" aria-labelledby="steps-heading">
          <div className={styles.sectionHeading}>
            <p className={styles.kicker}>HOW IT WORKS</p>
            <h2 id="steps-heading">How an introduction starts</h2>
          </div>
          <div className={styles.stepsGrid}>
            {steps.map((step) => (
              <article className={styles.stepCard} key={step.number}>
                <span className={styles.stepNumber}>{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.demoBand} aria-labelledby="demo-heading">
          <div>
            <p className={styles.kicker}>SEE THE FORMAT</p>
            <h2 id="demo-heading">Before the explainer, meet one person.</h2>
            <p>
              Blair’s demo shows the written pitch and approved photos. It has no voice recording —
              on a real page you hear the friend’s actual voice note.
            </p>
          </div>
          <Link className={styles.secondaryAction} href="/p/demo-blair">
            Open Blair’s demo
            <span aria-hidden="true">↗</span>
          </Link>
        </section>

        <section className={styles.safetySection} aria-labelledby="safety-heading">
          <div className={styles.sectionHeading}>
            <p className={styles.kicker}>BUILT AROUND CONSENT</p>
            <h2 id="safety-heading">The person being introduced decides</h2>
            <p>
              Not the friend who made the pitch — the person it’s about chooses what goes public,
              and for how long.
            </p>
          </div>
          <div className={styles.safetyGrid}>
            <article>
              <span className={styles.safetyIcon} aria-hidden="true">
                01
              </span>
              <h3>Consent before publish</h3>
              <p>The campaign link stays private until the person being introduced approves it.</p>
            </article>
            <article>
              <span className={styles.safetyIcon} aria-hidden="true">
                02
              </span>
              <h3>Every word and photo</h3>
              <p>They edit the copy, choose the photos, and set who can reach out.</p>
            </article>
            <article>
              <span className={styles.safetyIcon} aria-hidden="true">
                03
              </span>
              <h3>View without signing up</h3>
              <p>Anyone can view a public pitch. Expressing interest requires a real profile.</p>
            </article>
          </div>
        </section>

        <section className={styles.appSection} aria-labelledby="app-heading">
          <div className={styles.sectionHeading}>
            <p className={styles.kicker}>WHAT&apos;S NEXT</p>
            <h2 id="app-heading">The iOS app is on its way</h2>
            <p>Not on the App Store yet — explore the demo while we finish it.</p>
          </div>

          <div className={styles.pathGrid}>
            {/* These stable anchors can become universal-link destinations when the iOS app ships. */}
            <article className={styles.pathCard} id="pitch-a-friend">
              <p className={styles.pathLabel}>Want to introduce a friend?</p>
              <h3>Put what makes them great into your own voice.</h3>
              <p>
                Record the pitch and pick photos in the app, then ask your friend to approve it.
              </p>
              <span className={styles.comingSoon}>Coming to iOS</span>
            </article>

            <article className={styles.pathCard} id="create">
              <p className={styles.pathLabel}>After you’ve been introduced</p>
              <h3>Next time, you can be the one doing the introducing.</h3>
              <p>Everyone who gets a Friendword can pass one on to a friend of their own.</p>
              <Link className={styles.textLink} href="/p/demo-blair">
                Try the demo first <span aria-hidden="true">→</span>
              </Link>
            </article>
          </div>
        </section>

        {/* Copy audit (§12), 2026-08-12: this section used to promise "an
            invite the moment it opens". Two things made that wrong. The beta
            OPENED on 2026-08-11 (public_beta_enabled=on), so "when we launch"
            named a day that had already passed; and nothing in the codebase
            could send the promised mail — the addresses were simply
            accumulating. Both are fixed here and in scripts/
            send-waitlist-invites.mjs, and the section now says the one thing
            that is still true: the web side is open, the iOS app is not.
            The form stays rather than becoming a "start now" button because a
            cold visitor has nothing to start — creating a pitch is the app,
            and being introduced starts with a friend's link, not with us. */}
        <section className={styles.waitlistSection} id="start" aria-labelledby="waitlist-heading">
          <div className={styles.sectionHeading}>
            <p className={styles.kicker}>THE PART THAT ISN’T OPEN YET</p>
            <h2 id="waitlist-heading">The beta is open. The app isn’t.</h2>
            <p>
              If a friend sends you a Friendword, the whole thing already works — read the pitch,
              hear their voice, say you’re interested. Recording one of your own still needs the iOS
              app, and that isn’t on the App Store. Leave your email and we’ll write once, the day
              it is. We delete your address as that email goes out.
            </p>
          </div>
          <WaitlistForm />
        </section>

        <footer className={styles.footer}>
          <p className={styles.footerWordmark}>Friendword</p>
          <p>Dating, in your friends&apos; words.</p>
        </footer>
      </main>
    </>
  );
}
