-- 0058: product events stop being silent. A durable, service-role-only outbox
-- records WHO must be told WHAT, and a separate sender resolves the address
-- and delivers the mail.
--
-- THE PROBLEM THIS CLOSES
--   Friendword sends zero product notifications today (audit FUN-3, NTF-1/2/5).
--   A Dater learns an interest arrived only by opening /inbox; a sender learns
--   the answer only by opening /rooms; an Introducer learns their MP4 finished
--   only by leaving the kit page open. Every one of those is a funnel stage
--   that dies of silence.
--
-- SIX DECISIONS, AND WHY
--
-- 1. AN OUTBOX, NOT AN INLINE SEND. Email is an external, slow, failing
--    dependency. Calling it from inside submit_interest/decide_interest would
--    put a third party inside a transaction that owns consent and matching:
--    a Resend outage would refuse interests. The event-producing transaction
--    therefore only writes a ROW, atomically with the event it describes, and
--    a sender drains the row later. A missed send is a stuck row, never a lost
--    interest.
--
-- 2. THE OUTBOX STORES NO ADDRESS AND NO PROSE. Rows carry the recipient's
--    user id, an event type from a closed set, and the landing-page parameters
--    (a draft id, for the one screen that needs one) — nothing else. Email
--    addresses live only in auth.users and are resolved by the sender at send
--    time, so a leak of this table is not a leak of a contact list, and no
--    profile text, note, or message body can ride along. The one free-text
--    column (`last_error`) is an operator label constrained by a POSITIVE
--    pattern — `^[a-z0-9_]{1,60}$`, the exact shape
--    complete_notification_outbox normalizes to. A denylist ("must not contain
--    '@'") only refuses the leak it was told to imagine; an allowlist refuses
--    every shape nobody thought of, including a phone number, a URL with a
--    query string, or a provider sentence that happens to omit the address.
--
-- 3. TRIGGERS, NOT RPC EDITS. The three producers are AFTER triggers on
--    `interests` and `media_render_jobs`, not new statements inside
--    submit_interest / decide_interest / complete_media_render_job. Reasons:
--    (a) the trigger binds EVERY writer, including a PATCH on interests and a
--    hand-written service query — the same argument 0044's
--    enforce_interest_accept_invariants makes for itself; (b) no RPC signature
--    changes, so the packages/data rpcContract surface is untouched; (c) this
--    repo's rule that a CREATE OR REPLACE must reproduce the whole current body
--    is exactly how a guard gets silently repealed, and three such copies
--    (0044's submit_interest and decide_interest, 0054's completion RPC) is
--    three chances to repeal one. The precedent is 0033's growth-event
--    triggers, which record the same three moments for analytics; these
--    triggers sit beside them.
--
-- 4. IDEMPOTENCY IS A UNIQUE INDEX, NOT SENDER BOOKKEEPING. One notification
--    per (event type, recipient, source row) — enforced by a unique index over
--    coalesce(interest_id, render_job_id), with the producers inserting
--    ON CONFLICT DO NOTHING. A retried transaction, a double UPDATE, or a
--    second worker cannot produce a second mail. Honestly stated consequence:
--    a sender who withdraws an interest and re-submits it later does NOT
--    trigger a second "interest received" mail, because it is the same
--    interests row (submit_interest upserts on (campaign_id, sender_user_id)).
--    Declined and accepted are terminal for that pair, so the accept/decline
--    mails have no such case.
--
-- 5. STALE ROWS ARE NOT SENT, THEY EXPIRE. The sender does not exist yet in
--    production and its secret is not set, so rows will accumulate before the
--    first drain. Mailing a week-old "someone sent interest" the day the switch
--    is flipped is worse than not mailing it: the recipient acts on a stale
--    state and the product looks broken. claim_notification_outbox therefore
--    terminalizes anything older than `notification_max_age_hours` (72) instead
--    of handing it to a sender, and records `expired_before_send`. The valve
--    has two mouths on purpose: an entry that was never attempted (attempts=0)
--    expires SILENTLY — that is the designed outcome of a queue that outlived
--    its sender — while an entry that was attempted and then aged out
--    (attempts>0) expires WITH an ops_alert, because something was trying and
--    failing and an operator never heard about it.
--
-- 5b. A RETRY IS NOT AN IMMEDIATE RETRY. The sender re-kicks itself and the
--    backstop runs daily, so without a time predicate a row that just failed
--    would be re-claimed by the very next pass — three attempts burned against
--    the same provider outage inside a second, and the ops_alert raised before
--    anyone could have fixed anything. claim_notification_outbox therefore
--    skips an entry whose `attempts` is above zero until `updated_at` is at
--    least attempts × 5 minutes old (5, then 10, then the budget is spent).
--    NO NEW COLUMN: `updated_at` is already maintained by the set_updated_at
--    trigger and is written by exactly the two events that matter — the claim
--    that started an attempt and the completion that ended one. 5 minutes is
--    chosen against the two real failure modes: a Resend rate limit
--    (`resend_http_429`) clears in well under a minute, and a DNS/domain
--    misconfiguration does not clear at all — so the interval only has to be
--    long enough that three attempts span ~15 minutes rather than one request,
--    and short enough to stay far inside the 72h expiry above.
--
-- 6. SERVICE ROLE ONLY, AND AN OPS KILL SWITCH. anon and authenticated hold
--    zero privileges on the table (0052 discipline: hosted default grants are
--    revoked and only what is needed is re-granted; here nothing is needed by a
--    client role, so nothing is granted, and RLS is on with no policy as the
--    second layer). `notification_email_enabled` is the one-UPDATE stop for a
--    send storm — the claim RPC returns no rows while it is off, so the switch
--    is enforced in the database and not only in the deployed route. It is
--    seeded 'off': the migration lands before the secrets exist, and the first
--    mail this product ever sends should be a deliberate operator act taken
--    with a mailbox open, not a side effect of a deploy (docs/OPS.md carries
--    the flip as a numbered step next to setting the secrets). It is an
--    operational valve, NOT a launch gate: the launch gates named in CLAUDE.md
--    are unchanged and untouched by this migration.
--
-- Regression coverage: supabase/tests/32_notification_outbox.sql.

-- ── 1. The outbox ────────────────────────────────────────────────────────
CREATE TABLE public.notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The recipient as an identity, never as an address (decision 2).
  recipient_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'interest_received',
    'interest_accepted',
    'interest_declined',
    'pitch_render_completed'
  )),
  -- The source row, which is also the idempotency key (decision 4). Exactly
  -- one is set; CASCADE means a deleted interest or job cannot leave a
  -- notification about a thing that no longer exists.
  interest_id UUID REFERENCES public.interests(id) ON DELETE CASCADE,
  render_job_id UUID REFERENCES public.media_render_jobs(id) ON DELETE CASCADE,
  -- The ONLY landing parameter any of the four screens needs: /kit/<draftId>.
  -- /inbox and /rooms are parameterless, so interest events carry no id here.
  pitch_draft_id UUID REFERENCES public.pitch_drafts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  -- An operator label, never a provider message (decision 2).
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_outbox_one_source CHECK (
    (interest_id IS NOT NULL)::INTEGER + (render_job_id IS NOT NULL)::INTEGER = 1
  ),
  -- The render event is the only one keyed on a job, and the only one that
  -- lands on a parameterized screen. Both directions, so neither can drift.
  CONSTRAINT notification_outbox_render_source CHECK (
    (event_type = 'pitch_render_completed') = (render_job_id IS NOT NULL)
  ),
  CONSTRAINT notification_outbox_render_names_draft CHECK (
    (event_type = 'pitch_render_completed') = (pitch_draft_id IS NOT NULL)
  ),
  -- A lease is a token AND a deadline, or it is nothing (0050/0054 precedent).
  CONSTRAINT notification_outbox_lease_is_whole CHECK (
    (status = 'sending') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT notification_outbox_sent_is_stamped CHECK (
    (status = 'sent') = (sent_at IS NOT NULL)
  ),
  -- Decision 2, as a constraint rather than a promise, and as an ALLOWLIST
  -- rather than a denylist: the column may hold a short reason code and
  -- nothing else. An address, a phone number, a URL, a provider sentence and
  -- anything else with a space, a dot or a digit-group in it are all refused
  -- by the same rule, instead of only the one shape a denylist anticipated.
  CONSTRAINT notification_outbox_error_is_a_reason_code CHECK (
    last_error IS NULL OR last_error ~ '^[a-z0-9_]{1,60}$'
  )
);

COMMENT ON TABLE public.notification_outbox IS
  'Durable queue of product notifications to deliver, service-role only. Rows are written by AFTER triggers in the same transaction as the event they describe and carry identities and landing parameters only — never an email address, a profile field, a note or a message body. One row per (event_type, recipient, source row): the unique index below is what makes a repeated event a structural no-op instead of a duplicate mail.';

COMMENT ON COLUMN public.notification_outbox.last_error IS
  'Short reason code for the last failed send. CHECK-constrained to the positive pattern ''^[a-z0-9_]{1,60}$'' — the exact shape complete_notification_outbox normalizes to — so a provider message quoting the recipient address, a phone number or a URL cannot be stored here at all, not merely the shapes a denylist anticipated.';

-- Decision 4: idempotency. coalesce() is immutable, so it may index.
CREATE UNIQUE INDEX notification_outbox_event_identity_idx
  ON public.notification_outbox (
    event_type, recipient_user_id, coalesce(interest_id, render_job_id)
  );

CREATE INDEX notification_outbox_claimable_idx
  ON public.notification_outbox (status, created_at, id);

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_outbox TO service_role;

CREATE TRIGGER notification_outbox_set_updated_at
BEFORE UPDATE ON public.notification_outbox
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The state machine as a BEFORE trigger so it binds every writer, including a
-- hand-written service query, not only the two RPCs below (0054 precedent):
--
--   (insert)  -> pending             producers only
--   pending   -> sending             claim
--   pending   -> failed              stale expiry (decision 5)
--   sending   -> sending             re-claim ONLY after the lease expired
--   sending   -> pending             a failed send with retries left
--   sending   -> sent | failed       delivered, or the budget is spent
--   sent      -> (nothing)           a delivered mail cannot be un-delivered
--   failed    -> (nothing)           terminal; an operator re-queues by
--                                    inserting a new row, not by reviving this
CREATE FUNCTION private.enforce_notification_outbox_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'notification outbox entry must be created pending';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.interest_id IS DISTINCT FROM OLD.interest_id
     OR NEW.render_job_id IS DISTINCT FROM OLD.render_job_id
     OR NEW.pitch_draft_id IS DISTINCT FROM OLD.pitch_draft_id THEN
    RAISE EXCEPTION 'notification outbox entry identity is immutable';
  END IF;
  IF NEW.status = OLD.status AND NEW.status <> 'sending' THEN
    RETURN NEW;
  END IF;

  CASE
    WHEN OLD.status = 'pending' AND NEW.status IN ('sending', 'failed') THEN
      NULL;
    WHEN OLD.status = 'sending' AND NEW.status IN ('pending', 'sent', 'failed') THEN
      NULL;
    WHEN OLD.status = 'sending' AND NEW.status = 'sending' THEN
      -- Issuing a new token over a live lease is the double-send bug this
      -- table exists to prevent.
      IF NEW.lease_token IS DISTINCT FROM OLD.lease_token
         AND OLD.lease_expires_at > now() THEN
        RAISE EXCEPTION 'notification outbox lease is still held';
      END IF;
    WHEN OLD.status = 'sent' THEN
      RAISE EXCEPTION 'a sent notification is final';
    ELSE
      RAISE EXCEPTION 'notification outbox entry cannot move from % to %',
        OLD.status, NEW.status;
  END CASE;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_notification_outbox_transition() FROM PUBLIC;

CREATE TRIGGER notification_outbox_enforce_transition
BEFORE INSERT OR UPDATE ON public.notification_outbox
FOR EACH ROW EXECUTE FUNCTION private.enforce_notification_outbox_transition();

-- ── 2. Operational configuration (decisions 5 and 6) ─────────────────────
-- The stop switch, seeded OFF (decision 6). This migration reaches hosted
-- before FRIENDWORD_NOTIFY_SECRET and FRIENDWORD_NOTIFY_FROM exist, so 'on'
-- would mean "the first mail this product ever sends goes out the moment the
-- last environment variable is saved" — with nobody watching. 'off' makes the
-- first send a deliberate act:
--
--   UPDATE app_config SET value = 'on' WHERE key = 'notification_email_enabled';
--
-- docs/OPS.md carries that line as a numbered step beside the secrets. It is
-- also, afterwards, the one-UPDATE stop for a send storm.
INSERT INTO public.app_config (key, value)
VALUES ('notification_email_enabled', 'off')
ON CONFLICT (key) DO NOTHING;

-- Older than this and the row is terminalized rather than sent (decision 5).
-- Read defensively: a hand-edited operational key is a string, and a typo here
-- must degrade to the default rather than stop the queue (see the claim RPC).
INSERT INTO public.app_config (key, value)
VALUES ('notification_max_age_hours', '72')
ON CONFLICT (key) DO NOTHING;

-- ── 3. The producers ─────────────────────────────────────────────────────
-- One enqueue helper so the "who may be notified" rule lives in one place.
-- A suspended or deleted recipient is skipped at write time; the claim RPC
-- re-checks, because an account can be suspended between enqueue and send.
CREATE FUNCTION private.enqueue_notification(
  target_recipient_user_id UUID,
  target_event_type TEXT,
  target_interest_id UUID,
  target_render_job_id UUID,
  target_pitch_draft_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF target_recipient_user_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = target_recipient_user_id
       AND account_status = 'active'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.notification_outbox (
    recipient_user_id, event_type, interest_id, render_job_id, pitch_draft_id
  )
  VALUES (
    target_recipient_user_id, target_event_type,
    target_interest_id, target_render_job_id, target_pitch_draft_id
  )
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_notification(UUID, TEXT, UUID, UUID, UUID)
  FROM PUBLIC;

-- S2 arrival and the two answers. Deliberately shaped like 0033's
-- interests_growth_events, on the same transitions, so the analytics record
-- and the notification can never disagree about what happened.
--
-- The dater is read from the campaign, not from the interest: `interests` has
-- no owner column, and the campaign owner IS the person whose inbox the
-- interest lands in.
CREATE FUNCTION private.interests_notification_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_status TEXT := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status::TEXT END;
  campaign_owner UUID;
BEGIN
  IF NEW.status = 'submitted' AND old_status IS DISTINCT FROM 'submitted' THEN
    SELECT owner_user_id INTO campaign_owner
      FROM public.campaigns WHERE id = NEW.campaign_id;
    PERFORM private.enqueue_notification(
      campaign_owner, 'interest_received', NEW.id, NULL, NULL
    );
  END IF;
  IF NEW.status = 'accepted' AND old_status IS DISTINCT FROM 'accepted' THEN
    PERFORM private.enqueue_notification(
      NEW.sender_user_id, 'interest_accepted', NEW.id, NULL, NULL
    );
  END IF;
  IF NEW.status = 'declined' AND old_status IS DISTINCT FROM 'declined' THEN
    PERFORM private.enqueue_notification(
      NEW.sender_user_id, 'interest_declined', NEW.id, NULL, NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.interests_notification_outbox() FROM PUBLIC;

CREATE TRIGGER interests_notification_outbox
AFTER INSERT OR UPDATE OF status ON public.interests
FOR EACH ROW EXECUTE FUNCTION private.interests_notification_outbox();

-- The finished MP4. The recipient is whoever asked for the export — the
-- Introducer on the kit page in every current flow — and requested_by_user_id
-- is SET NULL on account erasure (0054), which the enqueue helper reads as
-- "nobody to tell" rather than as an error.
CREATE FUNCTION private.media_render_jobs_notification_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
    PERFORM private.enqueue_notification(
      NEW.requested_by_user_id,
      'pitch_render_completed',
      NULL,
      NEW.id,
      NEW.pitch_draft_id
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.media_render_jobs_notification_outbox() FROM PUBLIC;

CREATE TRIGGER media_render_jobs_notification_outbox
AFTER UPDATE OF status ON public.media_render_jobs
FOR EACH ROW EXECUTE FUNCTION private.media_render_jobs_notification_outbox();

-- ── 4. The sender's two RPCs ─────────────────────────────────────────────
-- Claim is the only way to obtain work, and it hands out a lease, never an
-- address: the caller receives a user id and resolves the mailbox itself with
-- the service key. Concurrency safety is FOR UPDATE SKIP LOCKED (precedent
-- 0014:647, 0054:693) plus the lease, so two overlapping drains — an
-- opportunistic kick and the scheduled backstop firing together — cannot both
-- take the same row.
CREATE FUNCTION public.claim_notification_outbox(
  batch_size INTEGER DEFAULT 4,
  lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
  entry_id UUID,
  entry_lease_token UUID,
  entry_recipient_user_id UUID,
  entry_event_type TEXT,
  entry_pitch_draft_id UUID,
  entry_attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  -- One HTTP call per entry inside one invocation: a big batch is a slow
  -- request, not a faster queue. The kick chain drains the rest. 4 is not a
  -- taste: apps/web/src/lib/notifications/timeBudget.ts derives the sender's
  -- worst-case pass from it (batch × per-entry cap) and asserts that the pass
  -- finishes inside the lease below with margin to spare. Change one and its
  -- relation test fails.
  effective_batch INTEGER := least(greatest(coalesce(batch_size, 4), 1), 50);
  -- Long enough that a whole bounded pass — every entry hitting its provider
  -- timeout — still completes under the lease it was granted, with room for
  -- clock skew between this database and the sending instance. A lease that
  -- expires mid-pass is how an entry gets claimed by a second sender and
  -- mailed twice; 120s was not enough for a batch and this is the fix.
  effective_lease INTEGER := least(greatest(coalesce(lease_seconds, 300), 30), 900);
  max_age_hours INTEGER;
  stale_before TIMESTAMPTZ;
  -- Three tries then stop, matching the render queue: a provider that refused
  -- three times is an incident for an operator, not a row to retry forever.
  max_attempts CONSTANT INTEGER := 3;
  -- Decision 5b: attempt N waits N × this before it may be claimed again.
  retry_backoff_minutes CONSTANT INTEGER := 5;
BEGIN
  -- Decision 6: the switch is enforced here, so turning it off stops delivery
  -- even if a deployed sender keeps calling.
  IF coalesce(
       (SELECT value FROM app_config WHERE key = 'notification_email_enabled'),
       'off'
     ) <> 'on' THEN
    RETURN;
  END IF;

  -- Read the operational key DEFENSIVELY. `value` is a hand-editable string,
  -- and `value::INTEGER` on '72 ' or 'seventy-two' raises inside the claim —
  -- which would not merely mis-time the expiry, it would stop the entire
  -- queue, turning a typo into a total notification outage. A value that is
  -- not a plain integer is ignored and the 72h default stands; the whole
  -- window is clamped to [1, 8760] so neither '0' nor '999999999' can produce
  -- a nonsense interval.
  SELECT coalesce(
           (SELECT least(greatest(config.value::INTEGER, 1), 8760)
              FROM app_config config
             WHERE config.key = 'notification_max_age_hours'
               AND config.value ~ '^[0-9]{1,6}$'),
           72
         )
    INTO max_age_hours;
  stale_before := now() - make_interval(hours => max_age_hours);

  -- Decision 5: too old to be true any more. Terminalized, not sent — split in
  -- two by whether anything ever TRIED to send it.
  --
  -- (i) attempts = 0 — nobody ever tried. This is the designed outcome of a
  -- queue that outlived its sender (the switch was off, the secret was unset),
  -- it is expected, and alerting on it would fill the hourly ops queue with
  -- rows whose cause the operator already knows.
  UPDATE notification_outbox stale
     SET status = 'failed',
         lease_token = NULL,
         lease_expires_at = NULL,
         last_error = 'expired_before_send'
   WHERE stale.created_at <= stale_before
     AND stale.attempts = 0
     AND (
       stale.status = 'pending'
       OR (stale.status = 'sending' AND stale.lease_expires_at <= now())
     );

  -- (ii) attempts > 0 — something was trying and failing for three days
  -- without ever spending the retry budget (a sender that keeps crashing
  -- mid-send leaves a lapsed lease each time, never a completion). That is
  -- silence hiding a fault, so this half ALERTS. Same terminal state, a
  -- different reason code, so the two are distinguishable in the table too.
  WITH aged_out AS (
    UPDATE notification_outbox stale
       SET status = 'failed',
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error = 'expired_after_attempts'
     WHERE stale.created_at <= stale_before
       AND stale.attempts > 0
       AND (
         stale.status = 'pending'
         OR (stale.status = 'sending' AND stale.lease_expires_at <= now())
       )
    RETURNING stale.id, stale.event_type, stale.attempts
  )
  INSERT INTO ops_alerts (alert_type, detail)
  SELECT 'notification_send_failed',
         jsonb_build_object(
           'outbox_entry_id', aged_out.id,
           'event_type', aged_out.event_type,
           'attempts', aged_out.attempts,
           'reason', 'expired_after_attempts'
         )
    FROM aged_out;

  -- A sender that crashed mid-send leaves a lapsed lease behind. Once the
  -- retry budget is spent, hand the entry to an operator instead of letting it
  -- rot silently until the staleness sweep above eventually eats it. Ordered
  -- after that sweep on purpose: an ancient row expires quietly, a recent one
  -- that genuinely burned three attempts alerts.
  WITH exhausted AS (
    UPDATE notification_outbox spent
       SET status = 'failed',
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error = coalesce(spent.last_error, 'retry_budget_spent')
     WHERE spent.attempts >= max_attempts
       AND (
         spent.status = 'pending'
         OR (spent.status = 'sending' AND spent.lease_expires_at <= now())
       )
    RETURNING spent.id, spent.event_type, spent.attempts, spent.last_error
  )
  INSERT INTO ops_alerts (alert_type, detail)
  SELECT 'notification_send_failed',
         jsonb_build_object(
           'outbox_entry_id', exhausted.id,
           'event_type', exhausted.event_type,
           'attempts', exhausted.attempts,
           'reason', exhausted.last_error
         )
    FROM exhausted;

  -- A recipient suspended or erased after the row was written is not mailed;
  -- the row waits and eventually expires above.
  RETURN QUERY
  WITH claimable AS (
    SELECT entry.id
      FROM notification_outbox entry
      JOIN users recipient ON recipient.id = entry.recipient_user_id
     WHERE (
             entry.status = 'pending'
             OR (entry.status = 'sending' AND entry.lease_expires_at <= now())
           )
       AND entry.created_at > stale_before
       AND entry.attempts < max_attempts
       -- Decision 5b, the backoff. A fresh entry (attempts = 0) is claimable
       -- immediately — the whole point of the kick chain is that the mail goes
       -- out while the event is still true. An entry that has already burned
       -- an attempt waits attempts × 5 minutes from `updated_at`, which the
       -- set_updated_at trigger stamped at the claim that began the attempt or
       -- the completion that ended it. Without this the self-kick and the
       -- backstop would spend all three attempts against one outage inside a
       -- second and alert before anyone could act.
       AND (
         entry.attempts = 0
         OR entry.updated_at
              <= now() - make_interval(mins => entry.attempts * retry_backoff_minutes)
       )
       AND recipient.account_status = 'active'
     ORDER BY entry.created_at, entry.id
     FOR UPDATE OF entry SKIP LOCKED
     LIMIT effective_batch
  ), claimed AS (
    UPDATE notification_outbox target
       SET status = 'sending',
           attempts = target.attempts + 1,
           lease_token = gen_random_uuid(),
           lease_expires_at = now() + make_interval(secs => effective_lease)
      FROM claimable
     WHERE target.id = claimable.id
    RETURNING target.id,
              target.lease_token,
              target.recipient_user_id,
              target.event_type,
              target.pitch_draft_id,
              target.attempts,
              target.created_at
  )
  SELECT claimed.id,
         claimed.lease_token,
         claimed.recipient_user_id,
         claimed.event_type,
         claimed.pitch_draft_id,
         claimed.attempts
    FROM claimed
   ORDER BY claimed.created_at, claimed.id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_notification_outbox(INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_outbox(INTEGER, INTEGER)
  TO service_role;

COMMENT ON FUNCTION public.claim_notification_outbox(INTEGER, INTEGER) IS
  'Leases up to batch_size outbox entries with FOR UPDATE SKIP LOCKED. Returns recipient USER IDS, never addresses. Returns nothing while app_config notification_email_enabled is not ''on'' (seeded ''off''). A previously attempted entry is skipped until attempts x 5 minutes have passed since updated_at, so one outage cannot spend the whole retry budget at once. Entries older than notification_max_age_hours are terminalized instead of handed out — silently as expired_before_send when nothing ever tried them, and as expired_after_attempts WITH an ops_alert when something did. A malformed notification_max_age_hours degrades to 72 rather than failing the claim. Entries whose recipient is no longer an active account are never claimed.';

-- The other half of the lease. The reason is normalized into the exact shape
-- the column CHECK allows ('^[a-z0-9_]{1,60}$') before it is stored: provider
-- error text routinely quotes the recipient's address, and this table must
-- never hold one (decision 2). Normalization and the constraint are two
-- independent layers on purpose — if this function is ever bypassed, the
-- constraint still refuses everything that is not a reason code.
CREATE FUNCTION public.complete_notification_outbox(
  entry_id UUID,
  entry_lease_token UUID,
  outcome TEXT,
  reason TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  entry notification_outbox;
  reason_code TEXT;
  max_attempts CONSTANT INTEGER := 3;
BEGIN
  IF outcome NOT IN ('sent', 'failed') THEN
    RAISE EXCEPTION 'notification outcome must be sent or failed';
  END IF;

  SELECT * INTO entry
    FROM notification_outbox
   WHERE id = entry_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'notification outbox entry not found';
  END IF;
  -- The lease IS the authorization (0050/0054): an expired holder's entry may
  -- already belong to another sender and must not overwrite its result.
  IF entry.status <> 'sending'
     OR entry.lease_token IS DISTINCT FROM entry_lease_token
     OR entry.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'notification outbox lease is not held';
  END IF;

  IF outcome = 'sent' THEN
    UPDATE notification_outbox
       SET status = 'sent',
           sent_at = now(),
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error = NULL
     WHERE id = entry.id;
    RETURN;
  END IF;

  reason_code := btrim(
    regexp_replace(lower(btrim(coalesce(reason, ''))), '[^a-z0-9]+', '_', 'g'),
    '_'
  );
  reason_code := coalesce(nullif(substr(reason_code, 1, 60), ''), 'send_failed');

  UPDATE notification_outbox
     SET status = CASE WHEN entry.attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
         lease_token = NULL,
         lease_expires_at = NULL,
         last_error = reason_code
   WHERE id = entry.id;

  IF entry.attempts >= max_attempts THEN
    -- Terminal failure is an operator event: the hourly safety-escalation pass
    -- reads ops_alerts and turns an unresolved row into a notification mail to
    -- the repo owner (docs/OPS.md). The detail carries ids and a code only.
    INSERT INTO ops_alerts (alert_type, detail)
    VALUES (
      'notification_send_failed',
      jsonb_build_object(
        'outbox_entry_id', entry.id,
        'event_type', entry.event_type,
        'attempts', entry.attempts,
        'reason', reason_code
      )
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_notification_outbox(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_notification_outbox(UUID, UUID, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.complete_notification_outbox(UUID, UUID, TEXT, TEXT) IS
  'Records a delivery result under a held lease. sent is final; failed re-queues while attempts remain (and the claim RPC will not hand it out again for attempts x 5 minutes) and terminalizes with an ops_alert when the budget is spent. The reason is normalized to the ^[a-z0-9_]{1,60}$ shape the column CHECK allows, so provider text quoting the recipient address can never be persisted.';
