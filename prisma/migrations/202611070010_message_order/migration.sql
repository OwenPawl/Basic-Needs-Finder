-- Keep message order stable. "createdAt" has millisecond precision, so two
-- messages sent within the same millisecond could tie and come back in either
-- order. Serialize sends per conversation and make each timestamp strictly
-- later than the previous one. Same checks and payload as migration 0008.
CREATE OR REPLACE FUNCTION public.send_message(conversation_id UUID, body TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  campus UUID;
  me UUID;
  text_body TEXT := btrim(body);
  message UUID := gen_random_uuid();
  latest TIMESTAMPTZ;
  sent TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN PERFORM app.fail('UNAUTHENTICATED'); END IF;
  SELECT c."campusId" INTO campus FROM public."Conversation" c WHERE c.id = conversation_id FOR UPDATE;
  IF campus IS NULL OR NOT app.is_conversation_participant(conversation_id) THEN
    PERFORM app.fail('NOT_FOUND');
  END IF;
  me := app.member_id(campus);
  IF text_body IS NULL OR char_length(text_body) NOT BETWEEN 1 AND 2000 THEN
    PERFORM app.fail('VALIDATION_ERROR', 'message must be 1-2000 characters');
  END IF;
  SELECT max(m."createdAt") INTO latest FROM public."Message" m WHERE m."conversationId" = conversation_id;
  sent := date_trunc('milliseconds', clock_timestamp());
  IF latest IS NOT NULL AND sent <= latest THEN sent := latest + interval '1 millisecond'; END IF;
  INSERT INTO public."Message" (id, "conversationId", "senderId", body, "createdAt")
  VALUES (message, conversation_id, me, text_body, sent);
  RETURN jsonb_build_object('id', message, 'conversation_id', conversation_id,
    'mine', true, 'body', text_body, 'created_at', sent);
END $$;
