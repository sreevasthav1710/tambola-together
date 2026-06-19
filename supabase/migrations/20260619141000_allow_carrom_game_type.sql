alter table public.rooms
  drop constraint if exists rooms_game_type_check;

alter table public.rooms
  add constraint rooms_game_type_check
  check (game_type in ('tambola', 'snake-ladder', 'chess', 'carrom'));
