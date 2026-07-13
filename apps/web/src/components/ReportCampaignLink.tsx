'use client';

import { useState } from 'react';

import styles from './ReportCampaignLink.module.css';

const REASONS = [
  { value: 'impersonation', label: 'This page pretends to be someone else' },
  { value: 'safety_risk', label: 'Threatening or unsafe content' },
  { value: 'minor', label: 'Someone shown appears to be under 18' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'spam', label: 'Spam or scam' },
  { value: 'other', label: 'Something else' },
] as const;

type Phase = 'idle' | 'form' | 'sending' | 'done' | 'error';

/**
 * No-signup report affordance for the public pitch (audit P0-5): viewing
 * needs no account, so reporting must not either. Deliberately quiet —
 * a Trust Layer surface inside the campaign-expression page.
 */
export function ReportCampaignLink({ campaignSlug }: { readonly campaignSlug: string }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [reason, setReason] = useState<string>(REASONS[0].value);

  async function submit() {
    setPhase('sending');
    try {
      const response = await fetch('/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campaignSlug, reason }),
      });
      setPhase(response.ok ? 'done' : 'error');
    } catch {
      setPhase('error');
    }
  }

  if (phase === 'done') {
    return (
      <p className={styles.note} role="status">
        Report received. Our team reviews every report.
      </p>
    );
  }

  if (phase === 'idle') {
    return (
      <button className={styles.link} type="button" onClick={() => setPhase('form')}>
        Report this page
      </button>
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className={styles.label} htmlFor="report-campaign-reason">
        Why are you reporting this page?
      </label>
      <select
        id="report-campaign-reason"
        className={styles.select}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      >
        {REASONS.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.label}
          </option>
        ))}
      </select>
      <div className={styles.actions}>
        <button className={styles.submit} type="submit" disabled={phase === 'sending'}>
          {phase === 'sending' ? 'Sending…' : 'Send report'}
        </button>
        <button className={styles.link} type="button" onClick={() => setPhase('idle')}>
          Cancel
        </button>
      </div>
      {phase === 'error' && (
        <p className={styles.note} role="alert">
          The report did not go through. Please try again in a moment.
        </p>
      )}
    </form>
  );
}
