import type { Metadata } from 'next';
import { Bricolage_Grotesque, Unbounded } from 'next/font/google';
import type { ReactNode } from 'react';

import { ReferralTracker } from '@/components/ReferralTracker';

import './globals.css';
import { themeCss } from './theme-tokens';

const displayFont = Unbounded({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const bodyFont = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Friendword',
  description: "Dating, in your friends' words.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{themeCss}</style>
      </head>
      <body className={`${displayFont.variable} ${bodyFont.variable}`}>
        {/* Sign-in completes on whatever page the emailed link/code returns to
            (interest, inbox, rooms, consent, /auth/confirm) — so the referral
            claim must be armed on EVERY page, not only the pages that seed
            attribution. Renders nothing; claims are deduplicated per session. */}
        <ReferralTracker />
        {children}
      </body>
    </html>
  );
}
