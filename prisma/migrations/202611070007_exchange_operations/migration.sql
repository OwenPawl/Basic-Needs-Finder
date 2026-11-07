-- Session-derived inventory commands. Browser callers never choose an actor.
CREATE FUNCTION app.exchange_command(op text,lot_id uuid,reservation_id uuid,qty int,new_on_hand int,reason text,request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE l public."StockLot"; r public."Reservation"; actor uuid; result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
 IF request_key IS NULL OR char_length(request_key) NOT BETWEEN 1 AND 160 THEN PERFORM app.fail('VALIDATION_ERROR'); END IF;
 IF reservation_id IS NOT NULL THEN
  SELECT * INTO r FROM public."Reservation" WHERE id=reservation_id;
  SELECT * INTO l FROM public."StockLot" WHERE id=r."stockLotId";
 ELSE SELECT * INTO l FROM public."StockLot" WHERE id=lot_id; END IF;
 IF l.id IS NULL OR NOT app.is_verified_member(l."campusId") THEN PERFORM app.fail('NOT_FOUND'); END IF;
 actor:=app.require_verified_member(l."campusId");
 IF op IN ('receive','pickup','correct','remove') THEN actor:=app.require_location_staff(l."locationId"); END IF;
 CASE op
 WHEN 'reserve' THEN result:=inventory.reserve(actor,l.id,qty,request_key);
 WHEN 'cancel' THEN result:=inventory.cancel(actor,r.id,request_key);
 WHEN 'receive' THEN result:=inventory.receive(actor,l.id,qty,request_key);
 WHEN 'pickup' THEN result:=inventory.pickup(actor,r.id,request_key);
 WHEN 'correct' THEN result:=inventory.correct(actor,l.id,new_on_hand,reason,request_key);
 WHEN 'remove' THEN result:=inventory.remove(actor,l.id,reason,request_key);
 ELSE PERFORM app.fail('VALIDATION_ERROR'); END CASE;
 RETURN (CASE WHEN result->>'ok'='true' THEN jsonb_build_object('data',result->'data') ELSE jsonb_build_object('error',result->'error') END)||jsonb_build_object('request_id',request_key);
END $$;
CREATE FUNCTION public.exchange_reserve(lot_id uuid,qty int,idempotency_key text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$ SELECT app.exchange_command('reserve',lot_id,NULL,qty,NULL,NULL,idempotency_key) $$;
CREATE FUNCTION public.exchange_cancel(reservation_id uuid,idempotency_key text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$ SELECT app.exchange_command('cancel',NULL,reservation_id,NULL,NULL,NULL,idempotency_key) $$;
CREATE FUNCTION public.exchange_receive(lot_id uuid,qty int,idempotency_key text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$ SELECT app.exchange_command('receive',lot_id,NULL,qty,NULL,NULL,idempotency_key) $$;
CREATE FUNCTION public.exchange_pickup(reservation_id uuid,idempotency_key text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$ SELECT app.exchange_command('pickup',NULL,reservation_id,NULL,NULL,NULL,idempotency_key) $$;
CREATE FUNCTION public.exchange_correct(lot_id uuid,on_hand int,reason text,idempotency_key text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$ SELECT app.exchange_command('correct',lot_id,NULL,NULL,on_hand,reason,idempotency_key) $$;
CREATE FUNCTION public.exchange_remove(lot_id uuid,reason text,idempotency_key text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$ SELECT app.exchange_command('remove',lot_id,NULL,NULL,NULL,reason,idempotency_key) $$;
CREATE FUNCTION app.exchange_reservation_json(rid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('reservation_id',r.id,'lot_id',r."stockLotId",'quantity',r.quantity,'member_id',r."memberId",'status',lower(r.status::text),'expires_at',r."expiresAt",'created_at',r."createdAt",'completed_at',r."completedAt",'cancelled_at',r."cancelledAt",'expired_at',r."expiredAt",'listing_id',l.id,'title',l.title,'location',app.listing_json(l.id)->'location')
 FROM public."Reservation" r JOIN public."StockLot" s ON s.id=r."stockLotId" JOIN public."Listing" l ON l.id=s."listingId" WHERE r.id=rid
$$;
CREATE FUNCTION public.exchange_my_reservations(campus_id uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; lid uuid;
BEGIN
 actor:=app.require_verified_member(campus_id);
 FOR lid IN SELECT s.id FROM public."StockLot" s WHERE EXISTS(SELECT 1 FROM public."Reservation" r WHERE r."stockLotId"=s.id AND r."memberId"=actor AND r.status='ACTIVE') ORDER BY s.id FOR UPDATE OF s LOOP PERFORM inventory.expire_due_on_lot(lid); END LOOP;
 RETURN (SELECT coalesce(jsonb_agg(app.exchange_reservation_json(r.id) ORDER BY r."createdAt" DESC),'[]'::jsonb) FROM public."Reservation" r WHERE r."memberId"=actor AND r."campusId"=campus_id);
END $$;
CREATE FUNCTION public.exchange_staff_inventory(campus_id uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; lid uuid;
BEGIN
 actor:=app.require_verified_member(campus_id);
 IF NOT EXISTS(SELECT 1 FROM public."Location" l WHERE l."campusId"=campus_id AND app.is_location_staff(l.id)) THEN PERFORM app.fail('FORBIDDEN'); END IF;
 FOR lid IN SELECT s.id FROM public."StockLot" s WHERE s."campusId"=campus_id AND app.is_location_staff(s."locationId") ORDER BY s.id FOR UPDATE OF s SKIP LOCKED LOOP PERFORM inventory.expire_due_on_lot(lid); END LOOP;
 RETURN jsonb_build_object(
 'locations',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'building',l.building,'hours',l.hours,'instructions',l.instructions)),'[]'::jsonb) FROM public."Location" l WHERE l."campusId"=campus_id AND app.is_location_staff(l.id)),
 'lots',(SELECT coalesce(jsonb_agg(inventory.lot_json(s.id)||jsonb_build_object('listing_id',l.id,'title',l.title,'location_id',s."locationId",'food',app.listing_json(l.id)->'food','images',to_jsonb(l.images)) ORDER BY l."createdAt" DESC),'[]'::jsonb) FROM public."StockLot" s JOIN public."Listing" l ON l.id=s."listingId" WHERE s."campusId"=campus_id AND app.is_location_staff(s."locationId")),
 'reservations',(SELECT coalesce(jsonb_agg(app.exchange_reservation_json(r.id) ORDER BY r."createdAt" DESC),'[]'::jsonb) FROM public."Reservation" r JOIN public."StockLot" s ON s.id=r."stockLotId" WHERE r."campusId"=campus_id AND app.is_location_staff(s."locationId")),
 'reports',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'listing_id',r."listingId",'title',l.title,'reason',r.reason,'created_at',r."createdAt",'resolved_at',r."resolvedAt")),'[]'::jsonb) FROM public."Report" r JOIN public."Listing" l ON l.id=r."listingId" WHERE r."campusId"=campus_id AND app.is_location_staff(l."locationId")));
END $$;
CREATE FUNCTION public.exchange_resolve_report(report_id uuid) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE loc uuid;
BEGIN
 SELECT l."locationId" INTO loc FROM public."Report" r JOIN public."Listing" l ON l.id=r."listingId" WHERE r.id=report_id;
 PERFORM app.require_location_staff(loc);UPDATE public."Report" SET "resolvedAt"=coalesce("resolvedAt",now()) WHERE id=report_id;
END $$;
REVOKE ALL ON FUNCTION app.exchange_command(text,uuid,uuid,int,int,text,text),app.exchange_reservation_json(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.exchange_reserve(uuid,int,text),public.exchange_cancel(uuid,text),public.exchange_receive(uuid,int,text),public.exchange_pickup(uuid,text),public.exchange_correct(uuid,int,text,text),public.exchange_remove(uuid,text,text),public.exchange_my_reservations(uuid),public.exchange_staff_inventory(uuid),public.exchange_resolve_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.exchange_reserve(uuid,int,text),public.exchange_cancel(uuid,text),public.exchange_receive(uuid,int,text),public.exchange_pickup(uuid,text),public.exchange_correct(uuid,int,text,text),public.exchange_remove(uuid,text,text),public.exchange_my_reservations(uuid),public.exchange_staff_inventory(uuid),public.exchange_resolve_report(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION inventory.food_receipt_problem(p_lot uuid) RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN NOT (li."categoryId" = 'food' OR EXISTS (SELECT 1 FROM public."FoodDetails" fd WHERE fd."listingId" = li.id)) THEN NULL
    WHEN f."stockLotId" IS NULL THEN 'Food batch details are required before receipt.'
    WHEN length(btrim(f.photo)) = 0 THEN 'A photo of the actual package is required.'
    WHEN f.opened THEN 'Only sealed food can be accepted.'
    WHEN NOT f."shelfStable" THEN 'Only shelf-stable food can be accepted.'
    WHEN length(btrim(f."dateLabel")) = 0 THEN 'The package date label is required.'
    WHEN f."bestBy" < (current_timestamp AT TIME ZONE 'America/Los_Angeles')::date THEN 'This food is past its date and cannot be accepted.'
  END
  FROM public."StockLot" l
  JOIN public."Listing" li ON li.id = l."listingId"
  LEFT JOIN public."StockFoodDetails" f ON f."stockLotId" = l.id
  WHERE l.id = p_lot
$$;

CREATE OR REPLACE FUNCTION inventory.reserve(p_actor uuid, p_lot uuid, p_qty int, p_key text) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
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
  IF inventory.food_receipt_problem(p_lot) IS NOT NULL THEN RETURN inventory.finish(p_actor,p_key,inventory.err('NOT_RESERVABLE','This food is no longer available.')); END IF;
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

CREATE OR REPLACE FUNCTION inventory.resolve_reservation(p_actor uuid, p_reservation uuid, p_key text, p_op text) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
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
  IF p_op='pickup' AND inventory.food_receipt_problem(l.id) IS NOT NULL THEN RETURN inventory.finish(p_actor,p_key,inventory.err('NOT_RESERVABLE','Do not release food past its package date. Remove the stock instead.')); END IF;
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

CREATE OR REPLACE FUNCTION inventory.lot_json(p_lot uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('lot_id', l.id, 'status', lower(l.status::text), 'pledged_quantity', l.pledged,
    'on_hand', l."onHand", 'reserved', l.reserved,
    'available', CASE WHEN l.status = 'RECEIVED' AND inventory.food_receipt_problem(l.id) IS NULL THEN l."onHand" - l.reserved ELSE 0 END)
  FROM public."StockLot" l WHERE l.id = p_lot
$$;

CREATE OR REPLACE FUNCTION public.exchange_listings(
 campus_id uuid, search_text text DEFAULT '', post_kind text DEFAULT '', category_id text DEFAULT '',
 location_id uuid DEFAULT NULL, available_only boolean DEFAULT false, mine_only boolean DEFAULT false,
 sort_order text DEFAULT 'recent', page_number int DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE member uuid; expired_lot uuid; result jsonb;
BEGIN
 member := app.require_verified_member(campus_id);
 IF page_number IS NULL OR page_number<0 OR page_number>10000 OR post_kind NOT IN ('','offer','request') OR sort_order NOT IN ('recent','available') OR char_length(search_text)>200 THEN
  PERFORM app.fail('VALIDATION_ERROR','Invalid discovery filters');
 END IF;
 -- Refresh due holds in this campus before deriving availability. Locks match
 -- inventory commands; SKIP LOCKED avoids waiting behind an in-flight pickup.
 FOR expired_lot IN SELECT s.id FROM public."StockLot" s
  WHERE s."campusId"=campus_id AND EXISTS (SELECT 1 FROM public."Reservation" r WHERE r."stockLotId"=s.id AND r.status='ACTIVE' AND r."expiresAt"<=now())
  ORDER BY s.id LIMIT 500 FOR UPDATE OF s SKIP LOCKED
 LOOP PERFORM inventory.expire_due_on_lot(expired_lot); END LOOP;
 WITH filtered AS (
  SELECT l.id,l."createdAt",coalesce((SELECT sum(s."onHand"-s.reserved) FROM public."StockLot" s WHERE s."listingId"=l.id AND s.status='RECEIVED' AND inventory.food_receipt_problem(s.id) IS NULL),0) AS available
  FROM public."Listing" l
  WHERE l."campusId"=campus_id AND (CASE WHEN mine_only THEN l."authorId"=member AND l.status<>'REMOVED' ELSE l.status='OPEN' END)
   AND (post_kind='' OR lower(l.kind::text)=post_kind) AND (category_id='' OR l."categoryId"=category_id)
   AND (location_id IS NULL OR l."locationId"=location_id)
   AND (search_text='' OR position(lower(btrim(search_text)) IN lower(l.title||' '||l.description))>0)
 ), eligible AS (SELECT * FROM filtered WHERE NOT available_only OR available>0), selected AS (
  SELECT * FROM eligible ORDER BY CASE WHEN sort_order='available' THEN available ELSE 0 END DESC,"createdAt" DESC,id LIMIT 24 OFFSET page_number*24
 ) SELECT jsonb_build_object('listings',coalesce((SELECT jsonb_agg(app.listing_json(x.id) ORDER BY CASE WHEN sort_order='available' THEN x.available ELSE 0 END DESC,x."createdAt" DESC,x.id) FROM selected x),'[]'::jsonb),'total',(SELECT count(*) FROM eligible),'page',page_number,'page_size',24) INTO result;
 RETURN result;
END $$;
