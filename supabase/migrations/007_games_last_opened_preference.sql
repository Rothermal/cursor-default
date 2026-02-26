-- Supports deterministic active-game resume across devices.
-- The app prefers in-progress/scheduled games by last_opened_at (then created_at).
alter table if exists public.games
  add column if not exists last_opened_at timestamptz not null default now();

update public.games
set last_opened_at = created_at
where last_opened_at is null;

create index if not exists idx_games_last_opened
  on public.games (status, last_opened_at desc);
