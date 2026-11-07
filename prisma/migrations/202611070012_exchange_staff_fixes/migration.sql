-- Fixes to 202611070007_exchange_operations, which is applied on the hosted
-- project and must not be edited. Each function below is the 0007 definition
-- with exactly one change:
-- * app.exchange_command no longer refuses cancel unless the caller holds the
--   reservation. inventory.cancel already lets staff assigned to the lot's
--   location release a hold and answers other students NOT_FOUND and staff
--   elsewhere FORBIDDEN, so staff can release holds from /staff/.
-- * exchange_staff_inventory skips lots locked by in-flight commands, like
--   exchange_listings, so loading the staff screen does not wait on a pickup.
-- Grants are unchanged: CREATE OR REPLACE keeps existing privileges.

CREATE OR REPLACE FUNCTION app.exchange_command(op text,lot_id uuid,reservation_id uuid,qty int,new_on_hand int,reason text,request_key text) RETURNS jsonb
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

CREATE OR REPLACE FUNCTION public.exchange_staff_inventory(campus_id uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
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
