'use client';

import { useState, type FormEvent } from 'react';

import { signInWithOtp, type BrowserSupabaseClient } from '@friendword/data';

import styles from '@/styles/flowCard.module.css';

type EmailSignInProps = {
  readonly client: BrowserSupabaseClient;
  /** Copy above the form, e.g. why signing in is needed. */
  readonly reason: string;
};

/**
 * Magic-link email sign-in used by the account-facing web flows. The link
 * returns to the current URL, where the page's onAuthStateChange listener
 * picks the session up.
 */
export function EmailSignIn({ client, reason }: EmailSignInProps) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      await signInWithOtp(client, email, { emailRedirectTo: window.location.href });
      setSentTo(email);
    } catch {
      setError('We could not send the sign-in link. Check the email address and try again.');
    } finally {
      setSending(false);
    }
  }

  if (sentTo !== null) {
    return (
      <div>
        <p className={styles.lede}>
          Check <strong>{sentTo}</strong> — your sign-in link is on the way. Open it on this device
          to continue.
        </p>
        <form onSubmit={handleSubmit}>
          <button className={styles.secondary} type="submit" disabled={sending}>
            {sending ? 'Sending…' : 'Resend the link'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <p className={styles.muted}>{reason}</p>
      <label className={styles.label} htmlFor="flow-email">
        Your email
      </label>
      <input
        id="flow-email"
        className={styles.input}
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button className={styles.primary} type="submit" disabled={sending}>
        {sending ? 'Sending…' : 'Email me a sign-in link'}
      </button>
      <p className={styles.finePrint}>No password, no signup forms — the link brings you back.</p>
      {error !== null && <p className={styles.error}>{error}</p>}
    </form>
  );
}
