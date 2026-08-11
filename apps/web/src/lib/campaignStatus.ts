/**
 * One reading of an owned campaign's status for every web surface (T009).
 *
 * H-5 consistency: the public page 404s once `ends_at` passes even before the
 * expiration job flips the row, so no screen may offer Live/Resume — or call a
 * campaign live in a summary — for a campaign whose window already ended. The
 * inbox has enforced this since T004; the /me hub reads the same rows, so the
 * rule was lifted out of InboxView rather than written a second time.
 */
export type OwnedCampaignStatusInput = {
  readonly status: string;
  readonly endsAt: string | null;
};

export function displayCampaignStatus(campaign: OwnedCampaignStatusInput): string {
  if (campaign.status === 'expired') {
    return 'expired';
  }
  if (
    (campaign.status === 'published' || campaign.status === 'paused') &&
    campaign.endsAt !== null &&
    new Date(campaign.endsAt).getTime() <= Date.now()
  ) {
    return 'expired';
  }
  return campaign.status;
}

/** The badge word a person reads for a display status. */
export function campaignStatusLabel(displayStatus: string): string {
  if (displayStatus === 'published') {
    return 'Live';
  }
  if (displayStatus === 'paused') {
    return 'Paused';
  }
  if (displayStatus === 'expired') {
    return 'Ended';
  }
  return 'Down';
}
