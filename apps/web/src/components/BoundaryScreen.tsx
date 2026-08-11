import Link from 'next/link';
import type { ReactNode } from 'react';

import styles from '@/styles/flowCard.module.css';

/**
 * The one branded screen behind every dead end (T013 / WUI-4, Issue #50).
 *
 * The 2026-08-11 screenshot audit found the product had no boundaries at all:
 * a mistyped campaign URL, an expired one and a thrown server error each landed
 * on Next.js's own black-on-white "404 | This page could not be found." — the
 * only page in the product with no wordmark, no way home and no relation to the
 * Hype Mixtape system. Reels send strangers to `/p/<slug>` and slugs get
 * mistyped, so this is a funnel surface, not a corner case.
 *
 * No new design system: it is the shared sticker-card vocabulary
 * (`flowCard.module.css`) the account flows already use, so a boundary looks
 * like part of the product rather than an apology from the framework.
 *
 * Copy rule (CLAUDE.md §12): every line here has to be true no matter which of
 * the several reasons brought the reader here, which is why the 404 says the
 * link "may" be mistyped and does not guess. When a reason IS known —
 * expiry — the caller passes that copy instead.
 */
export function BoundaryScreen({
  badge,
  badgeTone = 'neutral',
  title,
  children,
  status,
}: {
  readonly badge: string;
  readonly badgeTone?: 'neutral' | 'danger';
  readonly title: string;
  readonly children?: ReactNode;
  /**
   * Set for a screen that appears while something is still happening, so a
   * screen reader announces it. Static dead ends leave it off.
   */
  readonly status?: boolean;
}) {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.card} {...(status === true ? { 'aria-live': 'polite' } : {})}>
          <span className={badgeTone === 'danger' ? styles.badgeDanger : styles.badge}>
            {badge}
          </span>
          <h1 className={styles.title}>{title}</h1>
          {children}
        </section>
      </div>
    </main>
  );
}

/** The action row a boundary closes with — one grid, so the pills line up. */
export function BoundaryActions({ children }: { readonly children: ReactNode }) {
  return <div className={styles.actionRow}>{children}</div>;
}

/** The way home. Every boundary carries one; it is the only exit they all have. */
export function BoundaryHomeLink({ label = 'Go to Friendword' }: { readonly label?: string }) {
  return (
    <Link className={styles.secondary} href="/">
      {label}
    </Link>
  );
}

export { styles as boundaryStyles };
