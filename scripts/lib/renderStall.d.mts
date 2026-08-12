// Hand-written declarations for renderStall.mjs. The module stays plain ESM
// because scripts/ runs under bare `node` with no TypeScript loader (and the
// safety-escalation workflow runs it with no `pnpm install` at all); this file
// is what lets the typed tests in packages/data consume it.

export type StalledRenderRow = {
  readonly id: string;
  readonly status: string;
  readonly created_at: string | null;
};

export declare const RENDER_STALL_DEFAULT_MINUTES: number;
export declare const UNFINISHED_RENDER_STATUSES: readonly string[];

export declare function resolveStallMinutes(raw: string | undefined | null): number;
export declare function stallCutoffIso(nowMs: number, minutes: number): string;
export declare function renderStallQuery(input: {
  readonly cutoffIso: string;
  readonly limit: number;
}): string;
export declare function isStalledRender(
  createdAt: string | null | undefined,
  nowMs: number,
  minutes: number,
): boolean;
export declare function renderStallLines(input: {
  readonly rows: readonly StalledRenderRow[];
  readonly total: number;
  readonly minutes: number;
  readonly nowMs: number;
}): readonly string[];
