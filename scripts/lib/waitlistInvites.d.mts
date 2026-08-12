// Hand-written declarations for waitlistInvites.mjs. The module stays plain
// ESM because scripts/ runs under bare `node` with no TypeScript loader; this
// file is what lets the typed tests in packages/data consume it.

export type WaitlistSignupRow = {
  readonly id: string;
  readonly source: string | null;
  readonly created_at: string | null;
};

export type WaitlistSummary = {
  readonly total: number;
  readonly oldestDays: number;
  readonly bySource: string;
};

export type InviteEmail = {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

export type InviteArgs = {
  readonly help: boolean;
  readonly send: boolean;
  readonly forget: boolean;
  readonly limit: number;
  readonly inviteUrl: string | null;
};

export declare function containsAddress(line: string): boolean;
export declare function inviteFailureCode(raw: unknown): string;
export declare function sourceLabel(source: string | null | undefined): string;
export declare function summarizeSignups(
  rows: readonly WaitlistSignupRow[],
  nowMs: number,
): WaitlistSummary;
export declare function inviteEmail(input: { readonly inviteUrl: string }): InviteEmail;
export declare function parseInviteArgs(argv: readonly string[]): InviteArgs;
export declare function parseForgetInput(raw: string | null | undefined): readonly string[];
