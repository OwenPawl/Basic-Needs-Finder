-- Community food posts: homemade/prepared meals and free-food events shared
-- student to student. Separate from the sealed-goods exchange: no StockLot,
-- no mail-desk receipt, no staff involvement implied. Browser roles have no
-- table access; everything goes through the SECURITY DEFINER RPCs below,
-- which take the caller from auth.uid() via the student-auth helpers.
-- Numbering: 0011/0012 are reserved for staff work.

CREATE TABLE public."FoodPost" (
  id UUID PRIMARY KEY,
  "campusId" UUID NOT NULL REFERENCES public."Campus"(id),
  "authorId" UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('meal', 'event')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 10 AND 2000),
  photos TEXT[] NOT NULL CHECK (cardinality(photos) BETWEEN 1 AND 4),
  servings INT CHECK (servings BETWEEN 1 AND 500),
  "preparedAt" TIMESTAMPTZ(3),
  "availableFrom" TIMESTAMPTZ(3) NOT NULL,
  "availableUntil" TIMESTAMPTZ(3) NOT NULL,
  "pickupPlace" TEXT NOT NULL CHECK (char_length("pickupPlace") BETWEEN 3 AND 160),
  "pickupInstructions" TEXT NOT NULL DEFAULT '' CHECK (char_length("pickupInstructions") <= 600),
  ingredients TEXT NOT NULL DEFAULT '' CHECK (char_length(ingredients) <= 1000),
  allergens TEXT[] NOT NULL DEFAULT '{}',
  "allergensKnown" BOOLEAN NOT NULL,
  handling TEXT NOT NULL DEFAULT '' CHECK (char_length(handling) <= 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'removed')),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "closedAt" TIMESTAMPTZ(3),
  CONSTRAINT "FoodPost_author_campus_fkey" FOREIGN KEY ("authorId", "campusId")
    REFERENCES public."Membership"(id, "campusId"),
  CONSTRAINT "FoodPost_window" CHECK ("availableUntil" > "availableFrom"),
  CONSTRAINT "FoodPost_meal_fields" CHECK (kind <> 'meal' OR ("preparedAt" IS NOT NULL AND servings IS NOT NULL)),
  CONSTRAINT "FoodPost_unknown_allergens" CHECK ("allergensKnown" OR cardinality(allergens) = 0),
  CONSTRAINT "FoodPost_id_campus_key" UNIQUE (id, "campusId")
);
CREATE INDEX "FoodPost_campus_window_idx" ON public."FoodPost" ("campusId", status, "availableUntil");
ALTER TABLE public."FoodPost" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."FoodPost" FROM PUBLIC, anon, authenticated;

-- Messaging adapter: a conversation is about exactly one listing OR one food post.
ALTER TABLE public."Conversation" ALTER COLUMN "listingId" DROP NOT NULL;
ALTER TABLE public."Conversation" ADD COLUMN "foodPostId" UUID;
ALTER TABLE public."Conversation" ADD CONSTRAINT "Conversation_foodPost_campus_fkey"
  FOREIGN KEY ("foodPostId", "campusId") REFERENCES public."FoodPost"(id, "campusId");
ALTER TABLE public."Conversation" ADD CONSTRAINT "Conversation_one_subject"
  CHECK (("listingId" IS NULL) <> ("foodPostId" IS NULL));
CREATE INDEX "Conversation_foodPost_idx" ON public."Conversation" ("foodPostId");

-- Computed state; nothing is stored for expiry.
CREATE FUNCTION app.food_post_state(p public."FoodPost") RETURNS TEXT
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p.status <> 'open' THEN p.status
    WHEN p."availableUntil" <= now() THEN 'expired'
    WHEN p."availableFrom" > now() THEN 'upcoming'
    ELSE 'available' END
$$;

CREATE FUNCTION app.food_post_json(post_id UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'campus_id', p."campusId", 'kind', p.kind, 'title', p.title,
    'description', p.description, 'photos', to_jsonb(p.photos), 'servings', p.servings,
    'prepared_at', p."preparedAt", 'available_from', p."availableFrom",
    'available_until', p."availableUntil", 'pickup_place', p."pickupPlace",
    'pickup_instructions', p."pickupInstructions", 'ingredients', p.ingredients,
    'allergens', to_jsonb(p.allergens), 'allergens_known', p."allergensKnown",
    'handling', p.handling, 'status', p.status, 'state', app.food_post_state(p),
    'author_name', u."displayName", 'is_owner', p."authorId" = app.member_id(p."campusId"),
    'created_at', p."createdAt", 'updated_at', p."updatedAt", 'closed_at', p."closedAt")
  FROM public."FoodPost" p
  JOIN public."Membership" m ON m.id = p."authorId"
  JOIN public."User" u ON u.id = m."userId"
  WHERE p.id = post_id
$$;

-- Posts are student-to-student: no phone numbers or emails in public text.
CREATE FUNCTION app.has_contact_details(value TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(value, '') ~* '[^[:space:]@]+@[^[:space:]@]+\.[a-z]{2,}'
      OR coalesce(value, '') ~ '(\+?1[ .-]?)?\(?[0-9]{3}\)?[ .-]?[0-9]{3}[ .-]?[0-9]{4}'
$$;

CREATE FUNCTION public.food_posts(campus_id UUID, post_kind TEXT DEFAULT '', mine_only BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE member UUID; result JSONB;
BEGIN
  member := app.require_verified_member(campus_id);
  IF post_kind IS NULL OR post_kind NOT IN ('', 'meal', 'event') OR mine_only IS NULL THEN
    PERFORM app.fail('VALIDATION_ERROR', 'Invalid food post filters');
  END IF;
  SELECT coalesce(jsonb_agg(app.food_post_json(p.id) ORDER BY p."availableFrom", p.id), '[]'::jsonb) INTO result
  FROM public."FoodPost" p
  WHERE p."campusId" = campus_id
    AND (post_kind = '' OR p.kind = post_kind)
    AND CASE WHEN mine_only THEN p."authorId" = member AND p.status <> 'removed'
             ELSE p.status = 'open' AND p."availableUntil" > now() END;
  RETURN result;
END $$;

CREATE FUNCTION public.food_post(post_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public."FoodPost"; member UUID;
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  SELECT * INTO p FROM public."FoodPost" WHERE id = post_id;
  member := CASE WHEN p.id IS NULL THEN NULL ELSE app.member_id(p."campusId") END;
  IF member IS NULL OR (p.status = 'removed' AND p."authorId" <> member) THEN
    PERFORM app.fail('NOT_FOUND');
  END IF;
  RETURN app.food_post_json(p.id);
END $$;

CREATE FUNCTION public.save_food_post(campus_id UUID, post_id UUID, payload JSONB, idempotency_key TEXT, expected_updated_at TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  member UUID; original public."FoodPost"; prior JSONB; result JSONB;
  post_kind TEXT; title_text TEXT; description_text TEXT; place TEXT; instructions TEXT;
  ingredient_text TEXT; handling_text TEXT; photo_list TEXT[]; allergen_list TEXT[];
  known BOOLEAN; serving_count INT; prepared TIMESTAMPTZ; window_start TIMESTAMPTZ; window_end TIMESTAMPTZ;
  longest INTERVAL;
BEGIN
  member := app.require_verified_member(campus_id);
  IF post_id IS NULL OR payload IS NULL OR jsonb_typeof(payload) <> 'object'
     OR idempotency_key IS NULL OR char_length(idempotency_key) NOT BETWEEN 1 AND 160 THEN
    PERFORM app.fail('VALIDATION_ERROR', 'Missing post or request key');
  END IF;
  prior := inventory.claim(member, idempotency_key, 'food.save',
    inventory.request_hash('food.save', jsonb_build_object('campus_id', campus_id, 'post_id', post_id,
      'payload', payload, 'expected_updated_at', expected_updated_at)));
  IF prior IS NOT NULL THEN RETURN prior; END IF;

  post_kind := payload->>'kind';
  title_text := btrim(payload->>'title');
  description_text := btrim(payload->>'description');
  place := btrim(payload->>'pickup_place');
  instructions := coalesce(btrim(payload->>'pickup_instructions'), '');
  ingredient_text := coalesce(btrim(payload->>'ingredients'), '');
  handling_text := coalesce(btrim(payload->>'handling'), '');
  IF post_kind IS NULL OR post_kind NOT IN ('meal', 'event')
     OR title_text IS NULL OR char_length(title_text) NOT BETWEEN 3 AND 80
     OR description_text IS NULL OR char_length(description_text) NOT BETWEEN 10 AND 2000
     OR place IS NULL OR char_length(place) NOT BETWEEN 3 AND 160
     OR char_length(instructions) > 600 OR char_length(ingredient_text) > 1000 OR char_length(handling_text) > 500 THEN
    PERFORM app.fail('VALIDATION_ERROR', 'Check the title (3-80), description (10-2000), pickup place and notes');
  END IF;
  IF app.has_contact_details(title_text || ' ' || description_text || ' ' || place || ' ' || instructions || ' ' || handling_text) THEN
    PERFORM app.fail('VALIDATION_ERROR', 'Remove phone numbers and email addresses. Use private messages to arrange pickup');
  END IF;
  IF jsonb_typeof(payload->'photos') IS DISTINCT FROM 'array'
     OR jsonb_typeof(payload->'allergens') IS DISTINCT FROM 'array'
     OR jsonb_typeof(payload->'allergens_known') IS DISTINCT FROM 'boolean' THEN
    PERFORM app.fail('VALIDATION_ERROR', 'Invalid photos or allergen information');
  END IF;
  SELECT coalesce(array_agg(value), '{}') INTO photo_list FROM jsonb_array_elements_text(payload->'photos');
  IF cardinality(photo_list) = 0 THEN PERFORM app.fail('VALIDATION_ERROR', 'Add a real photo of the food'); END IF;
  PERFORM app.validate_listing_images(photo_list);
  known := (payload->>'allergens_known')::boolean;
  SELECT coalesce(array_agg(btrim(value)), '{}') INTO allergen_list FROM jsonb_array_elements_text(payload->'allergens');
  IF cardinality(allergen_list) > 20 OR (NOT known AND cardinality(allergen_list) > 0)
     OR EXISTS (SELECT 1 FROM unnest(allergen_list) a WHERE char_length(a) NOT BETWEEN 1 AND 80) THEN
    PERFORM app.fail('VALIDATION_ERROR', 'List allergens, or mark them as unknown');
  END IF;
  BEGIN
    serving_count := CASE WHEN payload->>'servings' IS NULL THEN NULL ELSE (payload->>'servings')::int END;
    prepared := CASE WHEN payload->>'prepared_at' IS NULL THEN NULL ELSE (payload->>'prepared_at')::timestamptz END;
    window_start := (payload->>'available_from')::timestamptz;
    window_end := (payload->>'available_until')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN
    PERFORM app.fail('VALIDATION_ERROR', 'Invalid number or time');
  END;
  -- (No CASE inside the IF: PL/pgSQL ends an IF condition at its first THEN.)
  longest := CASE WHEN post_kind = 'meal' THEN interval '24 hours' ELSE interval '12 hours' END;
  IF window_start IS NULL OR window_end IS NULL OR window_end <= window_start
     OR window_end <= now() OR window_start > now() + interval '14 days'
     OR window_end - window_start > longest THEN
    PERFORM app.fail('VALIDATION_ERROR', 'Choose a future window: up to 24 hours for meals, 12 hours for events, within the next 14 days');
  END IF;
  IF serving_count IS NOT NULL AND serving_count NOT BETWEEN 1 AND 500 THEN
    PERFORM app.fail('VALIDATION_ERROR', 'Servings must be 1-500');
  END IF;
  IF post_kind = 'meal' AND (serving_count IS NULL OR prepared IS NULL
     OR prepared > now() + interval '5 minutes' OR prepared < now() - interval '48 hours'
     OR window_start < prepared) THEN
    PERFORM app.fail('VALIDATION_ERROR', 'Meals need servings and a preparation time within the last 48 hours, before pickup');
  END IF;
  IF post_kind = 'event' THEN prepared := NULL; END IF;

  SELECT * INTO original FROM public."FoodPost" p WHERE p.id = post_id FOR UPDATE;
  IF original.id IS NOT NULL THEN
    IF original."authorId" <> member OR original."campusId" <> campus_id THEN PERFORM app.fail('NOT_FOUND'); END IF;
    IF original.status <> 'open' OR original.kind <> post_kind THEN
      PERFORM app.fail('INVALID_STATE', 'Only an open post can be edited; its type cannot change');
    END IF;
    IF expected_updated_at IS NULL OR original."updatedAt" <> expected_updated_at THEN
      PERFORM app.fail('INVALID_STATE', 'This post changed since you opened it. Reload before editing');
    END IF;
    UPDATE public."FoodPost" SET title = title_text, description = description_text, photos = photo_list,
      servings = serving_count, "preparedAt" = prepared, "availableFrom" = window_start, "availableUntil" = window_end,
      "pickupPlace" = place, "pickupInstructions" = instructions, ingredients = ingredient_text,
      allergens = allergen_list, "allergensKnown" = known, handling = handling_text, "updatedAt" = clock_timestamp()
    WHERE id = post_id;
  ELSE
    IF expected_updated_at IS NOT NULL THEN PERFORM app.fail('NOT_FOUND'); END IF;
    INSERT INTO public."FoodPost" (id, "campusId", "authorId", kind, title, description, photos, servings,
      "preparedAt", "availableFrom", "availableUntil", "pickupPlace", "pickupInstructions", ingredients,
      allergens, "allergensKnown", handling, "createdAt", "updatedAt")
    VALUES (post_id, campus_id, member, post_kind, title_text, description_text, photo_list, serving_count,
      prepared, window_start, window_end, place, instructions, ingredient_text,
      allergen_list, known, handling_text, clock_timestamp(), clock_timestamp());
  END IF;
  result := jsonb_build_object('data', app.food_post_json(post_id), 'request_id', idempotency_key);
  RETURN inventory.finish(member, idempotency_key, result);
END $$;

-- The author closes their own post; a campus admin can remove one.
CREATE FUNCTION public.close_food_post(post_id UUID, remove BOOLEAN DEFAULT false) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public."FoodPost"; member UUID;
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  SELECT * INTO p FROM public."FoodPost" WHERE id = post_id FOR UPDATE;
  member := CASE WHEN p.id IS NULL THEN NULL ELSE app.member_id(p."campusId") END;
  IF member IS NULL OR p.status = 'removed' THEN PERFORM app.fail('NOT_FOUND'); END IF;
  IF remove THEN
    IF NOT app.is_campus_admin(p."campusId") THEN PERFORM app.fail('FORBIDDEN', 'campus admin required'); END IF;
    UPDATE public."FoodPost" SET status = 'removed', "closedAt" = coalesce("closedAt", clock_timestamp()), "updatedAt" = clock_timestamp() WHERE id = post_id;
  ELSE
    IF p."authorId" <> member THEN PERFORM app.fail('NOT_FOUND'); END IF;
    UPDATE public."FoodPost" SET status = 'closed', "closedAt" = coalesce("closedAt", clock_timestamp()), "updatedAt" = clock_timestamp()
    WHERE id = post_id AND status = 'open';
  END IF;
  RETURN app.food_post_json(post_id);
END $$;

CREATE FUNCTION public.start_food_conversation(post_id UUID) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public."FoodPost"; me UUID; existing UUID; created UUID := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  SELECT * INTO p FROM public."FoodPost" WHERE id = post_id FOR UPDATE;
  me := CASE WHEN p.id IS NULL THEN NULL ELSE app.member_id(p."campusId") END;
  IF me IS NULL OR p.status = 'removed' THEN PERFORM app.fail('NOT_FOUND'); END IF;
  IF p."authorId" = me THEN PERFORM app.fail('VALIDATION_ERROR', 'you cannot message your own post'); END IF;
  SELECT c.id INTO existing FROM public."Conversation" c
  JOIN public."ConversationParticipant" a ON a."conversationId" = c.id AND a."memberId" = me
  JOIN public."ConversationParticipant" b ON b."conversationId" = c.id AND b."memberId" = p."authorId"
  WHERE c."foodPostId" = p.id LIMIT 1;
  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object('conversation_id', existing, 'food_post_id', p.id, 'created', false);
  END IF;
  IF app.food_post_state(p) NOT IN ('available', 'upcoming') THEN
    PERFORM app.fail('INVALID_STATE', 'this food post is closed or has expired');
  END IF;
  INSERT INTO public."Conversation" (id, "campusId", "foodPostId") VALUES (created, p."campusId", p.id);
  INSERT INTO public."ConversationParticipant" ("conversationId", "memberId", "campusId")
  VALUES (created, me, p."campusId"), (created, p."authorId", p."campusId");
  RETURN jsonb_build_object('conversation_id', created, 'food_post_id', p.id, 'created', true);
END $$;

-- Inbox and thread now describe either subject. Payload keys stay compatible.
CREATE OR REPLACE FUNCTION public.my_conversations() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  SELECT coalesce(jsonb_agg(row ORDER BY (row ->> 'last_at') DESC NULLS LAST), '[]'::jsonb) INTO result
  FROM (
    SELECT jsonb_build_object(
      'conversation_id', c.id,
      'subject', CASE WHEN c."foodPostId" IS NULL THEN 'listing' ELSE 'food' END,
      'listing_id', c."listingId",
      'food_post_id', c."foodPostId",
      'listing_title', coalesce(l.title, f.title),
      'listing_kind', CASE WHEN f.id IS NULL THEN lower(l.kind::text) ELSE f.kind END,
      'other_display_name', (
        SELECT u."displayName" FROM public."ConversationParticipant" o
        JOIN public."Membership" om ON om.id = o."memberId"
        JOIN public."User" u ON u.id = om."userId"
        WHERE o."conversationId" = c.id AND o."memberId" <> mine."memberId" LIMIT 1),
      'last_message', (SELECT left(m.body, 140) FROM public."Message" m
        WHERE m."conversationId" = c.id ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1),
      'last_at', coalesce((SELECT max(m."createdAt") FROM public."Message" m
        WHERE m."conversationId" = c.id), c."createdAt")
    ) AS row
    FROM public."ConversationParticipant" mine
    JOIN public."Membership" mm ON mm.id = mine."memberId"
      AND mm."userId" = app.current_user_id() AND mm."verifiedAt" IS NOT NULL
    JOIN public."Conversation" c ON c.id = mine."conversationId"
    LEFT JOIN public."Listing" l ON l.id = c."listingId"
    LEFT JOIN public."FoodPost" f ON f.id = c."foodPostId"
  ) rows;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.conversation_messages(conversation_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE campus UUID; me UUID; result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  SELECT c."campusId" INTO campus FROM public."Conversation" c WHERE c.id = conversation_id;
  IF campus IS NULL OR NOT app.is_conversation_participant(conversation_id) THEN
    PERFORM app.fail('NOT_FOUND');
  END IF;
  me := app.member_id(campus);
  SELECT jsonb_build_object(
    'conversation_id', c.id,
    'subject', CASE WHEN c."foodPostId" IS NULL THEN 'listing' ELSE 'food' END,
    'listing_id', c."listingId",
    'food_post_id', c."foodPostId",
    'listing_title', coalesce(l.title, f.title),
    'messages', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'mine', m."senderId" = me, 'sender_name', u."displayName",
        'body', m.body, 'created_at', m."createdAt") ORDER BY m."createdAt", m.id)
      FROM public."Message" m
      JOIN public."Membership" sm ON sm.id = m."senderId"
      JOIN public."User" u ON u.id = sm."userId"
      WHERE m."conversationId" = c.id), '[]'::jsonb)
  ) INTO result
  FROM public."Conversation" c
  LEFT JOIN public."Listing" l ON l.id = c."listingId"
  LEFT JOIN public."FoodPost" f ON f.id = c."foodPostId"
  WHERE c.id = conversation_id;
  RETURN result;
END $$;

-- Food-post photos use the existing private bucket: readable by verified
-- members while the post is visible, never deletable while a post uses them.
CREATE OR REPLACE FUNCTION app.can_read_listing_photo(path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT auth.uid() IS NOT NULL AND (split_part(path,'/',1)=auth.uid()::text OR EXISTS(
  SELECT 1 FROM public."Listing" l WHERE path=ANY(l.images) AND app.is_verified_member(l."campusId") AND (l.status='OPEN' OR l."authorId"=app.member_id(l."campusId"))
 ) OR EXISTS(
  SELECT 1 FROM public."FoodPost" f WHERE path=ANY(f.photos) AND app.is_verified_member(f."campusId") AND (f.status='open' OR f."authorId"=app.member_id(f."campusId"))
 ))
$$;
CREATE OR REPLACE FUNCTION app.can_delete_listing_photo(path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT auth.uid() IS NOT NULL AND split_part(path,'/',1)=auth.uid()::text
 AND NOT EXISTS(SELECT 1 FROM public."Listing" l WHERE path=ANY(l.images))
 AND NOT EXISTS(SELECT 1 FROM public."StockFoodDetails" f WHERE f.photo=path)
 AND NOT EXISTS(SELECT 1 FROM public."FoodPost" p WHERE path=ANY(p.photos))
$$;

REVOKE ALL ON FUNCTION app.food_post_state(public."FoodPost"), app.food_post_json(UUID), app.has_contact_details(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.food_posts(UUID, TEXT, BOOLEAN), public.food_post(UUID),
  public.save_food_post(UUID, UUID, JSONB, TEXT, TIMESTAMPTZ), public.close_food_post(UUID, BOOLEAN),
  public.start_food_conversation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.food_posts(UUID, TEXT, BOOLEAN), public.food_post(UUID),
  public.save_food_post(UUID, UUID, JSONB, TEXT, TIMESTAMPTZ), public.close_food_post(UUID, BOOLEAN),
  public.start_food_conversation(UUID) TO authenticated;
