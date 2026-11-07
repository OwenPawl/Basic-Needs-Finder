-- Inventory-core: transactional stock and reservation commands.
-- Implements docs/inventory-test-vectors.json. Commands live in the private
-- "inventory" schema, which is not exposed to Supabase's Data API and has no
-- grants. Public RPC wrappers (student-auth / route integration) resolve the
-- caller from auth.uid() to a Membership and call these with that actor id.

-- Constraints that catch command bugs early (vectors U1-U2, state boundaries).
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_removed_empty"
  CHECK (status <> 'REMOVED' OR ("onHand" = 0 AND reserved = 0));
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_terminal_timestamps" CHECK (
  (status = 'ACTIVE' AND "completedAt" IS NULL AND "cancelledAt" IS NULL AND "expiredAt" IS NULL) OR
  (status = 'COMPLETED' AND "completedAt" IS NOT NULL AND "cancelledAt" IS NULL AND "expiredAt" IS NULL) OR
  (status = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "completedAt" IS NULL AND "expiredAt" IS NULL) OR
  (status = 'EXPIRED' AND "expiredAt" IS NOT NULL AND "completedAt" IS NULL AND "cancelledAt" IS NULL)
);
ALTER TABLE "FoodDetails" ADD CONSTRAINT "FoodDetails_unknown_allergens_empty"
  CHECK ("allergensKnown" OR cardinality(COALESCE(allergens, '{}')) = 0);
ALTER TABLE "StockFoodDetails" ADD CONSTRAINT "StockFoodDetails_unknown_allergens_empty"
  CHECK ("allergensKnown" OR cardinality(COALESCE(allergens, '{}')) = 0);

CREATE SCHEMA inventory;
REVOKE ALL ON SCHEMA inventory FROM PUBLIC;

-- One row per (actor, idempotency key), including rejected commands, so a
-- retry returns the original outcome. IDEMPOTENCY_CONFLICT is never stored.
CREATE TABLE inventory.command (
  "actorId" UUID NOT NULL REFERENCES public."Membership"(id),
  "commandKey" TEXT NOT NULL CHECK (length("commandKey") BETWEEN 1 AND 200),
  op TEXT NOT NULL,
  "requestHash" TEXT NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  result JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("actorId", "commandKey")
);
ALTER TABLE inventory.command ENABLE ROW LEVEL SECURITY;

-- Proposed hold duration from docs/API_CONTRACT.md; change here once campus policy is set.
CREATE FUNCTION inventory.hold_ttl() RETURNS interval LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT interval '24 hours'
$$;

-- The canonical request includes the operation so one key reused across
-- operations is a conflict, not a replay.
CREATE FUNCTION inventory.request_hash(p_op text, p_args jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(jsonb_build_object('op', p_op, 'args', p_args)::text, 'UTF8')), 'hex')
$$;

CREATE FUNCTION inventory.ok(p_data jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('ok', true, 'data', p_data)
$$;

CREATE FUNCTION inventory.err(p_code text, p_message text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('ok', false, 'error', jsonb_build_object('code', p_code, 'message', p_message))
$$;

CREATE FUNCTION inventory.lot_json(p_lot uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('lot_id', l.id, 'status', lower(l.status::text), 'pledged_quantity', l.pledged,
    'on_hand', l."onHand", 'reserved', l.reserved,
    'available', CASE WHEN l.status = 'RECEIVED' THEN l."onHand" - l.reserved ELSE 0 END)
  FROM public."StockLot" l WHERE l.id = p_lot
$$;

CREATE FUNCTION inventory.reservation_json(p_reservation uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('reservation_id', r.id, 'lot_id', r."stockLotId", 'student_id', r."memberId",
    'qty', r.quantity, 'status', lower(r.status::text), 'expires_at', r."expiresAt")
  FROM public."Reservation" r WHERE r.id = p_reservation
$$;

-- Claim an idempotency key. Returns NULL when this call owns a new command,
-- otherwise the stored result (replay) or IDEMPOTENCY_CONFLICT. A concurrent
-- duplicate waits on the primary key until the first call commits.
CREATE FUNCTION inventory.claim(p_actor uuid, p_key text, p_op text, p_hash text) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_command inventory.command;
BEGIN
  INSERT INTO inventory.command ("actorId", "commandKey", op, "requestHash")
  VALUES (p_actor, p_key, p_op, p_hash) ON CONFLICT DO NOTHING;
  IF FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_command FROM inventory.command WHERE "actorId" = p_actor AND "commandKey" = p_key;
  IF v_command."requestHash" <> p_hash THEN
    RETURN inventory.err('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different request.');
  END IF;
  RETURN v_command.result || jsonb_build_object('replayed', true);
END
$$;

CREATE FUNCTION inventory.finish(p_actor uuid, p_key text, p_result jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  UPDATE inventory.command SET result = p_result WHERE "actorId" = p_actor AND "commandKey" = p_key;
  RETURN p_result;
END
$$;

CREATE FUNCTION inventory.add_event(
  p_campus uuid, p_lot uuid, p_reservation uuid, p_actor uuid, p_kind public."InventoryEventKind",
  p_on_hand_before int, p_on_hand_after int, p_reserved_before int, p_reserved_after int,
  p_reason text, p_key text, p_hash text
) RETURNS void LANGUAGE sql SET search_path = '' AS $$
  INSERT INTO public."InventoryEvent" (id, "campusId", "stockLotId", "reservationId", "actorId", kind,
    "onHandDelta", "reservedDelta", "onHandBefore", "onHandAfter", "reservedBefore", "reservedAfter",
    reason, "commandKey", "requestHash")
  VALUES (gen_random_uuid(), p_campus, p_lot, p_reservation, p_actor, p_kind,
    p_on_hand_after - p_on_hand_before, p_reserved_after - p_reserved_before,
    p_on_hand_before, p_on_hand_after, p_reserved_before, p_reserved_after,
    p_reason, p_key, p_hash)
$$;

-- Verified member of p_campus, or NULL.
CREATE FUNCTION inventory.member(p_actor uuid, p_campus uuid) RETURNS public."Membership" LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT m.* FROM public."Membership" m WHERE m.id = p_actor AND m."campusId" = p_campus
$$;

CREATE FUNCTION inventory.is_staff_at(p_actor uuid, p_location uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."Membership" m
    JOIN public."Location" l ON l.id = p_location AND l."campusId" = m."campusId"
    WHERE m.id = p_actor AND m."verifiedAt" IS NOT NULL AND (
      m.role = 'ADMIN' OR (m.role = 'STAFF' AND EXISTS (
        SELECT 1 FROM public."StaffAssignment" s WHERE s."membershipId" = m.id AND s."locationId" = p_location)))
  )
$$;

-- Expire one active reservation whose hold has passed. Caller holds the lot lock.
-- The event key is derived from the reservation, so a hold can expire only once.
CREATE FUNCTION inventory.expire_one(p_reservation uuid) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  r public."Reservation";
  l public."StockLot";
BEGIN
  UPDATE public."Reservation" SET status = 'EXPIRED', "expiredAt" = now()
  WHERE id = p_reservation AND status = 'ACTIVE' AND "expiresAt" <= now() RETURNING * INTO r;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE public."StockLot" SET reserved = reserved - r.quantity WHERE id = r."stockLotId" RETURNING * INTO l;
  PERFORM inventory.add_event(r."campusId", r."stockLotId", r.id, r."memberId", 'EXPIRE',
    l."onHand", l."onHand", l.reserved + r.quantity, l.reserved, 'Hold expired',
    'expire:' || r.id, inventory.request_hash('expire', jsonb_build_object('reservation_id', r.id)));
END
$$;

-- Expire every passed hold on a lot. Caller holds the lot lock.
CREATE FUNCTION inventory.expire_due_on_lot(p_lot uuid) RETURNS int LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_id uuid;
  v_count int := 0;
BEGIN
  FOR v_id IN SELECT id FROM public."Reservation"
    WHERE "stockLotId" = p_lot AND status = 'ACTIVE' AND "expiresAt" <= now() ORDER BY id
  LOOP
    PERFORM inventory.expire_one(v_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END
$$;

-- Scheduled tidying. Correctness does not depend on it: every command expires
-- passed holds on its lot first (vectors E4-E6).
CREATE FUNCTION inventory.expire_sweep(p_limit int DEFAULT 500) RETURNS int LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_lot uuid;
  v_count int := 0;
BEGIN
  FOR v_lot IN SELECT DISTINCT "stockLotId" FROM public."Reservation"
    WHERE status = 'ACTIVE' AND "expiresAt" <= now() ORDER BY "stockLotId" LIMIT p_limit
  LOOP
    PERFORM 1 FROM public."StockLot" WHERE id = v_lot FOR UPDATE;
    v_count := v_count + inventory.expire_due_on_lot(v_lot);
  END LOOP;
  RETURN v_count;
END
$$;

CREATE FUNCTION inventory.receive(p_actor uuid, p_lot uuid, p_qty int, p_key text) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_hash text := inventory.request_hash('receive', jsonb_build_object('lot_id', p_lot, 'qty', p_qty));
  v_prior jsonb;
  l public."StockLot";
BEGIN
  SELECT * INTO l FROM public."StockLot" WHERE id = p_lot;
  IF NOT FOUND OR inventory.member(p_actor, l."campusId") IS NULL THEN
    RETURN inventory.err('NOT_FOUND', 'Stock lot not found.');
  END IF;
  v_prior := inventory.claim(p_actor, p_key, 'receive', v_hash);
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF NOT inventory.is_staff_at(p_actor, l."locationId") THEN
    RETURN inventory.finish(p_actor, p_key, inventory.err('FORBIDDEN', 'Only staff assigned to this location can confirm receipt.'));
  END IF;
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > l.pledged THEN
    RETURN inventory.finish(p_actor, p_key, inventory.err('VALIDATION_ERROR', 'Received quantity must be between 1 and the pledged quantity.'));
  END IF;
  SELECT * INTO l FROM public."StockLot" WHERE id = p_lot FOR UPDATE;
  IF l.status <> 'PLEDGED' THEN
    RETURN inventory.finish(p_actor, p_key, inventory.err('INVALID_STATE', 'This lot has already been received or removed.'));
  END IF;
  UPDATE public."StockLot" SET status = 'RECEIVED', "onHand" = p_qty, "receivedAt" = now() WHERE id = p_lot;
  PERFORM inventory.add_event(l."campusId", l.id, NULL, p_actor, 'RECEIPT', 0, p_qty, 0, 0,
    'Receipt confirmed', p_key, v_hash);
  RETURN inventory.finish(p_actor, p_key, inventory.ok(jsonb_build_object('lot', inventory.lot_json(p_lot))));
END
$$;

CREATE FUNCTION inventory.reserve(p_actor uuid, p_lot uuid, p_qty int, p_key text) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_hash text := inventory.request_hash('reserve', jsonb_build_object('lot_id', p_lot, 'qty', p_qty));
  v_prior jsonb;
  m public."Membership";
  l public."StockLot";
  v_reservation uuid;
BEGIN
  SELECT * INTO l FROM public."StockLot" WHERE id = p_lot;
  IF FOUND THEN m := inventory.member(p_actor, l."campusId"); END IF;
  IF l.id IS NULL OR m.id IS NULL THEN
    RETURN inventory.err('NOT_FOUND', 'Stock lot not found.');
  END IF;
  v_prior := inventory.claim(p_actor, p_key, 'reserve', v_hash);
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF m."verifiedAt" IS NULL THEN
    RETURN inventory.finish(p_actor, p_key, inventory.err('FORBIDDEN', 'Verify your campus membership before reserving.'));
  END IF;
  IF p_qty IS NULL OR p_qty < 1 THEN
    RETURN inventory.finish(p_actor, p_key, inventory.err('VALIDATION_ERROR', 'Quantity must be a positive whole number.'));
  END IF;
  SELECT * INTO l FROM public."StockLot" WHERE id = p_lot FOR UPDATE;
  IF l.status <> 'RECEIVED' THEN
    RETURN inventory.finish(p_actor, p_key, inventory.err('NOT_RESERVABLE', 'This item is not available for reservation.'));
  END IF;
  PERFORM inventory.expire_due_on_lot(p_lot);
  SELECT * INTO l FROM public."StockLot" WHERE id = p_lot;
  IF l."onHand" - l.reserved < p_qty THEN
    RETURN inventory.finish(p_actor, p_key, inventory.err('INSUFFICIENT_STOCK', 'Not enough units are available.'));
  END IF;
  INSERT INTO public."Reservation" (id, "campusId", "stockLotId", "memberId", quantity, status, "expiresAt", "idempotencyKey")
  VALUES (gen_random_uuid(), l."campusId", l.id, p_actor, p_qty, 'ACTIVE', now() + inventory.hold_ttl(), p_key)
  RETURNING id INTO v_reservation;
  UPDATE public."StockLot" SET reserved = reserved + p_qty WHERE id = p_lot;
  PERFORM inventory.add_event(l."campusId", l.id, v_reservation, p_actor, 'RESERVE',
    l."onHand", l."onHand", l.reserved, l.reserved + p_qty, 'Reserved for pickup', p_key, v_hash);
  RETURN inventory.finish(p_actor, p_key, inventory.ok(jsonb_build_object(
    'lot', inventory.lot_json(p_lot), 'reservation', inventory.reservation_json(v_reservation))));
END
$$;

-- Shared body of cancel and pickup: authorize, lock lot then reservation,
-- expire a passed hold, then apply p_op.
CREATE FUNCTION inventory.resolve_reservation(p_actor uuid, p_reservation uuid, p_key text, p_op text) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_hash text := inventory.request_hash(p_op, jsonb_build_object('reservation_id', p_reservation));
  v_prior jsonb;
  r public."Reservation";
  l public."StockLot";
  m public."Membership";
  v_staff boolean;
BEGIN
  SELECT * INTO r FROM public."Reservation" WHERE id = p_reservation;
  IF FOUND THEN m := inventory.member(p_actor, r."campusId"); END IF;
  IF r.id IS NULL OR m.id IS NULL THEN
    RETURN inventory.err('NOT_FOUND', 'Reservation not found.');
  END IF;
  SELECT * INTO l FROM public."StockLot" WHERE id = r."stockLotId";
  v_staff := inventory.is_staff_at(p_actor, l."locationId");
  -- Students never learn about other students' reservations.
  IF NOT v_staff AND m.role = 'STUDENT' AND r."memberId" <> p_actor THEN
    RETURN inventory.err('NOT_FOUND', 'Reservation not found.');
  END IF;
  v_prior := inventory.claim(p_actor, p_key, p_op, v_hash);
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_op = 'pickup' AND NOT v_staff THEN
    RETURN inventory.finish(p_actor, p_key, inventory.err('FORBIDDEN', 'Only staff assigned to this location can confirm pickup.'));
  END IF;
  IF p_op = 'cancel' AND NOT v_staff AND r."memberId" <> p_actor THEN
    RETURN inventory.finish(p_actor, p_key, inventory.err('FORBIDDEN', 'Only the student or staff at this location can cancel.'));
  END IF;
  SELECT * INTO l FROM public."StockLot" WHERE id = r."stockLotId" FOR UPDATE;
  SELECT * INTO r FROM public."Reservation" WHERE id = p_reservation FOR UPDATE;
  IF r.status <> 'ACTIVE' THEN
    RETURN inventory.finish(p_actor, p_key, inventory.err('INVALID_STATE', 'This reservation is no longer active.'));
  END IF;
  IF r."expiresAt" <= now() THEN
    PERFORM inventory.expire_one(r.id);
    RETURN inventory.finish(p_actor, p_key, inventory.err('RESERVATION_EXPIRED', 'This hold has expired.'));
  END IF;
  IF p_op = 'pickup' THEN
    UPDATE public."Reservation" SET status = 'COMPLETED', "completedAt" = now() WHERE id = r.id;
    UPDATE public."StockLot" SET "onHand" = "onHand" - r.quantity, reserved = reserved - r.quantity WHERE id = l.id;
    PERFORM inventory.add_event(l."campusId", l.id, r.id, p_actor, 'PICKUP',
      l."onHand", l."onHand" - r.quantity, l.reserved, l.reserved - r.quantity, 'Pickup confirmed', p_key, v_hash);
  ELSE
    UPDATE public."Reservation" SET status = 'CANCELLED', "cancelledAt" = now() WHERE id = r.id;
    UPDATE public."StockLot" SET reserved = reserved - r.quantity WHERE id = l.id;
    PERFORM inventory.add_event(l."campusId", l.id, r.id, p_actor, 'CANCEL',
      l."onHand", l."onHand", l.reserved, l.reserved - r.quantity, 'Reservation cancelled', p_key, v_hash);
  END IF;
  RETURN inventory.finish(p_actor, p_key, inventory.ok(jsonb_build_object(
    'lot', inventory.lot_json(l.id), 'reservation', inventory.reservation_json(r.id))));
END
$$;

CREATE FUNCTION inventory.cancel(p_actor uuid, p_reservation uuid, p_key text) RETURNS jsonb LANGUAGE sql SET search_path = '' AS $$
  SELECT inventory.resolve_reservation(p_actor, p_reservation, p_key, 'cancel')
$$;

CREATE FUNCTION inventory.pickup(p_actor uuid, p_reservation uuid, p_key text) RETURNS jsonb LANGUAGE sql SET search_path = '' AS $$
  SELECT inventory.resolve_reservation(p_actor, p_reservation, p_key, 'pickup')
$$;

-- Shared body of correct and remove.
CREATE FUNCTION inventory.adjust_lot(p_actor uuid, p_lot uuid, p_on_hand int, p_reason text, p_key text, p_op text) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_hash text := inventory.request_hash(p_op, jsonb_build_object('lot_id', p_lot, 'on_hand', p_on_hand, 'reason', p_reason));
  v_prior jsonb;
  l public."StockLot";
  r public."Reservation";
BEGIN
  SELECT * INTO l FROM public."StockLot" WHERE id = p_lot;
  IF NOT FOUND OR inventory.member(p_actor, l."campusId") IS NULL THEN
    RETURN inventory.err('NOT_FOUND', 'Stock lot not found.');
  END IF;
  v_prior := inventory.claim(p_actor, p_key, p_op, v_hash);
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF NOT inventory.is_staff_at(p_actor, l."locationId") THEN
    RETURN inventory.finish(p_actor, p_key, inventory.err('FORBIDDEN', 'Only staff assigned to this location can change stock.'));
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 OR (p_op = 'correct' AND (p_on_hand IS NULL OR p_on_hand < 0)) THEN
    RETURN inventory.finish(p_actor, p_key, inventory.err('VALIDATION_ERROR', 'A reason and a non-negative quantity are required.'));
  END IF;
  SELECT * INTO l FROM public."StockLot" WHERE id = p_lot FOR UPDATE;
  IF l.status = 'REMOVED' OR (p_op = 'correct' AND l.status <> 'RECEIVED') THEN
    RETURN inventory.finish(p_actor, p_key, inventory.err('INVALID_STATE', 'Only received stock can be changed.'));
  END IF;
  PERFORM inventory.expire_due_on_lot(p_lot);
  SELECT * INTO l FROM public."StockLot" WHERE id = p_lot;
  IF p_op = 'correct' THEN
    IF p_on_hand < l.reserved THEN
      RETURN inventory.finish(p_actor, p_key, inventory.err('WOULD_VIOLATE_RESERVATIONS', 'Resolve active holds before lowering stock below the reserved count.'));
    END IF;
    UPDATE public."StockLot" SET "onHand" = p_on_hand WHERE id = p_lot;
    PERFORM inventory.add_event(l."campusId", l.id, NULL, p_actor, 'CORRECTION',
      l."onHand", p_on_hand, l.reserved, l.reserved, btrim(p_reason), p_key, v_hash);
  ELSE
    -- Removal cancels remaining holds first, in this transaction, so resolving
    -- them later can never make removed stock available again.
    FOR r IN SELECT * FROM public."Reservation" WHERE "stockLotId" = p_lot AND status = 'ACTIVE' ORDER BY id FOR UPDATE
    LOOP
      UPDATE public."Reservation" SET status = 'CANCELLED', "cancelledAt" = now() WHERE id = r.id;
      UPDATE public."StockLot" SET reserved = reserved - r.quantity WHERE id = p_lot;
      PERFORM inventory.add_event(l."campusId", l.id, r.id, p_actor, 'CANCEL',
        l."onHand", l."onHand", l.reserved, l.reserved - r.quantity, 'Stock removed: ' || btrim(p_reason),
        p_key || ':cancel:' || r.id, inventory.request_hash('remove-cancel', jsonb_build_object('reservation_id', r.id)));
      l.reserved := l.reserved - r.quantity;
    END LOOP;
    UPDATE public."StockLot" SET status = 'REMOVED', "onHand" = 0 WHERE id = p_lot;
    PERFORM inventory.add_event(l."campusId", l.id, NULL, p_actor, 'REMOVE',
      l."onHand", 0, 0, 0, btrim(p_reason), p_key, v_hash);
  END IF;
  RETURN inventory.finish(p_actor, p_key, inventory.ok(jsonb_build_object('lot', inventory.lot_json(p_lot))));
END
$$;

CREATE FUNCTION inventory.correct(p_actor uuid, p_lot uuid, p_on_hand int, p_reason text, p_key text) RETURNS jsonb LANGUAGE sql SET search_path = '' AS $$
  SELECT inventory.adjust_lot(p_actor, p_lot, p_on_hand, p_reason, p_key, 'correct')
$$;

CREATE FUNCTION inventory.remove(p_actor uuid, p_lot uuid, p_reason text, p_key text) RETURNS jsonb LANGUAGE sql SET search_path = '' AS $$
  SELECT inventory.adjust_lot(p_actor, p_lot, NULL, p_reason, p_key, 'remove')
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA inventory FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA inventory FROM PUBLIC;
