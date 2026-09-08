// T003 / 0058 — the sender pass, with the provider mocked.
//
// READ THIS BEFORE BELIEVING THE SUITE: mocking Resend proves the CONTROL FLOW
// around delivery (who is claimed, what is resolved, what is recorded), and
// nothing at all about whether a mail arrives. Real delivery is verified after
// the secrets are set, against the deployment — see the task report and
// docs/OPS.md. What IS proven here:
//   (a) the address is resolved from auth.users, handed to the provider, and
//       never returned in the pass summary (0058 decision 2);
//   (b) every entry is completed under the LEASE TOKEN it was claimed with;
//   (c) a provider failure is recorded as a short code, and a provider message
//       quoting the address never becomes that code;
//   (d) claiming nothing does nothing — no provider call, no completion.
/* global beforeEach, describe, expect, it, vi */

type ClaimedRow = {
  entryId: string;
  leaseToken: string;
  recipientUserId: string;
  eventType: string;
  pitchDraftId: string | null;
  attempts: number;
};

const mocks = vi.hoisted(() => ({
  claimNotifications: vi.fn(),
  completeNotification: vi.fn(async () => undefined),
  sendEmailViaResend: vi.fn(async (): Promise<{ ok: boolean; code?: string }> => ({ ok: true })),
}));

vi.mock('@friendword/data', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    claimNotifications: mocks.claimNotifications,
    completeNotification: mocks.completeNotification,
  };
});

vi.mock('@/lib/notifications/resend', () => ({
  sendEmailViaResend: mocks.sendEmailViaResend,
}));

import { runNotificationPass } from '@/lib/notifications/sender';
import {
  NOTIFICATION_BATCH_SIZE,
  NOTIFICATION_ENTRY_BUDGET_MS,
  NOTIFICATION_LEASE_SECONDS,
} from '@/lib/notifications/timeBudget';

const RECIPIENT = '11111111-1111-4111-8111-111111111111';
const ADDRESS = 'recipient@example.test';

function fakeServiceClient(
  options: {
    email?: string | null;
    displayName?: string | null;
    // T002 (Issue #71): the greeting uses the profile name only once its owner
    // has confirmed it, so the flag is part of the fixture.
    displayNameConfirmed?: boolean;
  } = {},
) {
  const adminLookups: string[] = [];
  const client = {
    auth: {
      admin: {
        getUserById: (id: string) => {
          adminLookups.push(id);
          const email = options.email === undefined ? ADDRESS : options.email;
          return Promise.resolve(
            email === null
              ? { data: { user: { id, email: null } }, error: null }
              : { data: { user: { id, email } }, error: null },
          );
        },
      },
    },
    from: () => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve({
            data: {
              display_name: options.displayName ?? 'Blair Dater',
              display_name_confirmed: options.displayNameConfirmed ?? true,
            },
            error: null,
          }),
      };
      return builder;
    },
  };
  return { client, adminLookups };
}

function row(overrides: Partial<ClaimedRow> = {}): ClaimedRow {
  return {
    entryId: '22222222-2222-4222-8222-222222222222',
    leaseToken: '33333333-3333-4333-8333-333333333333',
    recipientUserId: RECIPIENT,
    eventType: 'interest_received',
    pitchDraftId: null,
    attempts: 1,
    ...overrides,
  };
}

const CONFIG = {
  shareOrigin: 'https://share.example',
  apiKey: 'test-provider-key',
  from: 'Friendword <notify@share.example>',
};

describe('notification sender pass', () => {
  beforeEach(() => {
    mocks.claimNotifications.mockReset();
    mocks.completeNotification.mockReset();
    mocks.completeNotification.mockResolvedValue(undefined);
    mocks.sendEmailViaResend.mockReset();
    mocks.sendEmailViaResend.mockResolvedValue({ ok: true });
  });

  // T002 (Issue #71). `handle_new_auth_user` (0011) seeds `display_name` from
  // the email local-part. Greeting somebody as "blair.kim92" in an email both
  // reads as a mistake and repeats a fragment of their address back at them, so
  // the sender withholds it and `greeting()` falls back to its nameless form.
  it('greets without a name when the recipient has not confirmed one', async () => {
    mocks.claimNotifications.mockResolvedValue([row()]);
    const { client } = fakeServiceClient({
      displayName: 'blair.kim92',
      displayNameConfirmed: false,
    });

    await runNotificationPass(client as never, CONFIG);

    const sent = mocks.sendEmailViaResend.mock.calls[0]?.[0] as { html: string; text: string };
    expect(sent.html).toContain('Hi,');
    expect(sent.html).not.toContain('blair.kim92');
    expect(sent.text).not.toContain('blair.kim92');
  });

  it('greets by name once the recipient has confirmed one', async () => {
    mocks.claimNotifications.mockResolvedValue([row()]);
    const { client } = fakeServiceClient({ displayName: 'Blair', displayNameConfirmed: true });

    await runNotificationPass(client as never, CONFIG);

    const sent = mocks.sendEmailViaResend.mock.calls[0]?.[0] as { html: string };
    expect(sent.html).toContain('Hi Blair,');
  });

  it('[d] an empty claim sends nothing and completes nothing', async () => {
    mocks.claimNotifications.mockResolvedValue([]);
    const { client } = fakeServiceClient();

    const summary = await runNotificationPass(client as never, CONFIG);

    expect(summary).toEqual({ claimed: 0, sent: 0, failed: 0, failureCodes: [] });
    expect(mocks.sendEmailViaResend).not.toHaveBeenCalled();
    expect(mocks.completeNotification).not.toHaveBeenCalled();
  });

  it('[a] resolves the mailbox from auth.users and delivers to it', async () => {
    mocks.claimNotifications.mockResolvedValue([row()]);
    const { client, adminLookups } = fakeServiceClient();

    const summary = await runNotificationPass(client as never, CONFIG);

    expect(adminLookups).toEqual([RECIPIENT]);
    expect(mocks.sendEmailViaResend).toHaveBeenCalledTimes(1);
    const sent = mocks.sendEmailViaResend.mock.calls[0]?.[0] as { to: string; html: string };
    expect(sent.to).toBe(ADDRESS);
    expect(sent.html).toContain('https://share.example/inbox');
    expect(summary).toEqual({ claimed: 1, sent: 1, failed: 0, failureCodes: [] });
  });

  it('[a] the summary the route returns carries no address and no ids', async () => {
    mocks.claimNotifications.mockResolvedValue([row()]);
    const { client } = fakeServiceClient();

    const summary = await runNotificationPass(client as never, CONFIG);

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('@');
    expect(serialized).not.toContain(RECIPIENT);
    expect(serialized).not.toContain(row().entryId);
  });

  it('[b] every entry is completed with the lease token it was claimed with', async () => {
    mocks.claimNotifications.mockResolvedValue([
      row(),
      row({
        entryId: '44444444-4444-4444-8444-444444444444',
        leaseToken: '55555555-5555-4555-8555-555555555555',
        eventType: 'pitch_render_completed',
        pitchDraftId: '66666666-6666-4666-8666-666666666666',
      }),
    ]);
    const { client } = fakeServiceClient();

    await runNotificationPass(client as never, CONFIG);

    expect(mocks.completeNotification).toHaveBeenCalledTimes(2);
    expect(mocks.completeNotification.mock.calls[0]?.slice(1)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      { outcome: 'sent' },
    ]);
    expect(mocks.completeNotification.mock.calls[1]?.slice(1)).toEqual([
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      { outcome: 'sent' },
    ]);
  });

  it('[c] a provider refusal is recorded as a code, and the code holds no address', async () => {
    mocks.claimNotifications.mockResolvedValue([row()]);
    mocks.sendEmailViaResend.mockResolvedValue({ ok: false, code: 'resend_http_422' });
    const { client } = fakeServiceClient();

    const summary = await runNotificationPass(client as never, CONFIG);

    expect(summary).toEqual({
      claimed: 1,
      sent: 0,
      failed: 1,
      failureCodes: ['resend_http_422'],
    });
    const completion = mocks.completeNotification.mock.calls[0]?.[3] as {
      outcome: string;
      reason: string;
    };
    expect(completion.outcome).toBe('failed');
    expect(completion.reason).not.toContain('@');
  });

  it('[c] an account with no mailbox fails with a code instead of throwing', async () => {
    mocks.claimNotifications.mockResolvedValue([row()]);
    const { client } = fakeServiceClient({ email: null });

    const summary = await runNotificationPass(client as never, CONFIG);

    expect(mocks.sendEmailViaResend).not.toHaveBeenCalled();
    expect(summary.failureCodes).toEqual(['no_mailbox']);
  });

  it('a thrown provider error is caught and recorded, not propagated', async () => {
    mocks.claimNotifications.mockResolvedValue([row(), row({ entryId: 'second-entry-id' })]);
    mocks.sendEmailViaResend.mockRejectedValueOnce(new TypeError('network down'));
    const { client } = fakeServiceClient();

    const summary = await runNotificationPass(client as never, CONFIG);

    // The second entry still got its turn: one bad send does not abort a pass.
    expect(summary.claimed).toBe(2);
    expect(summary.sent).toBe(1);
    expect(summary.failureCodes).toEqual(['sender_TypeError']);
  });

  it('claims with the batch size and the lease the pass was budgeted for', async () => {
    mocks.claimNotifications.mockResolvedValue([]);
    const { client } = fakeServiceClient();

    await runNotificationPass(client as never, CONFIG);

    expect(mocks.claimNotifications).toHaveBeenCalledWith(client, {
      batchSize: NOTIFICATION_BATCH_SIZE,
      leaseSeconds: NOTIFICATION_LEASE_SECONDS,
    });
  });

  it('a render notification with no draft id is refused rather than mailed nowhere', async () => {
    mocks.claimNotifications.mockResolvedValue([
      row({ eventType: 'pitch_render_completed', pitchDraftId: null }),
    ]);
    const { client } = fakeServiceClient();

    const summary = await runNotificationPass(client as never, CONFIG);

    expect(mocks.sendEmailViaResend).not.toHaveBeenCalled();
    expect(summary.failureCodes).toEqual(['unroutable_event']);
  });
});

// [e] THE LEASE DEADLINE. Every entry in a batch is being delivered under a
// lease this pass was granted; once it lapses the row is claimable again. A
// pass that keeps sending past it is racing a second sender toward the same
// mailbox, and the result is the ONE failure the outbox cannot catch: the same
// person receives the same mail twice, from two senders both legitimately
// holding what they were given. jobRunner already carries this rule for
// renders; these tests carry it for mail.
describe('notification sender pass — the wall-clock deadline', () => {
  beforeEach(() => {
    mocks.claimNotifications.mockReset();
    mocks.completeNotification.mockReset();
    mocks.completeNotification.mockResolvedValue(undefined);
    mocks.sendEmailViaResend.mockReset();
    mocks.sendEmailViaResend.mockResolvedValue({ ok: true });
  });

  /** A clock that advances one full per-entry budget every time it is read. */
  function slowClock(startAt = 1_000_000): () => number {
    let current = startAt;
    return () => {
      const value = current;
      current += NOTIFICATION_ENTRY_BUDGET_MS;
      return value;
    };
  }

  it('[e] stops STARTING sends once the deadline passes, and leaves the rest leased', async () => {
    mocks.claimNotifications.mockResolvedValue([
      row({ entryId: 'aaaaaaaa-0000-4000-8000-000000000001' }),
      row({ entryId: 'aaaaaaaa-0000-4000-8000-000000000002' }),
      row({ entryId: 'aaaaaaaa-0000-4000-8000-000000000003' }),
      row({ entryId: 'aaaaaaaa-0000-4000-8000-000000000004' }),
    ]);
    const { client } = fakeServiceClient();

    // A deadline two entry-budgets wide: the clock is read once to start the
    // pass, once to gate the claim, then once per entry.
    const summary = await runNotificationPass(client as never, {
      ...CONFIG,
      passDeadlineMs: NOTIFICATION_ENTRY_BUDGET_MS * 3,
      now: slowClock(),
    });

    // Some entries were delivered and some were not even attempted — and the
    // ones not attempted were NOT completed, so they keep their lease and come
    // back on a later pass instead of being marked failed for being late.
    expect(summary.claimed).toBe(4);
    expect(summary.sent).toBeLessThan(4);
    expect(summary.sent).toBeGreaterThan(0);
    expect(summary.failed).toBe(0);
    expect(mocks.completeNotification).toHaveBeenCalledTimes(summary.sent);
    expect(mocks.sendEmailViaResend).toHaveBeenCalledTimes(summary.sent);
  });

  it('[e] refuses to CLAIM at all when the pass starts with no budget left', async () => {
    mocks.claimNotifications.mockResolvedValue([row()]);
    const { client } = fakeServiceClient();

    const summary = await runNotificationPass(client as never, {
      ...CONFIG,
      passDeadlineMs: 0,
      now: slowClock(),
    });

    // Claiming here would take out leases the pass cannot honour, which is a
    // worse outcome than doing nothing: the entries would sit 'sending' until
    // the lease lapsed, with an attempt burned for no delivery.
    expect(mocks.claimNotifications).not.toHaveBeenCalled();
    expect(summary).toEqual({ claimed: 0, sent: 0, failed: 0, failureCodes: [] });
  });

  it('[e] a whole default-size batch fits inside the real deadline', async () => {
    // The guard must not fire on a HEALTHY pass. With the shipped constants,
    // every entry in a full batch running to its cap still starts in time.
    mocks.claimNotifications.mockResolvedValue(
      Array.from({ length: NOTIFICATION_BATCH_SIZE }, (_unused, index) =>
        row({ entryId: `bbbbbbbb-0000-4000-8000-00000000000${index}` }),
      ),
    );
    const { client } = fakeServiceClient();

    const summary = await runNotificationPass(client as never, {
      ...CONFIG,
      now: slowClock(),
    });

    expect(summary.sent).toBe(NOTIFICATION_BATCH_SIZE);
  });
});
