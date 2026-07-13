-- Second audit (docs/FRIENDWORD_SECOND_AUDIT_HANDOFF_2026-07-13.md) Slice 0:
-- real payments and the public beta stay server-side blocked until the
-- P0 fixes land and the Slice 10 release gate passes. Both switches are
-- service-role-only app_config rows, default 'off'. Local test databases
-- opt in through seed.sql; hosted keeps these defaults until the release
-- gate flips them deliberately.

INSERT INTO public.app_config (key, value)
VALUES
  ('real_payments_enabled', 'off'),
  ('public_beta_enabled', 'off')
ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION private.real_payments_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT value = 'on' FROM public.app_config WHERE key = 'real_payments_enabled'),
    false
  );
$$;

CREATE FUNCTION private.public_beta_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT value = 'on' FROM public.app_config WHERE key = 'public_beta_enabled'),
    false
  );
$$;

REVOKE ALL ON FUNCTION private.real_payments_enabled() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.public_beta_enabled() FROM PUBLIC;

-- Purchases are blocked at the earliest server step (intent issuance) so
-- no client can even start a purchase while the gate is closed. Triggers
-- rather than RPC edits: they survive later redefinitions of
-- issue_purchase_intent and catch any direct-insert path.
CREATE FUNCTION private.block_purchase_intents_until_launch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.real_payments_enabled() THEN
    RAISE EXCEPTION 'purchases are not available yet';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.block_purchase_intents_until_launch() FROM PUBLIC;

CREATE TRIGGER purchase_intents_launch_gate
BEFORE INSERT ON public.purchase_intents
FOR EACH ROW EXECUTE FUNCTION private.block_purchase_intents_until_launch();

-- Defence in depth: even if an intent leaked through, a PRODUCTION-store
-- RevenueCat event cannot grant benefits while real payments are off.
-- Sandbox events keep flowing so the Slice 3/10 sandbox validation works.
CREATE FUNCTION private.block_production_purchase_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.real_payments_enabled()
     AND upper(coalesce(NEW.environment, '')) = 'PRODUCTION' THEN
    RAISE EXCEPTION 'real payments are disabled until launch readiness gates pass';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.block_production_purchase_events() FROM PUBLIC;

CREATE TRIGGER purchase_events_production_gate
BEFORE INSERT ON public.purchase_events
FOR EACH ROW EXECUTE FUNCTION private.block_production_purchase_events();

-- Interest submission is the moment an external stranger enters the
-- funnel; it stays closed until the public beta gate opens. Internal QA
-- (local suites via seed.sql, advisor-run production E2E via service
-- role) opts in explicitly and restores the gate afterwards.
CREATE FUNCTION private.block_interests_until_public_beta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.public_beta_enabled() THEN
    RAISE EXCEPTION 'Friendword is in a private beta; interest submissions are not open yet';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.block_interests_until_public_beta() FROM PUBLIC;

CREATE TRIGGER interests_launch_gate
BEFORE INSERT ON public.interests
FOR EACH ROW EXECUTE FUNCTION private.block_interests_until_public_beta();
