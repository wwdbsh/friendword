import type { Metadata } from 'next';

import { KitView } from './KitView';

export const metadata: Metadata = {
  title: 'Social launch kit — Friendword',
  robots: { index: false, follow: false },
};

export default async function KitPage({
  params,
}: {
  readonly params: Promise<{ readonly draftId: string }>;
}) {
  const { draftId } = await params;

  return <KitView draftId={draftId} />;
}
