create or replace function public.draw_tambola_number(
  p_room_id text,
  p_host_player_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_remaining int[];
  v_pick int;
  v_called int[];
  v_status text;
begin
  select *
  into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'Room not found');
  end if;

  if v_room.host_player_id <> p_host_player_id then
    return jsonb_build_object('ok', false, 'reason', 'Only the host can call numbers');
  end if;

  if v_room.game_type <> 'tambola' then
    return jsonb_build_object('ok', false, 'reason', 'This room is not a Tambola room');
  end if;

  if v_room.status not in ('waiting', 'playing') then
    return jsonb_build_object('ok', false, 'reason', 'Room is not active');
  end if;

  select array_agg(n order by n)
  into v_remaining
  from generate_series(1, 90) as n
  where not (n = any(coalesce(v_room.called_numbers, '{}')));

  if coalesce(array_length(v_remaining, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'All numbers called');
  end if;

  v_pick := v_remaining[1 + floor(random() * array_length(v_remaining, 1))::int];
  v_called := coalesce(v_room.called_numbers, '{}') || v_pick;
  v_status := case when v_room.status = 'waiting' then 'playing' else v_room.status end;

  update public.rooms
  set called_numbers = v_called,
      status = v_status
  where id = p_room_id;

  return jsonb_build_object(
    'ok', true,
    'number', v_pick,
    'called_numbers', v_called,
    'status', v_status
  );
end;
$$;
