-- Allow 'uno' as a game type and add winners_needed column for UNO rooms.
alter table public.rooms
  drop constraint if exists rooms_game_type_check;

alter table public.rooms
  add constraint rooms_game_type_check
  check (game_type in ('tambola', 'snake-ladder', 'chess', 'carrom', 'uno'));

alter table public.rooms
  add column if not exists winners_needed integer not null default 1;