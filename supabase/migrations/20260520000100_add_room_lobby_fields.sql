alter table public.rooms
  add column if not exists room_name text not null default 'Tambola Room',
  add column if not exists visibility text not null default 'public',
  add column if not exists pin text;

alter table public.rooms
  add constraint rooms_visibility_check check (visibility in ('public', 'private'));

create index if not exists rooms_status_created_at_idx on public.rooms(status, created_at desc);
