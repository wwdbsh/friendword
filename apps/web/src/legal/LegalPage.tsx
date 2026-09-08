import Link from 'next/link';
import type { ReactNode } from 'react';

import styles from './legal.module.css';

/**
 * The date the three legal/support drafts were last written against the repo's
 * own documentation. It is rendered, not just committed, because the pages say
 * out loud that they are drafts — a draft with no date is a claim with no
 * expiry.
 */
export const LEGAL_LAST_REVIEWED = '8 September 2026';

/**
 * The one thing every reader of these pages must know before the first
 * sentence: nothing here has been reviewed by a lawyer. Every unresolved
 * question is marked `[TO CONFIRM: …]` in the page source for the owner.
 */
export const LEGAL_DRAFT_NOTICE =
  'This is a working draft, not reviewed by a lawyer, published so the app’s behaviour is described somewhere a person can read it.';

const NAV_PAGES = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/support', label: 'Support' },
] as const;

export type LegalPagePath = (typeof NAV_PAGES)[number]['href'];

/**
 * Shared chrome for /privacy, /terms and /support.
 *
 * These three are one surface, not three unrelated pages: a person who lands on
 * the privacy policy from the App Store listing needs the support page one
 * click away, and the App Store review needs all three reachable from the
 * landing page. Keeping the shell here is also what keeps the draft banner
 * impossible to forget on a new page.
 */
export function LegalPage({
  current,
  eyebrow,
  title,
  lede,
  children,
}: {
  readonly current: LegalPagePath;
  readonly eyebrow: string;
  readonly title: string;
  readonly lede: string;
  readonly children: ReactNode;
}) {
  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <Link className={styles.wordmark} href="/" aria-label="Friendword home">
          Friendword
        </Link>
        <nav className={styles.navLinks} aria-label="Legal and support">
          {NAV_PAGES.map((page) => (
            <Link
              key={page.href}
              className={
                page.href === current
                  ? `${styles.quietLink} ${styles.quietLinkCurrent}`
                  : styles.quietLink
              }
              href={page.href}
              {...(page.href === current ? { 'aria-current': 'page' } : {})}
            >
              {page.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className={styles.body}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.lede}>{lede}</p>

        <aside className={styles.draftNote} role="note">
          <strong>Draft — last reviewed {LEGAL_LAST_REVIEWED}.</strong> {LEGAL_DRAFT_NOTICE}
        </aside>

        {children}
      </div>

      <footer className={styles.footer}>
        <p className={styles.footerWordmark}>Friendword</p>
        <p className={styles.updated}>Last reviewed {LEGAL_LAST_REVIEWED}</p>
      </footer>
    </main>
  );
}

export { styles as legalStyles };
