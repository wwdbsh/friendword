import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ConfirmSignIn } from './ConfirmSignIn';

export const metadata: Metadata = {
  title: 'Confirm your sign-in — Friendword',
  description: 'Finish signing in to Friendword.',
  robots: { index: false, follow: false },
};

export default function AuthConfirmPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmSignIn />
    </Suspense>
  );
}
