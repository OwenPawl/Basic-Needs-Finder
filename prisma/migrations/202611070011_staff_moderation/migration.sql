-- staff-console follow-up to the goods exchange (after hosted migrations 1-10): listing moderation with
-- recorded reasons, report dismissal with a reason, a private moderation log,
-- and per-location summary counts. Stock actions stay on the exchange_*
-- inventory RPCs (202611070007_exchange_operations). These RPCs raise
-- API_CONTRACT codes through app.fail, like the student-auth RPCs.

-- Moderation history lives in the private app schema, outside Prisma's
-- public schema, and is read only through staff_moderation_history.
CREATE TABLE app.moderation_action (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campusId" UUID NOT NULL REFERENCES public."Campus"(id),
  "actorId" UUID NOT NULL REFERENCES public."Membership"(id),
  "listingId" UUID NOT NULL REFERENCES public."Listing"(id),
  "reportId" UUID REFERENCES public."Report"(id),
  action TEXT NOT NULL CHECK (action IN ('remove_listing', 'restore_listing', 'dismiss_report')),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
ALTER TABLE app.moderation_action ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.moderation_action FROM PUBLIC;

-- Staff assigned to the listing's location may moderate it. Like stock
-- actions this is per location for STAFF and ADMIN alike, and removal may
-- withdraw pledged stock through inventory.remove, which enforces the same rule.
CREATE FUNCTION app.can_moderate_listing(p_listing uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."Listing" l
    WHERE l.id = p_listing AND app.is_location_staff(l."locationId")
  )
$$;

-- Remove or restore a listing. Removal withdraws every lot of that listing
-- that is not already removed, pledged or received, through inventory.remove
-- in the same transaction: active holds are cancelled with audit events and
-- stock leaves inventory, so a remembered lot or reservation id cannot reserve,
-- receive or collect it afterwards (inventory.reserve and resolve_reservation
-- do not consult Listing.status). Lock order is Listing, then StockLot, then
-- Reservation, matching save_exchange_listing and inventory.*. Restoring the
-- listing does not revive withdrawn stock. An open report on that listing can
-- be resolved in the same call.
CREATE FUNCTION public.staff_moderate_listing(listing_id uuid, action text, reason text, report_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  li public."Listing";
  v_actor uuid;
  v_lot uuid;
  v_reason text := btrim(reason);
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  SELECT * INTO li FROM public."Listing" l WHERE l.id = listing_id FOR UPDATE;
  IF li.id IS NULL OR NOT app.is_verified_member(li."campusId") THEN PERFORM app.fail('NOT_FOUND'); END IF;
  IF NOT app.can_moderate_listing(li.id) THEN PERFORM app.fail('FORBIDDEN', 'staff assigned to this location required'); END IF;
  v_actor := app.member_id(li."campusId");
  IF action IS NULL OR action NOT IN ('remove', 'restore') OR v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 3 AND 500 THEN
    PERFORM app.fail('VALIDATION_ERROR', 'action must be remove or restore, with a 3-500 character reason');
  END IF;
  IF report_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public."Report" rp WHERE rp.id = report_id AND rp."listingId" = li.id AND rp."resolvedAt" IS NULL
  ) THEN
    PERFORM app.fail('INVALID_STATE', 'that report is not open for this listing');
  END IF;
  IF action = 'remove' THEN
    IF li.status = 'REMOVED' THEN PERFORM app.fail('INVALID_STATE', 'listing is already removed'); END IF;
    UPDATE public."Listing" SET status = 'REMOVED', "updatedAt" = now() WHERE id = li.id;
    FOR v_lot IN SELECT s.id FROM public."StockLot" s WHERE s."listingId" = li.id AND s.status <> 'REMOVED' ORDER BY s.id LOOP
      v_result := inventory.remove(v_actor, v_lot, 'Listing removed: ' || v_reason, 'moderation:' || li.id || ':' || v_lot);
      IF NOT (v_result->>'ok')::boolean THEN PERFORM app.fail(v_result->'error'->>'code'); END IF;
    END LOOP;
  ELSE
    IF li.status <> 'REMOVED' THEN PERFORM app.fail('INVALID_STATE', 'listing is not removed'); END IF;
    UPDATE public."Listing" SET status = 'OPEN', "updatedAt" = now() WHERE id = li.id;
  END IF;
  INSERT INTO app.moderation_action ("campusId", "actorId", "listingId", "reportId", action, reason)
  VALUES (li."campusId", v_actor, li.id, report_id, action || '_listing', v_reason);
  IF report_id IS NOT NULL THEN
    UPDATE public."Report" SET "resolvedAt" = now() WHERE id = report_id;
  END IF;
  RETURN jsonb_build_object('listing_id', li.id, 'status', CASE WHEN action = 'remove' THEN 'removed' ELSE 'open' END,
    'report_resolved', report_id IS NOT NULL);
END $$;

-- Close a report without removing the listing; the reason and actor are kept.
CREATE FUNCTION public.staff_dismiss_report(report_id uuid, reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rp public."Report";
  v_reason text := btrim(reason);
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  SELECT * INTO rp FROM public."Report" r WHERE r.id = report_id FOR UPDATE;
  IF rp.id IS NULL OR NOT app.is_verified_member(rp."campusId") THEN PERFORM app.fail('NOT_FOUND'); END IF;
  IF NOT app.can_moderate_listing(rp."listingId") THEN PERFORM app.fail('FORBIDDEN', 'staff assigned to this location required'); END IF;
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 3 AND 500 THEN
    PERFORM app.fail('VALIDATION_ERROR', 'reason must be 3-500 characters');
  END IF;
  IF rp."resolvedAt" IS NOT NULL THEN PERFORM app.fail('INVALID_STATE', 'report is already resolved'); END IF;
  UPDATE public."Report" SET "resolvedAt" = now() WHERE id = rp.id;
  INSERT INTO app.moderation_action ("campusId", "actorId", "listingId", "reportId", action, reason)
  VALUES (rp."campusId", app.member_id(rp."campusId"), rp."listingId", rp.id, 'dismiss_report', v_reason);
  RETURN jsonb_build_object('report_id', rp.id, 'resolved', true);
END $$;

-- Moderation decisions at one location, newest first. Actors are reported as
-- staff, not by name or contact.
CREATE FUNCTION public.staff_moderation_history(location_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app.require_location_staff(location_id);
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('action', ma.action, 'listing_id', ma."listingId", 'title', li.title,
      'report_id', ma."reportId", 'reason', ma.reason, 'at', ma."createdAt") ORDER BY ma."createdAt" DESC, ma.id)
    FROM app.moderation_action ma JOIN public."Listing" li ON li.id = ma."listingId"
    WHERE li."locationId" = location_id), '[]'::jsonb);
END $$;

-- Summary counts from persisted data for one location. Holds past their time
-- are not counted as active; food past its date is not counted as available.
CREATE FUNCTION public.staff_counts(location_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app.require_location_staff(location_id);
  RETURN jsonb_build_object(
    'available_units', (SELECT coalesce(sum((inventory.lot_json(s.id)->>'available')::int), 0)::int
                        FROM public."StockLot" s WHERE s."locationId" = location_id AND s.status = 'RECEIVED'),
    'pending_dropoffs', (SELECT count(*)::int FROM public."StockLot" s JOIN public."Listing" li ON li.id = s."listingId"
                         WHERE s."locationId" = location_id AND s.status = 'PLEDGED' AND li.status <> 'REMOVED'),
    'active_holds', (SELECT count(*)::int FROM public."Reservation" r JOIN public."StockLot" s ON s.id = r."stockLotId"
                     WHERE s."locationId" = location_id AND r.status = 'ACTIVE' AND r."expiresAt" > now()),
    'open_requests', (SELECT count(*)::int FROM public."Listing" li
                      WHERE li."locationId" = location_id AND li.kind = 'REQUEST' AND li.status = 'OPEN'),
    'completed_exchanges', (SELECT count(*)::int FROM public."Reservation" r JOIN public."StockLot" s ON s.id = r."stockLotId"
                            WHERE s."locationId" = location_id AND r.status = 'COMPLETED'),
    'open_reports', (SELECT count(*)::int FROM public."Report" rp JOIN public."Listing" li ON li.id = rp."listingId"
                     WHERE li."locationId" = location_id AND rp."resolvedAt" IS NULL)
  );
END $$;

REVOKE ALL ON FUNCTION app.can_moderate_listing(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_moderate_listing(uuid, text, text, uuid), public.staff_dismiss_report(uuid, text),
  public.staff_moderation_history(uuid), public.staff_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_moderate_listing(uuid, text, text, uuid), public.staff_dismiss_report(uuid, text),
  public.staff_moderation_history(uuid), public.staff_counts(uuid) TO authenticated;
