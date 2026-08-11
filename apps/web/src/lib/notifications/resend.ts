import 'server-only';

import { RESEND_REQUEST_TIMEOUT_MS } from './timeBudget';

/**
 * The one place that talks to Resend. Deliberately a plain fetch rather than
 * the SDK: one POST does not justify a dependency in a route whose bundle is
 * already budgeted, and the failure surface stays readable.
 *
 * The abort is RESEND_REQUEST_TIMEOUT_MS from timeBudget.ts rather than a
 * literal here, because it is the largest term in the sender's per-entry cost
 * and the pass's lease budget is derived from it — a raise made here alone
 * would quietly push a pass past its lease.
 *
 * PRIVACY: the recipient address is a parameter and NEVER a log line, and the
 * provider's response body is not surfaced either — a Resend error routinely
 * quotes the address it rejected, and this function's caller writes its return
 * value into the database (0058's last_error allows only a reason code, and
 * this is why).
 */
export type ResendResult = { readonly ok: true } | { readonly ok: false; readonly code: string };

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export async function sendEmailViaResend(input: {
  readonly apiKey: string;
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}): Promise<ResendResult> {
  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(RESEND_REQUEST_TIMEOUT_MS),
    });
  } catch (cause: unknown) {
    // Only the error NAME: a fetch failure message can echo the request.
    const name = cause instanceof Error ? cause.name : 'Error';
    return { ok: false, code: `resend_request_${name}` };
  }

  if (!response.ok) {
    // Status only. The body is not read, so it cannot be stored or logged.
    return { ok: false, code: `resend_http_${response.status}` };
  }
  return { ok: true };
}
