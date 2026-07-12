-- Intro Room server side: participants list their open rooms with the other
-- party's display name (profiles are otherwise private), and leaving is a
-- server-validated transition. Messages, reports, and blocks already flow
-- through 0002's RLS; blocking instantly revokes room participation because
-- private.is_intro_room_participant checks blocks.

CREATE FUNCTION public.list_my_intro_rooms()
RETURNS TABLE (
  room_id UUID,
  campaign_id UUID,
  campaign_slug TEXT,
  other_user_id UUID,
  other_display_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  RETURN QUERY
  SELECT r.id,
         r.campaign_id,
         c.slug,
         CASE WHEN r.dater_user_id = caller THEN r.interested_user_id ELSE r.dater_user_id END,
         p.display_name,
         r.created_at
    FROM intro_rooms r
    JOIN campaigns c ON c.id = r.campaign_id
    JOIN profiles p
      ON p.user_id = CASE
           WHEN r.dater_user_id = caller THEN r.interested_user_id
           ELSE r.dater_user_id
         END
   WHERE caller IN (r.dater_user_id, r.interested_user_id)
     AND r.status = 'open'
     AND NOT EXISTS (
       SELECT 1 FROM blocks b
        WHERE (b.blocker_user_id = r.dater_user_id AND b.blocked_user_id = r.interested_user_id)
           OR (b.blocker_user_id = r.interested_user_id AND b.blocked_user_id = r.dater_user_id)
     )
   ORDER BY r.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_intro_rooms() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_intro_rooms() TO authenticated;

CREATE FUNCTION public.leave_intro_room(target_room_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  room intro_rooms;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT * INTO room
    FROM intro_rooms
   WHERE id = target_room_id
     AND caller IN (dater_user_id, interested_user_id)
     AND status = 'open'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room not found, not yours, or already closed';
  END IF;

  UPDATE intro_rooms SET status = 'left' WHERE id = room.id;
END;
$$;

REVOKE ALL ON FUNCTION public.leave_intro_room(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_intro_room(UUID) TO authenticated;
