import Link from 'next/link';

import styles from '@/styles/flowCard.module.css';

export type FlowNavTab = 'inbox' | 'rooms';

type FlowNavBack = {
  readonly href: string;
  readonly label: string;
};

type FlowNavProps = {
  /** Marks the destination the visitor is already on (`aria-current="page"`). */
  readonly current?: FlowNavTab;
  /** Extra return link, e.g. a single intro room back to the room list. */
  readonly back?: FlowNavBack;
  /**
   * Account tabs are hidden on the pre-decision surfaces (consent, interest,
   * sign-in confirmation) where clicking away loses the step in progress. The
   * wordmark still goes home so no screen is a dead end.
   */
  readonly tabs?: boolean;
};

/**
 * The one navigation shell the web account surfaces share (T004, Issue #41).
 * Before this, /inbox, /rooms/[id], /kit/[id] and /p/[slug]/interest rendered
 * zero anchors once signed in: the funnel from a reel to a chat could only be
 * completed by typing URLs. Anything added here must stay inside the existing
 * flowCard (Hype Mixtape) vocabulary.
 */
export function FlowNav({ current, back, tabs = true }: FlowNavProps) {
  return (
    <nav className={styles.nav} aria-label="Friendword">
      <div className={styles.navRow}>
        <Link
          className={`${styles.wordmark} ${styles.wordmarkLink}`}
          href="/"
          aria-label="Friendword home"
        >
          Friendword
        </Link>
        {tabs && (
          <div className={styles.navTabs}>
            <Link
              className={`${styles.navTab} ${current === 'inbox' ? styles.navTabActive : ''}`}
              href="/inbox"
              {...(current === 'inbox' ? { 'aria-current': 'page' as const } : {})}
            >
              Inbox
            </Link>
            <Link
              className={`${styles.navTab} ${current === 'rooms' ? styles.navTabActive : ''}`}
              href="/rooms"
              {...(current === 'rooms' ? { 'aria-current': 'page' as const } : {})}
            >
              Intro rooms
            </Link>
          </div>
        )}
      </div>
      {back !== undefined && (
        <Link className={styles.navBack} href={back.href}>
          ← {back.label}
        </Link>
      )}
    </nav>
  );
}
