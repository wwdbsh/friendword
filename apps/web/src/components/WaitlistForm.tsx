'use client';

import { useRef, useState, type FormEvent } from 'react';

import type { BrowserSupabaseClient } from '@friendword/data';

import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { readStoredReferral, submitWaitlist, type WaitlistResult } from '@/lib/waitlist';

import styles from './WaitlistForm.module.css';

type FormStatus = 'idle' | 'submitting' | WaitlistResult['status'];

const MESSAGES: Record<Exclude<FormStatus, 'idle' | 'submitting'>, string> = {
  joined: 'You’re on the list. We’ll email you an invite when Friendword opens.',
  invalid_email: 'That doesn’t look like an email address — check it and try again.',
  rate_limited: 'That’s a lot of tries in a short window. Give it a minute and try again.',
  error: 'Something went wrong on our side. Try again in a moment.',
};

export function WaitlistForm() {
  const clientRef = useRef<BrowserSupabaseClient | null | undefined>(undefined);
  if (clientRef.current === undefined) {
    clientRef.current = getSupabaseBrowserClient();
  }
  const client = clientRef.current;

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<FormStatus>('idle');

  const submitting = status === 'submitting';
  const done = status === 'joined';

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || done) {
      return;
    }
    setStatus('submitting');

    // Referral: the first campaign that sent this visitor (localStorage,
    // first-touch, 30-day TTL). Source: the acquisition channel captured by
    // the attribution script.
    const referralSlug = readStoredReferral()?.slug ?? null;
    const source =
      typeof window === 'undefined' ? null : window.sessionStorage.getItem('fw_attribution');

    const result = await submitWaitlist(client, email, { referralSlug, source });
    setStatus(result.status);
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="waitlist-email">
          Email
        </label>
        <div className={styles.inputRow}>
          <input
            id="waitlist-email"
            className={styles.input}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            disabled={submitting || done}
            onChange={(event) => {
              setEmail(event.target.value);
              if (status !== 'idle' && status !== 'submitting') {
                setStatus('idle');
              }
            }}
            aria-describedby="waitlist-status"
          />
          <button className={styles.submit} type="submit" disabled={submitting || done}>
            {done ? 'Joined' : submitting ? 'Joining…' : 'Join the waitlist'}
          </button>
        </div>
      </div>
      <p
        id="waitlist-status"
        className={done ? styles.statusOk : styles.status}
        role="status"
        aria-live="polite"
      >
        {status === 'idle' || status === 'submitting' ? '' : MESSAGES[status]}
      </p>
    </form>
  );
}
