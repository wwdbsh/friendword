import type { Metadata } from 'next';

import { RoomView } from './RoomView';

type RoomPageProps = {
  readonly params: Promise<{ readonly roomId: string }>;
};

export const metadata: Metadata = {
  title: 'Intro room — Friendword',
  robots: { index: false, follow: false },
};

export default async function RoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;

  return <RoomView roomId={roomId} />;
}
