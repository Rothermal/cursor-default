-- BKE-4B1: fixed Basketball entry point over the private event-platform v4 binder.

create or replace function public.bind_basketball_event_game_v4(
  p_existing_game_id uuid,
  p_client_local_game_id text,
  p_source_team_id uuid,
  p_source_season_id uuid,
  p_team_name text,
  p_opponent_name text,
  p_competition_name text,
  p_game_date date,
  p_participants jsonb,
  p_setup_snapshot jsonb
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.bind_event_game_v4(
    'basketball',
    p_existing_game_id,
    p_client_local_game_id,
    p_source_team_id,
    p_source_season_id,
    p_team_name,
    p_opponent_name,
    p_competition_name,
    p_game_date,
    p_participants,
    p_setup_snapshot
  );
$$;

revoke all on function public.bind_basketball_event_game_v4(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) from public;

grant execute on function public.bind_basketball_event_game_v4(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) to authenticated;

comment on function public.bind_basketball_event_game_v4(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) is 'Binds or resumes one Basketball event recorder through the private event-platform v4 contract.';
