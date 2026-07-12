import type { Metadata } from 'next';

import { ConsentFlow } from './ConsentFlow';

type ConsentPageProps = {
  readonly params: Promise<{ readonly token: string }>;
};

export const metadata: Metadata = {
  title: 'Your friend made you a pitch — Friendword',
  description: 'Review and approve the pitch your friend recorded about you.',
  robots: { index: false, follow: false },
};

export default async function ConsentPage({ params }: ConsentPageProps) {
  const { token } = await params;

  return <ConsentFlow token={token} />;
}
