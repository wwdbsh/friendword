DO $$
DECLARE
  required_table TEXT;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'users', 'profiles', 'dating_profiles', 'introducer_profiles',
    'pitch_drafts', 'pitch_assets', 'consent_requests', 'campaigns',
    'campaign_memberships', 'vouches', 'interests', 'intro_rooms',
    'messages', 'reports', 'blocks', 'verification_checks',
    'purchase_events', 'purchase_credit_ledger', 'campaign_entitlements',
    'analytics_events', 'provider_usage_events', 'cost_ledger'
  ]
  LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'required table % does not exist', required_table;
    END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name IN ('role', 'account_type', 'is_creator', 'is_dater')
  ) THEN
    RAISE EXCEPTION 'users contains a forbidden global role column';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO campaign_memberships (campaign_id, user_id, role)
    VALUES (
      '20000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      'ADDITIONAL_VOUCHER'
    );
    RAISE EXCEPTION 'duplicate campaign membership was accepted';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO pitch_drafts (
      id,
      created_by_user_id,
      subject_user_id,
      status
    )
    VALUES (
      '10000000-0000-0000-0000-000000000099',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      'approved'
    );

    INSERT INTO campaigns (id, pitch_draft_id, owner_user_id)
    VALUES (
      '20000000-0000-0000-0000-000000000099',
      '10000000-0000-0000-0000-000000000099',
      '00000000-0000-0000-0000-000000000002'
    );

    UPDATE campaign_memberships
       SET campaign_id = '20000000-0000-0000-0000-000000000099'
     WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
       AND user_id = '00000000-0000-0000-0000-000000000002';

    SET CONSTRAINTS campaigns_validate_owner, campaign_memberships_validate_owner IMMEDIATE;
    RAISE EXCEPTION 'moving an owner membership away from its campaign was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'campaign 20000000-0000-0000-0000-000000000001 owner must match its active DATER_OWNER membership' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
DECLARE
  contextual_role_count INTEGER;
BEGIN
  SELECT count(DISTINCT role)
    INTO contextual_role_count
    FROM campaign_memberships
   WHERE user_id = '00000000-0000-0000-0000-000000000001';

  IF contextual_role_count <> 2 THEN
    RAISE EXCEPTION 'one user cannot hold different roles across campaigns';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO campaign_memberships (campaign_id, user_id, role)
    VALUES (
      '20000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
      'DATER_OWNER'
    );
    RAISE EXCEPTION 'second active DATER_OWNER was accepted';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO blocks (blocker_user_id, blocked_user_id)
    VALUES (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001'
    );
    RAISE EXCEPTION 'self-block was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO purchase_events (
      purchaser_user_id,
      product_id,
      scope_type,
      scope_id,
      provider_event_id
    )
    VALUES (
      '00000000-0000-0000-0000-000000000001',
      'campaign_pass',
      'CAMPAIGN',
      '20000000-0000-0000-0000-000000000001',
      'invalid-scope-test'
    );
    RAISE EXCEPTION 'mismatched purchase scope was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'campaign purchase must be made by its owner' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO intro_rooms (
      campaign_id,
      dater_user_id,
      interested_user_id
    )
    VALUES (
      '20000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000001'
    );
    RAISE EXCEPTION 'intro room with invalid parties was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'intro room requires the campaign owner, an accepted interest, and unblocked parties' THEN
        RAISE;
      END IF;
  END;
END;
$$;

SELECT '01_schema_invariants.sql passed' AS result;
