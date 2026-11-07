-- Goods exchange: authenticated listing writes and sanitized discovery.
-- Requires the reviewed auth and inventory migrations. No auth/storage test
-- shims belong here. Test bootstraps provide those schemas only in *_test DBs.

CREATE FUNCTION app.listing_json(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT jsonb_build_object(
  'id',l.id,'campus_id',l."campusId",'author_id',l."authorId",'title',l.title,
  'description',l.description,'category_id',l."categoryId",'category_name',c.name,
  'kind',lower(l.kind::text),'status',lower(l.status::text),'quantity',l.quantity,
  'images',coalesce(to_jsonb(l.images),'[]'::jsonb),'created_at',l."createdAt",'updated_at',l."updatedAt",
  'is_demo',l."isDemo",'is_owner',l."authorId"=app.member_id(l."campusId"),
  'location',jsonb_build_object('id',p.id,'name',p.name,'building',p.building,'hours',p.hours,'instructions',p.instructions),
  'lots',coalesce((SELECT jsonb_agg(inventory.lot_json(s.id) ORDER BY s.id) FROM public."StockLot" s WHERE s."listingId"=l.id),'[]'::jsonb),
  'food',(SELECT jsonb_build_object('food_name',f."foodName",'date_label',f."dateLabel",'best_by',f."bestBy",'opened',f.opened,'shelf_stable',f."shelfStable",'storage',f.storage,'allergens',coalesce(to_jsonb(f.allergens),'[]'::jsonb),'allergens_known',f."allergensKnown") FROM public."FoodDetails" f WHERE f."listingId"=l.id)
 ) FROM public."Listing" l JOIN public."Category" c ON c.id=l."categoryId" JOIN public."Location" p ON p.id=l."locationId" WHERE l.id=p_id
$$;

-- Authentication and campus scoping apply before all catalog reads. No email,
-- student contact details, private messages or audit actors are returned.
CREATE FUNCTION public.exchange_catalog(campus_slug text DEFAULT 'wwu') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE campus public."Campus";
BEGIN
 IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
 SELECT * INTO campus FROM public."Campus" WHERE slug=campus_slug;
 IF campus.id IS NULL THEN PERFORM app.fail('NOT_FOUND','Campus is not configured'); END IF;
 PERFORM app.require_verified_member(campus.id);
 RETURN jsonb_build_object('campus',jsonb_build_object('id',campus.id,'name',campus.name,'is_demo',campus."isDemo"),
  'categories',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) ORDER BY c.name),'[]'::jsonb) FROM public."Category" c WHERE c.id<>'transportation'),
  'locations',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'building',l.building,'hours',l.hours,'instructions',l.instructions) ORDER BY l.name),'[]'::jsonb) FROM public."Location" l WHERE l."campusId"=campus.id AND l.active));
END $$;

CREATE FUNCTION public.exchange_listings(
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
  SELECT l.id,l."createdAt",coalesce((SELECT sum(s."onHand"-s.reserved) FROM public."StockLot" s WHERE s."listingId"=l.id AND s.status='RECEIVED'),0) AS available
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

CREATE FUNCTION public.exchange_listing(listing_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE row public."Listing"; member uuid;
BEGIN
 IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
 SELECT * INTO row FROM public."Listing" WHERE id=listing_id;
 member:=app.member_id(row."campusId");
 IF row.id IS NULL OR member IS NULL OR (row.status<>'OPEN' AND row."authorId"<>member) THEN PERFORM app.fail('NOT_FOUND'); END IF;
 RETURN app.listing_json(row.id);
END $$;

CREATE FUNCTION app.validate_listing_images(paths text[]) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE path text; uploaded boolean;
BEGIN
 IF cardinality(paths)>4 THEN PERFORM app.fail('VALIDATION_ERROR','Use up to four photos'); END IF;
 FOREACH path IN ARRAY paths LOOP
  IF path IS NULL OR path !~ ('^'||auth.uid()::text||'/[a-f0-9-]{36}\.(jpg|jpeg|png|webp)$') THEN
   PERFORM app.fail('VALIDATION_ERROR','Photos must be your own uploads');
  END IF;
  IF to_regclass('storage.objects') IS NULL THEN PERFORM app.fail('INVALID_STATE','Photo storage is not configured'); END IF;
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=$1 AND name=$2 AND owner_id=$3)' INTO uploaded USING 'listing-photos',path,auth.uid()::text;
  IF NOT uploaded THEN PERFORM app.fail('VALIDATION_ERROR','Upload each photo before publishing'); END IF;
 END LOOP;
END $$;

CREATE FUNCTION public.save_exchange_listing(
 campus_id uuid, listing_id uuid, payload jsonb, idempotency_key text, expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 member uuid; original public."Listing"; lot public."StockLot"; result jsonb; prior jsonb;
 fingerprint text; post_type text; title_text text; description_text text; category text; place uuid;
 qty int; photos text[]; food jsonb; allergens text[]; food_date date; name_text text; storage_text text;
 label_text text; known boolean; campus_demo boolean;
BEGIN
 member:=app.require_verified_member(campus_id);
 IF listing_id IS NULL OR payload IS NULL OR jsonb_typeof(payload)<>'object' OR idempotency_key IS NULL OR char_length(idempotency_key) NOT BETWEEN 1 AND 160 THEN
  PERFORM app.fail('VALIDATION_ERROR','Missing listing or request key');
 END IF;
 fingerprint:=inventory.request_hash('listing.save',jsonb_build_object('campus_id',campus_id,'listing_id',listing_id,'payload',payload,'expected_updated_at',expected_updated_at));
 prior:=inventory.claim(member,idempotency_key,'listing.save',fingerprint);
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 post_type:=payload->>'kind'; title_text:=btrim(payload->>'title'); description_text:=btrim(payload->>'description'); category:=payload->>'category_id';
 IF post_type IS NULL OR post_type NOT IN ('offer','request') OR title_text IS NULL OR char_length(title_text) NOT BETWEEN 3 AND 80 OR description_text IS NULL OR char_length(description_text) NOT BETWEEN 10 AND 2000
  OR NOT EXISTS(SELECT 1 FROM public."Category" c WHERE c.id=category AND c.id<>'transportation') THEN
  PERFORM app.fail('VALIDATION_ERROR','Choose a category and include a title (3-80 characters) and description (10-2000 characters)');
 END IF;
 BEGIN
  place:=(payload->>'location_id')::uuid;
  qty:=CASE WHEN payload->>'quantity' IS NULL THEN NULL ELSE (payload->>'quantity')::int END;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN PERFORM app.fail('VALIDATION_ERROR','Invalid location or quantity'); END;
 IF place IS NULL OR NOT EXISTS(SELECT 1 FROM public."Location" l WHERE l.id=place AND l."campusId"=campus_id AND l.active) THEN PERFORM app.fail('NOT_FOUND','Choose an active pickup location in your campus'); END IF;
 IF (post_type='offer' AND qty IS NULL) OR (qty IS NOT NULL AND (qty<1 OR qty>1000)) THEN PERFORM app.fail('VALIDATION_ERROR','Quantity must be a whole number from 1 to 1000'); END IF;
 IF jsonb_typeof(payload->'images') IS DISTINCT FROM 'array' THEN PERFORM app.fail('VALIDATION_ERROR','Invalid photo list'); END IF;
 SELECT coalesce(array_agg(value),'{}'::text[]) INTO photos FROM jsonb_array_elements_text(payload->'images');
 IF post_type='offer' AND cardinality(photos)=0 THEN PERFORM app.fail('VALIDATION_ERROR','Add a real photo of the item you are offering'); END IF;
 PERFORM app.validate_listing_images(photos);
 food:=payload->'food';
 IF category='food' AND post_type='offer' THEN
  IF jsonb_typeof(food) IS DISTINCT FROM 'object' OR food->'opened' IS DISTINCT FROM 'false'::jsonb OR food->'shelf_stable' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(food->'allergens_known') IS DISTINCT FROM 'boolean' OR jsonb_typeof(food->'allergens') IS DISTINCT FROM 'array' THEN
   PERFORM app.fail('VALIDATION_ERROR','Food must be sealed and shelf-stable, with an explicit allergen state');
  END IF;
  IF food->>'best_by' IS NULL OR food->>'best_by' !~ '^\d{4}-\d{2}-\d{2}$' THEN PERFORM app.fail('VALIDATION_ERROR','Add the package date'); END IF;
  BEGIN food_date:=(food->>'best_by')::date; EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN PERFORM app.fail('VALIDATION_ERROR','Invalid package date'); END;
  name_text:=btrim(food->>'food_name'); storage_text:=btrim(food->>'storage'); label_text:=food->>'date_label'; known:=(food->>'allergens_known')::boolean;
  SELECT coalesce(array_agg(btrim(value)),'{}'::text[]) INTO allergens FROM jsonb_array_elements_text(food->'allergens');
  IF name_text IS NULL OR char_length(name_text) NOT BETWEEN 1 AND 100 OR storage_text IS NULL OR char_length(storage_text) NOT BETWEEN 1 AND 500 OR label_text IS NULL OR label_text NOT IN ('best_by','use_by','expiration') OR food_date<(current_timestamp AT TIME ZONE 'America/Los_Angeles')::date OR cardinality(allergens)>20 OR (NOT known AND cardinality(allergens)>0) OR EXISTS(SELECT 1 FROM unnest(allergens) a WHERE a IS NULL OR char_length(a) NOT BETWEEN 1 AND 80) THEN
   PERFORM app.fail('VALIDATION_ERROR','Check the food name, date, storage and allergens');
  END IF;
 END IF;
 SELECT * INTO original FROM public."Listing" l WHERE l.id=listing_id FOR UPDATE;
 IF original.id IS NOT NULL THEN
  IF original."authorId"<>member OR original."campusId"<>campus_id THEN PERFORM app.fail('NOT_FOUND'); END IF;
  IF original.status<>'OPEN' OR lower(original.kind::text)<>post_type THEN PERFORM app.fail('INVALID_STATE','Only an open listing can be edited; its post type cannot change'); END IF;
  IF expected_updated_at IS NULL OR original."updatedAt"<>expected_updated_at THEN PERFORM app.fail('INVALID_STATE','This post changed since you opened it. Reload before editing'); END IF;
  SELECT * INTO lot FROM public."StockLot" s WHERE s."listingId"=listing_id ORDER BY s.id LIMIT 1 FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public."StockLot" s WHERE s."listingId"=listing_id AND s.status<>'PLEDGED') THEN PERFORM app.fail('INVALID_STATE','Staff have already processed this offer. Ask them to correct it'); END IF;
  UPDATE public."Listing" SET title=title_text,description=description_text,"categoryId"=category,"locationId"=place,quantity=qty,images=photos,"updatedAt"=clock_timestamp() WHERE id=listing_id;
 ELSE
  IF expected_updated_at IS NOT NULL THEN PERFORM app.fail('NOT_FOUND'); END IF;
  SELECT "isDemo" INTO campus_demo FROM public."Campus" WHERE id=campus_id;
  INSERT INTO public."Listing"(id,"campusId","authorId","categoryId","locationId",title,description,kind,quantity,images,"isDemo","updatedAt")
  VALUES(listing_id,campus_id,member,category,place,title_text,description_text,upper(post_type)::public."ListingKind",qty,photos,campus_demo,clock_timestamp());
 END IF;
 IF post_type='offer' THEN
  IF lot.id IS NULL THEN
   INSERT INTO public."StockLot"(id,"campusId","listingId","locationId",pledged) VALUES(gen_random_uuid(),campus_id,listing_id,place,qty) RETURNING * INTO lot;
  ELSE UPDATE public."StockLot" SET pledged=qty,"locationId"=place WHERE id=lot.id; END IF;
 END IF;
 DELETE FROM public."FoodDetails" WHERE "listingId"=listing_id;
 IF lot.id IS NOT NULL THEN DELETE FROM public."StockFoodDetails" WHERE "stockLotId"=lot.id; END IF;
 IF category='food' AND post_type='offer' THEN
  INSERT INTO public."FoodDetails"("listingId","foodName","dateLabel","bestBy",opened,"shelfStable",storage,allergens,"allergensKnown") VALUES(listing_id,name_text,label_text,food_date,false,true,storage_text,allergens,known);
  INSERT INTO public."StockFoodDetails"("stockLotId","foodName",photo,"dateLabel","bestBy",opened,"shelfStable",storage,allergens,"allergensKnown") VALUES(lot.id,name_text,photos[1],label_text,food_date,false,true,storage_text,allergens,known);
 END IF;
 result:=jsonb_build_object('data',app.listing_json(listing_id),'request_id',idempotency_key);
 RETURN inventory.finish(member,idempotency_key,result);
END $$;

-- Private photos: only their uploader or verified members who can see the
-- associated listing may read. Used by Storage signed URL authorization.
CREATE FUNCTION app.can_read_listing_photo(path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT auth.uid() IS NOT NULL AND (split_part(path,'/',1)=auth.uid()::text OR EXISTS(
  SELECT 1 FROM public."Listing" l WHERE path=ANY(l.images) AND app.is_verified_member(l."campusId") AND (l.status='OPEN' OR l."authorId"=app.member_id(l."campusId"))
 ))
$$;
CREATE FUNCTION app.can_delete_listing_photo(path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT auth.uid() IS NOT NULL AND split_part(path,'/',1)=auth.uid()::text AND NOT EXISTS(SELECT 1 FROM public."Listing" l WHERE path=ANY(l.images))
 AND NOT EXISTS(SELECT 1 FROM public."StockFoodDetails" f WHERE f.photo=path)
$$;
REVOKE ALL ON FUNCTION app.listing_json(uuid),app.validate_listing_images(text[]),app.can_read_listing_photo(text),app.can_delete_listing_photo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_read_listing_photo(text),app.can_delete_listing_photo(text) TO authenticated;
REVOKE ALL ON FUNCTION public.exchange_catalog(text),public.exchange_listings(uuid,text,text,text,uuid,boolean,boolean,text,int),public.exchange_listing(uuid),public.save_exchange_listing(uuid,uuid,jsonb,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.exchange_catalog(text),public.exchange_listings(uuid,text,text,text,uuid,boolean,boolean,text,int),public.exchange_listing(uuid),public.save_exchange_listing(uuid,uuid,jsonb,text,timestamptz) TO authenticated;

-- Supabase owns storage. On plain PostgreSQL this block does nothing; upload
-- validation fails closed until Storage exists. Test fixtures live elsewhere.
DO $storage$
BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  VALUES('listing-photos','listing-photos',false,5242880,ARRAY['image/jpeg','image/png','image/webp'])
  ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=5242880,allowed_mime_types=EXCLUDED.allowed_mime_types;
  EXECUTE 'CREATE POLICY bnf_photo_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id=''listing-photos'' AND split_part(name,''/'',1)=auth.uid()::text AND EXISTS(SELECT 1 FROM public."Membership" m WHERE m.id=app.member_id(m."campusId")))';
  EXECUTE 'CREATE POLICY bnf_photo_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id=''listing-photos'' AND app.can_read_listing_photo(name))';
  EXECUTE 'CREATE POLICY bnf_photo_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id=''listing-photos'' AND app.can_delete_listing_photo(name))';
 END IF;
END $storage$;
