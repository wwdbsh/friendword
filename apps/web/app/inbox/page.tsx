import type { Metadata } from 'next';

import { InboxView } from './InboxView';

export const metadata: Metadata = {
  title: 'Interest inbox — Friendword',
  robots: { index: false, follow: false },
};

export default function InboxPage() {
  return <InboxView />;
}
