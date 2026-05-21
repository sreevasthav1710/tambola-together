alter table public.rooms
  add column if not exists game_type text not null default 'tambola',
  add column if not exists game_state jsonb not null default '{}'::jsonb;

alter table public.players
  add column if not exists game_state jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'rooms_game_type_check'
  ) then
    alter table public.rooms
      add constraint rooms_game_type_check check (game_type in ('tambola', 'snake-ladder'));
  end if;
end $$;

create index if not exists rooms_game_type_status_idx on public.rooms(game_type, status, created_at desc);
