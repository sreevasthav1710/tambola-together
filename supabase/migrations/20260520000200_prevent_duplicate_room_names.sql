create unique index if not exists players_room_lower_name_key
  on public.players(room_id, lower(name));
