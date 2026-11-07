-- Serialize conversation creation and make message retries idempotent.
CREATE OR REPLACE FUNCTION public.start_conversation(listing_id UUID) RETURNS JSONB
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
  FROM public."Listing" l WHERE l.id = listing_id FOR UPDATE;
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
CREATE FUNCTION public.send_message_once(conversation_id uuid,body text,idempotency_key text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE campus uuid; actor uuid; prior jsonb; result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
 IF NOT app.is_conversation_participant(conversation_id) THEN PERFORM app.fail('NOT_FOUND'); END IF;
 SELECT c."campusId" INTO campus FROM public."Conversation" c WHERE c.id=conversation_id;actor:=app.require_verified_member(campus);
 IF idempotency_key IS NULL OR char_length(idempotency_key) NOT BETWEEN 1 AND 160 THEN PERFORM app.fail('VALIDATION_ERROR'); END IF;
 prior:=inventory.claim(actor,idempotency_key,'message.send',inventory.request_hash('message.send',jsonb_build_object('conversation',conversation_id,'body',btrim(body))));IF prior IS NOT NULL THEN RETURN prior; END IF;
 result:=public.send_message(conversation_id,body);
 RETURN inventory.finish(actor,idempotency_key,jsonb_build_object('data',result,'request_id',idempotency_key));
END $$;
REVOKE ALL ON FUNCTION public.send_message_once(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.send_message_once(uuid,text,text) TO authenticated;
