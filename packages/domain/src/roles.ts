/**
 * Friendword has no account types. A user's role exists only in the context
 * of a specific campaign/pitch/interest resource (see FRIENDWORD_HANDOFF.md,
 * "단일 계정과 컨텍스트 역할 원칙"). Never persist these as a global user field.
 */
export const MEMBERSHIP_ROLES = ['DATER_OWNER', 'INTRODUCER', 'ADDITIONAL_VOUCHER'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/** An interested person is linked via interests.sender_user_id, not membership. */
export type ContextRole = MembershipRole | 'INTEREST_SENDER';
