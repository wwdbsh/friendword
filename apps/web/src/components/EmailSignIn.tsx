'use client';

import { useState, type FormEvent } from 'react';

import { signInWithOtp, verifyOtp, type BrowserSupabaseClient } from '@friendword/data';

import defaultStyles from '@/styles/flowCard.module.css';

import { authLinkErrorCopy, useAuthLinkError } from './authLinkError';

/** Supabase project setting — the emailed code is 8 digits (mobile uses it too). */
const EMAIL_OTP_LENGTH = 8;

const DEFAULT_FINE_PRINT = 'No password, no signup forms — the link brings you back.';

/** Class map of a CSS module; surfaces with their own module pass theirs. */
export type FlowStyles = Readonly<Record<string, string>>;

type EmailSignInProps = {
  readonly client: BrowserSupabaseClient;
  /** Copy above the form, e.g. why signing in is needed. */
  readonly reason: string;
  /** Defaults to the shared flow-card styles; the consent page passes its own. */
  readonly styles?: FlowStyles;
  /** Where the emailed link should return to. Defaults to the current URL. */
  readonly emailRedirectTo?: string;
  readonly finePrint?: string;
};

/**
 * Email sign-in for the account-facing web flows. Three ways in, because mail
 * scanners routinely prefetch (and thereby consume) magic links:
 * the emailed link, a resend, or the 8-digit code from the same email. Auth
 * errors the link left in the URL fragment are surfaced instead of swallowed.
 * On success the page's own auth listener picks the session up.
 */
export function EmailSignIn({
  client,
  reason,
  styles = defaultStyles,
  emailRedirectTo,
  finePrint = DEFAULT_FINE_PRINT,
}: EmailSignInProps) {
  const { linkError, clearAuthLinkError } = useAuthLinkError();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [enteringCode, setEnteringCode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      await signInWithOtp(client, email, {
        emailRedirectTo: emailRedirectTo ?? window.location.href,
      });
      setSentTo(email);
      setEnteringCode(false);
      clearAuthLinkError();
    } catch {
      setError('We could not send the sign-in link. Check the email address and try again.');
    } finally {
      setSending(false);
    }
  }

  async function handleVerifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVerifying(true);
    setError(null);
    try {
      const session = await verifyOtp(client, email, code.trim());
      if (session === null) {
        throw new Error('verifyOtp returned no session');
      }
      clearAuthLinkError();
    } catch {
      setError(
        'That code did not work. It may have expired or already been used — send a fresh email and use the newest code.',
      );
    } finally {
      setVerifying(false);
    }
  }

  const busy = sending || verifying;
  const linkErrorNotice =
    linkError === null ? null : (
      <p className={styles.error} role="alert">
        {authLinkErrorCopy(linkError)}
      </p>
    );
  const codeToggle = (
    <button
      className={styles.secondary}
      type="button"
      disabled={busy}
      onClick={() => {
        setEnteringCode(!enteringCode);
        setError(null);
      }}
    >
      {enteringCode
        ? 'Use an email link instead'
        : `Enter the ${EMAIL_OTP_LENGTH}-digit code instead`}
    </button>
  );

  if (enteringCode) {
    return (
      <div>
        {linkErrorNotice}
        <form className={styles.form} onSubmit={handleVerifyCode}>
          <p className={styles.muted}>
            The same email carries an {EMAIL_OTP_LENGTH}-digit code. Enter it here — useful when the
            link opens on another device. If the link was already used up, the code may be gone too;
            send a fresh email in that case.
          </p>
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
          <label className={styles.label} htmlFor="flow-otp-code">
            {EMAIL_OTP_LENGTH}-digit code
          </label>
          <input
            id="flow-otp-code"
            className={styles.input}
            type="text"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={EMAIL_OTP_LENGTH}
            placeholder="12345678"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button
            className={styles.primary}
            type="submit"
            disabled={busy || code.trim().length < EMAIL_OTP_LENGTH}
          >
            {verifying ? 'Signing you in…' : 'Sign me in'}
          </button>
          {codeToggle}
          {error !== null && <p className={styles.error}>{error}</p>}
        </form>
      </div>
    );
  }

  if (sentTo !== null) {
    return (
      <div>
        {linkErrorNotice}
        <p className={styles.lede}>
          Check <strong>{sentTo}</strong> — your sign-in link is on the way. Open it on this device
          to continue, then tap the confirm button on the page it opens.
        </p>
        <form className={styles.form} onSubmit={handleSubmit}>
          <button className={styles.secondary} type="submit" disabled={busy}>
            {sending ? 'Sending…' : 'Resend the link'}
          </button>
          {codeToggle}
          <p className={styles.finePrint}>
            Only the newest email works — older links stop working.
          </p>
          {error !== null && <p className={styles.error}>{error}</p>}
        </form>
      </div>
    );
  }

  return (
    <div>
      {linkErrorNotice}
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
        <button className={styles.primary} type="submit" disabled={busy}>
          {sending
            ? 'Sending…'
            : linkError === null
              ? 'Email me a sign-in link'
              : 'Send me a fresh link'}
        </button>
        {codeToggle}
        <p className={styles.finePrint}>{finePrint}</p>
        {error !== null && <p className={styles.error}>{error}</p>}
      </form>
    </div>
  );
}
