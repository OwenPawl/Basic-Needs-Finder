-- inventory-rpc-wrappers: authenticated Supabase RPCs for the private
-- inventory commands (202611070005_inventory_core).
--
-- Each wrapper resolves the caller from auth.uid() to their membership in the
-- object's campus and passes that id to inventory.*, which performs every
-- verification, staff-assignment, and state check itself. No wrapper accepts
-- an actor id from the caller.
--
-- Command outcomes come back as the API_CONTRACT envelope
-- {ok: true, data} / {ok: false, error: {code, message}} rather than a raised
-- error: raising would roll back the transaction, undoing the release of an
-- expired hold (RESERVATION_EXPIRED) and the stored outcome that makes a
-- retried idempotency key replay.

-- The caller's membership (verified or not) in a campus, or NULL. Unverified
-- members are passed through so inventory.* can answer FORBIDDEN precisely.
CREATE FUNCTION inventory.caller_membership(p_campus uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.id FROM public."Membership" m
  WHERE m."campusId" = p_campus AND m."userId" = app.current_user_id()
$$;

-- Envelope for a caller that is not signed in, or has no membership in the
-- object's campus (indistinguishable from a missing object).
CREATE FUNCTION inventory.unauthorized(p_member uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN inventory.err('UNAUTHENTICATED', 'Sign in to continue.')
    WHEN p_member IS NULL THEN inventory.err('NOT_FOUND', 'Not found.')
  END
$$;

CREATE FUNCTION public.reserve_item(lot_id uuid, qty int, idempotency_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid;
BEGIN
  v_member := inventory.caller_membership((SELECT l."campusId" FROM public."StockLot" l WHERE l.id = lot_id));
  RETURN coalesce(inventory.unauthorized(v_member), inventory.reserve(v_member, lot_id, qty, idempotency_key));
END $$;

CREATE FUNCTION public.cancel_reservation(reservation_id uuid, idempotency_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid;
BEGIN
  v_member := inventory.caller_membership((SELECT r."campusId" FROM public."Reservation" r WHERE r.id = reservation_id));
  RETURN coalesce(inventory.unauthorized(v_member), inventory.cancel(v_member, reservation_id, idempotency_key));
END $$;

CREATE FUNCTION public.confirm_receipt(lot_id uuid, qty int, idempotency_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid;
BEGIN
  v_member := inventory.caller_membership((SELECT l."campusId" FROM public."StockLot" l WHERE l.id = lot_id));
  RETURN coalesce(inventory.unauthorized(v_member), inventory.receive(v_member, lot_id, qty, idempotency_key));
END $$;

CREATE FUNCTION public.confirm_pickup(reservation_id uuid, idempotency_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid;
BEGIN
  v_member := inventory.caller_membership((SELECT r."campusId" FROM public."Reservation" r WHERE r.id = reservation_id));
  RETURN coalesce(inventory.unauthorized(v_member), inventory.pickup(v_member, reservation_id, idempotency_key));
END $$;

CREATE FUNCTION public.correct_stock(lot_id uuid, on_hand int, reason text, idempotency_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid;
BEGIN
  v_member := inventory.caller_membership((SELECT l."campusId" FROM public."StockLot" l WHERE l.id = lot_id));
  RETURN coalesce(inventory.unauthorized(v_member), inventory.correct(v_member, lot_id, on_hand, reason, idempotency_key));
END $$;

CREATE FUNCTION public.remove_stock(lot_id uuid, reason text, idempotency_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid;
BEGIN
  v_member := inventory.caller_membership((SELECT l."campusId" FROM public."StockLot" l WHERE l.id = lot_id));
  RETURN coalesce(inventory.unauthorized(v_member), inventory.remove(v_member, lot_id, reason, idempotency_key));
END $$;

REVOKE ALL ON FUNCTION inventory.caller_membership(uuid), inventory.unauthorized(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.reserve_item(uuid, int, text), public.cancel_reservation(uuid, text),
  public.confirm_receipt(uuid, int, text), public.confirm_pickup(uuid, text),
  public.correct_stock(uuid, int, text, text), public.remove_stock(uuid, text, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.reserve_item(uuid, int, text), public.cancel_reservation(uuid, text),
  public.confirm_receipt(uuid, int, text), public.confirm_pickup(uuid, text),
  public.correct_stock(uuid, int, text, text), public.remove_stock(uuid, text, text)
TO authenticated;
