import Link from 'next/link';

import { SignOutButton } from '@/components/SignOutButton';

import styles from '@/styles/flowCard.module.css';

export type FlowNavTab = 'me';

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
   * The account link is hidden on the pre-decision surfaces (consent, interest,
   * sign-in confirmation) where clicking away loses the step in progress. The
   * wordmark still goes home so no screen is a dead end.
   */
  readonly tabs?: boolean;
  /**
   * The sign-out control (T008, Issue #45). On by default — a session must be
   * endable from wherever it can be used, and the button renders nothing at
   * all without one, so a signed-out surface is unaffected either way.
   *
   * Turned off only where signing out contradicts the screen itself: /auth/
   * confirm is a person in the act of signing IN, and offering them the
   * opposite in the same shell is not a choice, it is a trap.
   */
  readonly signOut?: boolean;
};

/**
 * The one navigation shell the web account surfaces share (T004, Issue #41).
 * Before this, /inbox, /rooms/[id], /kit/[id] and /p/[slug]/interest rendered
 * zero anchors once signed in: the funnel from a reel to a chat could only be
 * completed by typing URLs. Anything added here must stay inside the existing
 * flowCard (Hype Mixtape) vocabulary.
 *
 * T009 (Issue #46) turned the three sibling tabs into one hub link. Two facts
 * drove it. The product now has FOUR account areas (inbox, interests sent,
 * rooms, campaigns about me) and measurement says four pills cannot share a
 * row: at 375px the shell is 327px wide and the three tabs alone already
 * measured 331.7px, which is the second-line wrap left over from T006. And the
 * mobile app has no tab bar at all — its home screen is a hub — so a single
 * "My page" door is what makes the two surfaces one information structure
 * instead of two. Every area is one tap from the hub, and the hub is on every
 * signed-in screen.
 */
export function FlowNav({ current, back, tabs = true, signOut = true }: FlowNavProps) {
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
              className={`${styles.navTab} ${current === 'me' ? styles.navTabActive : ''}`}
              href="/me"
              {...(current === 'me' ? { 'aria-current': 'page' as const } : {})}
            >
              My page
            </Link>
          </div>
        )}
        {signOut && <SignOutButton />}
      </div>
      {back !== undefined && (
        <Link className={styles.navBack} href={back.href}>
          ← {back.label}
        </Link>
      )}
    </nav>
  );
}
