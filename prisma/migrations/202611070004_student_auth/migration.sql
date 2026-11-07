-- student-auth: verified campus membership, location-scoped staff authority,
-- and campus-aware row-level security for the Supabase browser roles.
--
-- Hosted Supabase already provides the anon/authenticated roles, auth.users,
-- and auth.uid(). Plain PostgreSQL (local, CI) gets a minimal compatible shim,
-- created only when the real objects are absent, so this migration never
-- replaces Supabase's own definitions.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    -- Shim only: the subset of Supabase's auth.users used below.
    CREATE TABLE auth.users (
      id UUID PRIMARY KEY,
      email TEXT,
      email_confirmed_at TIMESTAMPTZ
    );
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    -- Same claim lookup as Supabase's auth.uid().
    CREATE FUNCTION auth.uid() RETURNS UUID
    LANGUAGE sql STABLE
    AS $fn$
      SELECT nullif(coalesce(
        current_setting('request.jwt.claim.sub', true),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
      ), '')::uuid
    $fn$;
  END IF;
END $$;

-- Private helpers. Supabase's Data API exposes only `public`, so `app` is not
-- callable over HTTP; it is used by RLS policies and by other tasks' RPCs.
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO authenticated;

-- Raise an API_CONTRACT error code; PostgREST returns it in error.message.
CREATE FUNCTION app.fail(code TEXT, detail TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql VOLATILE
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = code, DETAIL = coalesce(detail, code);
END $$;

-- Application user for the verified session, or NULL.
CREATE FUNCTION app.current_user_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id FROM public."User" u
  WHERE auth.uid() IS NOT NULL AND u."authSubject" = auth.uid()
$$;

-- The caller's verified membership in a campus, or NULL.
CREATE FUNCTION app.member_id(campus UUID) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.id FROM public."Membership" m
  WHERE m."campusId" = campus
    AND m."userId" = app.current_user_id()
    AND m."verifiedAt" IS NOT NULL
$$;

CREATE FUNCTION app.is_verified_member(campus UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$ SELECT app.member_id(campus) IS NOT NULL $$;

CREATE FUNCTION app.is_campus_admin(campus UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."Membership" m
    WHERE m.id = app.member_id(campus) AND m.role = 'ADMIN'
  )
$$;

-- Staff authority is per location: a verified STAFF/ADMIN membership in the
-- location's campus plus an explicit StaffAssignment for that location.
CREATE FUNCTION app.is_location_staff(location UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."Location" l
    JOIN public."Membership" m ON m."campusId" = l."campusId"
    JOIN public."StaffAssignment" s
      ON s."membershipId" = m.id AND s."locationId" = l.id AND s."campusId" = l."campusId"
    WHERE l.id = location
      AND m.id = app.member_id(l."campusId")
      AND m.role IN ('STAFF', 'ADMIN')
  )
$$;

-- Conversation participation, evaluated without re-entering the
-- ConversationParticipant policy (avoids recursive RLS).
CREATE FUNCTION app.is_conversation_participant(conversation UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ConversationParticipant" p
    WHERE p."conversationId" = conversation AND p."memberId" = app.member_id(p."campusId")
  )
$$;

-- Guard for RPCs written by other tasks. Returns the caller's membership id.
-- UNAUTHENTICATED without a session; FORBIDDEN without verified membership.
CREATE FUNCTION app.require_verified_member(campus UUID) RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE member UUID;
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  member := app.member_id(campus);
  IF member IS NULL THEN PERFORM app.fail('FORBIDDEN', 'verified campus membership required'); END IF;
  RETURN member;
END $$;

-- Guard for staff RPCs. Returns the caller's membership id.
CREATE FUNCTION app.require_location_staff(location UUID) RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE campus UUID;
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  SELECT l."campusId" INTO campus FROM public."Location" l WHERE l.id = location;
  -- Unknown or other-campus locations are indistinguishable: NOT_FOUND.
  IF campus IS NULL OR NOT app.is_verified_member(campus) THEN PERFORM app.fail('NOT_FOUND'); END IF;
  IF NOT app.is_location_staff(location) THEN PERFORM app.fail('FORBIDDEN', 'staff assignment required for this location'); END IF;
  RETURN app.member_id(campus);
END $$;

-- Session contract. Contains no email or other contact data.
CREATE FUNCTION public.my_session() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  SELECT jsonb_build_object(
    'user', CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id', u.id, 'display_name', u."displayName") END,
    'email_confirmed', coalesce((SELECT a.email_confirmed_at IS NOT NULL FROM auth.users a WHERE a.id = auth.uid()), false),
    'memberships', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'membership_id', m.id,
        'campus_id', c.id,
        'campus_name', c.name,
        'campus_is_demo', c."isDemo",
        'role', lower(m.role::text),
        'verified', m."verifiedAt" IS NOT NULL,
        'staff_location_ids', coalesce((
          SELECT jsonb_agg(s."locationId" ORDER BY s."locationId")
          FROM public."StaffAssignment" s
          WHERE s."membershipId" = m.id AND m.role IN ('STAFF', 'ADMIN') AND m."verifiedAt" IS NOT NULL
        ), '[]'::jsonb)
      ) ORDER BY c.name)
      FROM public."Membership" m JOIN public."Campus" c ON c.id = m."campusId"
      WHERE m."userId" = u.id
    ), '[]'::jsonb)
  ) INTO result
  FROM (SELECT app.current_user_id() AS uid) s0
  LEFT JOIN public."User" u ON u.id = s0.uid;
  RETURN result;
END $$;

-- Create or rename the caller's profile. The private email is copied from the
-- authenticated account; display_name is the only caller-supplied value.
CREATE FUNCTION public.upsert_profile(display_name TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE account_email TEXT; name TEXT := btrim(display_name);
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  IF name IS NULL OR char_length(name) NOT BETWEEN 1 AND 60 THEN
    PERFORM app.fail('VALIDATION_ERROR', 'display_name must be 1-60 characters');
  END IF;
  SELECT a.email INTO account_email FROM auth.users a WHERE a.id = auth.uid();
  IF account_email IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  -- Never silently attach an existing record to a different sign-in.
  IF EXISTS (SELECT 1 FROM public."User" u
             WHERE u.email = lower(account_email) AND u."authSubject" IS DISTINCT FROM auth.uid()) THEN
    PERFORM app.fail('INVALID_STATE', 'this email already belongs to another profile');
  END IF;
  INSERT INTO public."User" (id, "authSubject", email, "displayName")
  VALUES (gen_random_uuid(), auth.uid(), lower(account_email), name)
  ON CONFLICT ("authSubject") DO UPDATE SET "displayName" = EXCLUDED."displayName";
  RETURN public.my_session();
END $$;

-- University-domain verification. The account email must be confirmed by
-- Supabase Auth and its domain must be configured for the campus. Always
-- grants STUDENT; never changes an existing role.
CREATE FUNCTION public.verify_campus_membership(campus_slug TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  account RECORD;
  campus_row RECORD;
  user_row UUID;
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  SELECT a.email, a.email_confirmed_at INTO account FROM auth.users a WHERE a.id = auth.uid();
  IF account.email IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  IF account.email_confirmed_at IS NULL THEN
    PERFORM app.fail('FORBIDDEN', 'confirm your university email first');
  END IF;
  SELECT c.id, c."emailDomains" INTO campus_row FROM public."Campus" c WHERE c.slug = campus_slug;
  IF campus_row.id IS NULL THEN PERFORM app.fail('NOT_FOUND'); END IF;
  IF NOT EXISTS (
    SELECT 1 FROM unnest(campus_row."emailDomains") d
    WHERE lower(d) = lower(split_part(account.email, '@', 2))
  ) OR position('@' IN account.email) = 0 THEN
    PERFORM app.fail('FORBIDDEN', 'email domain is not configured for this campus');
  END IF;
  user_row := app.current_user_id();
  IF user_row IS NULL THEN PERFORM app.fail('VALIDATION_ERROR', 'create a profile first'); END IF;
  INSERT INTO public."Membership" (id, "campusId", "userId", role, "verifiedAt")
  VALUES (gen_random_uuid(), campus_row.id, user_row, 'STUDENT', now())
  ON CONFLICT ("userId", "campusId") DO UPDATE
    SET "verifiedAt" = coalesce(public."Membership"."verifiedAt", now());
  RETURN public.my_session();
END $$;

-- Campus admins grant location staff authority. Students cannot reach this
-- path for themselves; target and location must share the admin's campus.
CREATE FUNCTION public.assign_staff(membership_id UUID, location_id UUID) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE campus UUID; target RECORD;
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  SELECT l."campusId" INTO campus FROM public."Location" l WHERE l.id = location_id;
  IF campus IS NULL OR NOT app.is_verified_member(campus) THEN PERFORM app.fail('NOT_FOUND'); END IF;
  IF NOT app.is_campus_admin(campus) THEN PERFORM app.fail('FORBIDDEN', 'campus admin required'); END IF;
  SELECT m.id, m.role, m."verifiedAt" INTO target
  FROM public."Membership" m WHERE m.id = membership_id AND m."campusId" = campus;
  IF target.id IS NULL THEN PERFORM app.fail('NOT_FOUND'); END IF;
  IF target."verifiedAt" IS NULL THEN PERFORM app.fail('INVALID_STATE', 'membership is not verified'); END IF;
  IF target.role = 'STUDENT' THEN
    UPDATE public."Membership" SET role = 'STAFF' WHERE id = target.id;
  END IF;
  INSERT INTO public."StaffAssignment" (id, "campusId", "membershipId", "locationId")
  VALUES (gen_random_uuid(), campus, target.id, location_id)
  ON CONFLICT ("membershipId", "locationId") DO NOTHING;
  RETURN jsonb_build_object('membership_id', target.id, 'location_id', location_id, 'assigned', true);
END $$;

CREATE FUNCTION public.revoke_staff(membership_id UUID, location_id UUID) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE campus UUID;
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  SELECT l."campusId" INTO campus FROM public."Location" l WHERE l.id = location_id;
  IF campus IS NULL OR NOT app.is_verified_member(campus) THEN PERFORM app.fail('NOT_FOUND'); END IF;
  IF NOT app.is_campus_admin(campus) THEN PERFORM app.fail('FORBIDDEN', 'campus admin required'); END IF;
  DELETE FROM public."StaffAssignment" s
  WHERE s."membershipId" = membership_id AND s."locationId" = location_id AND s."campusId" = campus;
  RETURN jsonb_build_object('membership_id', membership_id, 'location_id', location_id, 'assigned', false);
END $$;

-- Representative student-only mutation: reporting a listing.
CREATE FUNCTION public.report_listing(listing_id UUID, reason TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE campus UUID; reporter UUID; report UUID := gen_random_uuid(); text_reason TEXT := btrim(reason);
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  SELECT l."campusId" INTO campus FROM public."Listing" l WHERE l.id = listing_id;
  IF campus IS NULL OR app.member_id(campus) IS NULL THEN
    -- Other-campus objects look exactly like missing ones.
    IF campus IS NOT NULL AND EXISTS (
      SELECT 1 FROM public."Membership" m WHERE m."campusId" = campus AND m."userId" = app.current_user_id()
    ) THEN
      PERFORM app.fail('FORBIDDEN', 'verified campus membership required');
    END IF;
    PERFORM app.fail('NOT_FOUND');
  END IF;
  reporter := app.require_verified_member(campus);
  IF text_reason IS NULL OR char_length(text_reason) NOT BETWEEN 3 AND 500 THEN
    PERFORM app.fail('VALIDATION_ERROR', 'reason must be 3-500 characters');
  END IF;
  INSERT INTO public."Report" (id, "campusId", "reporterId", "listingId", reason)
  VALUES (report, campus, reporter, listing_id, text_reason);
  RETURN jsonb_build_object('report_id', report, 'listing_id', listing_id);
END $$;

-- Privileges: anon gets nothing (the static catalog serves anonymous browsing).
-- authenticated may only read through the policies below and call the RPCs.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.my_session(), public.upsert_profile(TEXT), public.verify_campus_membership(TEXT),
  public.assign_staff(UUID, UUID), public.revoke_staff(UUID, UUID), public.report_listing(UUID, TEXT)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.my_session(), public.upsert_profile(TEXT), public.verify_campus_membership(TEXT),
  public.assign_staff(UUID, UUID), public.revoke_staff(UUID, UUID), public.report_listing(UUID, TEXT)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  app.current_user_id(), app.member_id(UUID), app.is_verified_member(UUID),
  app.is_campus_admin(UUID), app.is_location_staff(UUID), app.is_conversation_participant(UUID)
TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON
  "Campus", "User", "Membership", "Location", "StaffAssignment", "Category",
  "Listing", "FoodDetails", "StockLot", "StockFoodDetails", "Reservation",
  "InventoryEvent", "Conversation", "ConversationParticipant", "Message", "Report"
TO authenticated;

-- Read policies. There are no INSERT/UPDATE/DELETE policies: every mutation
-- goes through a SECURITY DEFINER RPC that checks authority itself.
CREATE POLICY campus_read ON "Campus" FOR SELECT TO authenticated USING (true);
CREATE POLICY category_read ON "Category" FOR SELECT TO authenticated USING (true);
CREATE POLICY user_read_self ON "User" FOR SELECT TO authenticated
  USING ("authSubject" = auth.uid());
CREATE POLICY membership_read_self ON "Membership" FOR SELECT TO authenticated
  USING ("userId" = app.current_user_id() OR app.is_campus_admin("campusId"));
CREATE POLICY staff_assignment_read ON "StaffAssignment" FOR SELECT TO authenticated
  USING ("membershipId" = app.member_id("campusId") OR app.is_campus_admin("campusId"));
CREATE POLICY location_read ON "Location" FOR SELECT TO authenticated
  USING (app.is_verified_member("campusId"));
CREATE POLICY listing_read ON "Listing" FOR SELECT TO authenticated
  USING (app.is_verified_member("campusId") AND (status <> 'REMOVED' OR "authorId" = app.member_id("campusId")));
CREATE POLICY food_details_read ON "FoodDetails" FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM "Listing" l WHERE l.id = "listingId"));
CREATE POLICY stock_read ON "StockLot" FOR SELECT TO authenticated
  USING (app.is_verified_member("campusId"));
CREATE POLICY stock_food_read ON "StockFoodDetails" FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM "StockLot" s WHERE s.id = "stockLotId"));
CREATE POLICY reservation_read ON "Reservation" FOR SELECT TO authenticated
  USING ("memberId" = app.member_id("campusId")
    OR EXISTS (SELECT 1 FROM "StockLot" s WHERE s.id = "stockLotId" AND app.is_location_staff(s."locationId")));
CREATE POLICY inventory_event_read ON "InventoryEvent" FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM "StockLot" s WHERE s.id = "stockLotId" AND app.is_location_staff(s."locationId")));
CREATE POLICY conversation_read ON "Conversation" FOR SELECT TO authenticated
  USING (app.is_conversation_participant(id));
CREATE POLICY participant_read ON "ConversationParticipant" FOR SELECT TO authenticated
  USING (app.is_conversation_participant("conversationId"));
CREATE POLICY message_read ON "Message" FOR SELECT TO authenticated
  USING (app.is_conversation_participant("conversationId"));
CREATE POLICY report_read ON "Report" FOR SELECT TO authenticated
  USING ("reporterId" = app.member_id("campusId")
    OR EXISTS (SELECT 1 FROM "Listing" l WHERE l.id = "listingId" AND app.is_location_staff(l."locationId")));
