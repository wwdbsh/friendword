import { getPublicPitchAbsence, type PublicPitchAbsence } from '@friendword/data';

import { getPitchFixture } from '@/fixtures/pitch';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';

/**
 * Why a `/p/<slug>` URL has nothing to show (GAP-7 / T013). Asked only after the
 * published read has already come back null, and shared by the pitch page and
 * its interest step so both dead ends say the same thing.
 *
 * A fixture slug is never "ended": the demo has no campaign row, so there is no
 * window that could have closed. An unconfigured environment is never "ended"
 * either — it knows nothing about the campaign and must not imply it does.
 */
export async function loadPitchAbsence(campaignSlug: string): Promise<PublicPitchAbsence> {
  if (getPitchFixture(campaignSlug) !== undefined) {
    return 'missing';
  }
  const serviceClient = getSupabaseServiceClient();
  if (serviceClient === null) {
    return 'missing';
  }
  return getPublicPitchAbsence(serviceClient, campaignSlug);
}
