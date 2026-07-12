import type { Metadata } from 'next';

type Props = { params: Promise<{ campaignSlug: string }> };

/**
 * Public pitch page: viewable without sign-up, noindex by default,
 * and only ever renders the minimal public projection
 * (see packages/contracts publicPitchSchema). Placeholder until the
 * pitch data layer lands.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PitchPage({ params }: Props) {
  const { campaignSlug } = await params;
  return (
    <main style={{ padding: 40, maxWidth: 640, margin: '0 auto' }}>
      <h1>Pitch: {campaignSlug}</h1>
      <p>This campaign pitch page is under construction.</p>
    </main>
  );
}
