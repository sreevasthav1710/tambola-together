CREATE OR REPLACE FUNCTION public.claim_prize(
  p_room_id text,
  p_player_id uuid,
  p_type text,
  p_prize numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed jsonb;
  v_housies_allowed int;
  v_housies_won int;
  v_status text;
  v_prev jsonb;
  v_new_status text;
  v_new_housies int;
BEGIN
  -- Lock room row
  SELECT claimed, housies_allowed, housies_won, status
    INTO v_claimed, v_housies_allowed, v_housies_won, v_status
  FROM public.rooms WHERE id = p_room_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Room not found');
  END IF;

  IF v_status = 'ended' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Game ended');
  END IF;

  v_claimed := COALESCE(v_claimed, '{}'::jsonb);
  v_new_housies := v_housies_won;
  v_new_status := v_status;

  IF p_type = 'housie' THEN
    v_prev := COALESCE(v_claimed->'housie', '[]'::jsonb);
    IF jsonb_typeof(v_prev) <> 'array' THEN
      v_prev := '[]'::jsonb;
    END IF;
    IF v_prev @> to_jsonb(p_player_id::text) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'You already claimed Housie');
    END IF;
    IF jsonb_array_length(v_prev) >= v_housies_allowed THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'All Housies already claimed');
    END IF;
    v_claimed := jsonb_set(v_claimed, '{housie}', v_prev || to_jsonb(p_player_id::text));
    v_new_housies := v_housies_won + 1;
    IF v_new_housies >= v_housies_allowed THEN
      v_new_status := 'ended';
    END IF;
  ELSIF p_type IN ('ff','line1','line2','line3') THEN
    IF v_claimed ? p_type THEN
      RETURN jsonb_build_object('ok', false, 'reason', p_type || ' already claimed');
    END IF;
    v_claimed := jsonb_set(v_claimed, ARRAY[p_type], to_jsonb(p_player_id::text));
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'Invalid claim type');
  END IF;

  UPDATE public.rooms
    SET claimed = v_claimed,
        housies_won = v_new_housies,
        status = v_new_status
    WHERE id = p_room_id;

  UPDATE public.players
    SET purse = purse + p_prize
    WHERE id = p_player_id AND room_id = p_room_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_prize(text, uuid, text, numeric) TO anon, authenticated;