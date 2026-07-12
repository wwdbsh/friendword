import type { Metadata } from 'next';

import { RoomsList } from './RoomsList';

export const metadata: Metadata = {
  title: 'Intro rooms — Friendword',
  robots: { index: false, follow: false },
};

export default function RoomsPage() {
  return <RoomsList />;
}
