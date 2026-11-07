-- messaging-core: private conversations about a listing between two verified
-- members of the listing's campus. Reads and writes go through these
-- SECURITY DEFINER RPCs; the caller always comes from auth.uid() via the
-- student-auth helpers, never from arguments. No email/contact data returned.

CREATE FUNCTION public.start_conversation(listing_id UUID) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  listing RECORD;
  me UUID;
  existing UUID;
  created UUID := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  SELECT l.id, l."campusId", l."authorId", l.status INTO listing
  FROM public."Listing" l WHERE l.id = listing_id;
  me := CASE WHEN listing.id IS NULL THEN NULL ELSE app.member_id(listing."campusId") END;
  -- Unknown listings and other campuses look the same.
  IF me IS NULL OR (listing.status = 'REMOVED' AND listing."authorId" <> me) THEN
    PERFORM app.fail('NOT_FOUND');
  END IF;
  IF listing."authorId" = me THEN
    PERFORM app.fail('VALIDATION_ERROR', 'you cannot message your own listing');
  END IF;
  SELECT c.id INTO existing
  FROM public."Conversation" c
  JOIN public."ConversationParticipant" a ON a."conversationId" = c.id AND a."memberId" = me
  JOIN public."ConversationParticipant" b ON b."conversationId" = c.id AND b."memberId" = listing."authorId"
  WHERE c."listingId" = listing.id
  LIMIT 1;
  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object('conversation_id', existing, 'listing_id', listing.id, 'created', false);
  END IF;
  IF listing.status <> 'OPEN' THEN
    PERFORM app.fail('INVALID_STATE', 'this listing is no longer open');
  END IF;
  INSERT INTO public."Conversation" (id, "campusId", "listingId")
  VALUES (created, listing."campusId", listing.id);
  INSERT INTO public."ConversationParticipant" ("conversationId", "memberId", "campusId")
  VALUES (created, me, listing."campusId"), (created, listing."authorId", listing."campusId");
  RETURN jsonb_build_object('conversation_id', created, 'listing_id', listing.id, 'created', true);
END $$;

CREATE FUNCTION public.send_message(conversation_id UUID, body TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  campus UUID;
  me UUID;
  text_body TEXT := btrim(body);
  message UUID := gen_random_uuid();
  sent TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  SELECT c."campusId" INTO campus FROM public."Conversation" c WHERE c.id = conversation_id;
  IF campus IS NULL OR NOT app.is_conversation_participant(conversation_id) THEN
    PERFORM app.fail('NOT_FOUND');
  END IF;
  me := app.member_id(campus);
  IF text_body IS NULL OR char_length(text_body) NOT BETWEEN 1 AND 2000 THEN
    PERFORM app.fail('VALIDATION_ERROR', 'message must be 1-2000 characters');
  END IF;
  -- clock_timestamp(): messages sent in one transaction still sort in order.
  INSERT INTO public."Message" (id, "conversationId", "senderId", body, "createdAt")
  VALUES (message, conversation_id, me, text_body, clock_timestamp())
  RETURNING "createdAt" INTO sent;
  RETURN jsonb_build_object('id', message, 'conversation_id', conversation_id,
    'mine', true, 'body', text_body, 'created_at', sent);
END $$;

CREATE FUNCTION public.my_conversations() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  SELECT coalesce(jsonb_agg(row ORDER BY (row ->> 'last_at') DESC NULLS LAST), '[]'::jsonb) INTO result
  FROM (
    SELECT jsonb_build_object(
      'conversation_id', c.id,
      'listing_id', l.id,
      'listing_title', l.title,
      'listing_kind', lower(l.kind::text),
      'other_display_name', (
        SELECT u."displayName" FROM public."ConversationParticipant" o
        JOIN public."Membership" om ON om.id = o."memberId"
        JOIN public."User" u ON u.id = om."userId"
        WHERE o."conversationId" = c.id AND o."memberId" <> mine."memberId" LIMIT 1),
      'last_message', (SELECT left(m.body, 140) FROM public."Message" m
        WHERE m."conversationId" = c.id ORDER BY m."createdAt" DESC LIMIT 1),
      'last_at', coalesce((SELECT max(m."createdAt") FROM public."Message" m
        WHERE m."conversationId" = c.id), c."createdAt")
    ) AS row
    FROM public."ConversationParticipant" mine
    JOIN public."Membership" mm ON mm.id = mine."memberId"
      AND mm."userId" = app.current_user_id() AND mm."verifiedAt" IS NOT NULL
    JOIN public."Conversation" c ON c.id = mine."conversationId"
    JOIN public."Listing" l ON l.id = c."listingId"
  ) rows;
  RETURN result;
END $$;

CREATE FUNCTION public.conversation_messages(conversation_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
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
    'listing_id', l.id,
    'listing_title', l.title,
    'messages', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id,
        'mine', m."senderId" = me,
        'sender_name', u."displayName",
        'body', m.body,
        'created_at', m."createdAt") ORDER BY m."createdAt", m.id)
      FROM public."Message" m
      JOIN public."Membership" sm ON sm.id = m."senderId"
      JOIN public."User" u ON u.id = sm."userId"
      WHERE m."conversationId" = c.id), '[]'::jsonb)
  ) INTO result
  FROM public."Conversation" c JOIN public."Listing" l ON l.id = c."listingId"
  WHERE c.id = conversation_id;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION
  public.start_conversation(UUID), public.send_message(UUID, TEXT),
  public.my_conversations(), public.conversation_messages(UUID)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.start_conversation(UUID), public.send_message(UUID, TEXT),
  public.my_conversations(), public.conversation_messages(UUID)
TO authenticated;
