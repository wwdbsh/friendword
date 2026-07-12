export const INTEREST_STATUSES = [
  'started',
  'verification_pending',
  'submitted',
  'accepted',
  'declined',
  'withdrawn',
  'blocked',
] as const;
export type InterestStatus = (typeof INTEREST_STATUSES)[number];

const TRANSITIONS: Record<InterestStatus, readonly InterestStatus[]> = {
  started: ['verification_pending', 'withdrawn'],
  verification_pending: ['submitted', 'withdrawn'],
  submitted: ['accepted', 'declined', 'withdrawn', 'blocked'],
  accepted: ['blocked'],
  declined: [],
  withdrawn: [],
  blocked: [],
};

export function canTransitionInterest(from: InterestStatus, to: InterestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
