
create table public.rooms (
  id text primary key,
  host_player_id uuid not null,
  host_name text not null,
  prize_ff numeric not null default 0,
  prize_line1 numeric not null default 0,
  prize_line2 numeric not null default 0,
  prize_line3 numeric not null default 0,
  prize_housie numeric not null default 0,
  housies_allowed int not null default 1,
  called_numbers int[] not null default '{}',
  housies_won int not null default 0,
  claimed jsonb not null default '{}'::jsonb,
  status text not null default 'waiting',
  created_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(id) on delete cascade,
  name text not null,
  ticket jsonb not null,
  marked_numbers int[] not null default '{}',
  purse numeric not null default 0,
  joined_at timestamptz not null default now()
);

create index on public.players(room_id);

alter table public.rooms enable row level security;
alter table public.players enable row level security;

create policy "rooms_all" on public.rooms for all using (true) with check (true);
create policy "players_all" on public.players for all using (true) with check (true);

alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.players;
alter table public.rooms replica identity full;
alter table public.players replica identity full;
