-- Freeze optional short side labels on the game so later team edits do not
-- rewrite the labels used during capture or historical review.
alter table public.games
  add column if not exists tracked_team_nickname text,
  add column if not exists opponent_nickname text;

alter table public.games
  drop constraint if exists games_tracked_team_nickname_length_check,
  add constraint games_tracked_team_nickname_length_check
    check (tracked_team_nickname is null or char_length(trim(tracked_team_nickname)) between 1 and 100) not valid,
  drop constraint if exists games_opponent_nickname_length_check,
  add constraint games_opponent_nickname_length_check
    check (opponent_nickname is null or char_length(trim(opponent_nickname)) between 1 and 100) not valid;

alter table public.games validate constraint games_tracked_team_nickname_length_check;
alter table public.games validate constraint games_opponent_nickname_length_check;
