import type { Metadata } from 'next';

import { MyInterestsView } from './MyInterestsView';

export const metadata: Metadata = {
  title: 'My interests — Friendword',
  robots: { index: false, follow: false },
};

export default function InterestsPage() {
  return <MyInterestsView />;
}
