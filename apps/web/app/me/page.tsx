import type { Metadata } from 'next';

import { MyPageView } from './MyPageView';

export const metadata: Metadata = {
  title: 'My page — Friendword',
  robots: { index: false, follow: false },
};

export default function MyPage() {
  return <MyPageView />;
}
