-- SOC-S22: protect player history and recover event games whose source player was deleted.

drop policy if exists "players_delete" on public.players;
revoke delete on table public.players from authenticated;

create or replace function public.delete_unreferenced_player(
  p_player_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_player public.players%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_player
  from public.players player
  where player.id = p_player_id
  for update;

  if not found or v_player.created_by is distinct from v_user_id then
    raise exception 'Player is unavailable';
  end if;

  if exists (
    select 1 from public.game_participants participant
    where participant.source_player_id = p_player_id
  ) or exists (
    select 1 from public.game_stats stat
    where stat.player_id = p_player_id
  ) or exists (
    select 1 from public.shot_chart shot
    where shot.player_id = p_player_id
  ) or exists (
    select 1 from public.stat_corrections correction
    where correction.player_id = p_player_id
  ) or exists (
    select 1 from public.player_checkouts checkout
    where checkout.player_id = p_player_id
  ) then
    raise exception 'PLAYER_DELETE_HAS_HISTORY: Remove this player from the roster instead; permanent deletion would destroy game history';
  end if;

  delete from public.players player
  where player.id = p_player_id;
end;
$$;

revoke all on function public.delete_unreferenced_player(uuid) from public;
grant execute on function public.delete_unreferenced_player(uuid) to authenticated;

comment on function public.delete_unreferenced_player(uuid) is
  'Deletes only a caller-created player with no event or legacy game history.';

create or replace function public.bind_event_game_v5(
  p_sport_id text,
  p_existing_game_id uuid,
  p_client_local_game_id text,
  p_source_team_id uuid,
  p_source_season_id uuid,
  p_team_name text,
  p_opponent_name text,
  p_competition_name text,
  p_game_date date,
  p_participants jsonb,
  p_setup_snapshot jsonb,
  p_allow_deleted_source_players boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_snapshot jsonb;
  v_source_player_id uuid;
  v_sanitized_participants jsonb := '[]'::jsonb;
begin
  if not coalesce(p_allow_deleted_source_players, false) then
    return public.bind_event_game_v4(
      p_sport_id,
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
  end if;

  if p_source_team_id is null
     or not public.is_accepted_team_admin(p_source_team_id) then
    raise exception 'Only a team owner or admin can preserve deleted player history';
  end if;
  if jsonb_typeof(p_participants) <> 'array' then
    raise exception 'Participants must be an array';
  end if;

  for v_item in select value from jsonb_array_elements(p_participants)
  loop
    v_source_player_id := nullif(v_item->>'source_player_id', '')::uuid;
    if v_source_player_id is not null
       and not exists (
         select 1
         from public.team_players team_player
         where team_player.team_id = p_source_team_id
           and team_player.player_id = v_source_player_id
       )
       and not exists (
         select 1
         from public.players player
         where player.id = v_source_player_id
       ) then
      v_snapshot := case
        when jsonb_typeof(coalesce(v_item->'snapshot', '{}'::jsonb)) = 'object'
          then coalesce(v_item->'snapshot', '{}'::jsonb)
        else v_item->'snapshot'
      end;
      v_item := jsonb_set(v_item, '{source_player_id}', 'null'::jsonb, true);
      if jsonb_typeof(v_snapshot) = 'object' then
        v_item := jsonb_set(
          v_item,
          '{snapshot}',
          v_snapshot || jsonb_build_object('sourcePlayerDeletedBeforeBinding', true),
          true
        );
      end if;
    end if;
    v_sanitized_participants := v_sanitized_participants || jsonb_build_array(v_item);
  end loop;

  return public.bind_event_game_v4(
    p_sport_id,
    p_existing_game_id,
    p_client_local_game_id,
    p_source_team_id,
    p_source_season_id,
    p_team_name,
    p_opponent_name,
    p_competition_name,
    p_game_date,
    v_sanitized_participants,
    p_setup_snapshot
  );
end;
$$;

create or replace function public.bind_soccer_event_game_v5(
  p_existing_game_id uuid,
  p_client_local_game_id text,
  p_source_team_id uuid,
  p_source_season_id uuid,
  p_team_name text,
  p_opponent_name text,
  p_competition_name text,
  p_game_date date,
  p_participants jsonb,
  p_setup_snapshot jsonb,
  p_allow_deleted_source_players boolean
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.bind_event_game_v5(
    'soccer',
    p_existing_game_id,
    p_client_local_game_id,
    p_source_team_id,
    p_source_season_id,
    p_team_name,
    p_opponent_name,
    p_competition_name,
    p_game_date,
    p_participants,
    p_setup_snapshot,
    p_allow_deleted_source_players
  );
$$;

create or replace function public.bind_basketball_event_game_v5(
  p_existing_game_id uuid,
  p_client_local_game_id text,
  p_source_team_id uuid,
  p_source_season_id uuid,
  p_team_name text,
  p_opponent_name text,
  p_competition_name text,
  p_game_date date,
  p_participants jsonb,
  p_setup_snapshot jsonb,
  p_allow_deleted_source_players boolean
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.bind_event_game_v5(
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
    p_setup_snapshot,
    p_allow_deleted_source_players
  );
$$;

revoke all on function public.bind_event_game_v5(
  text, uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb, boolean
) from public;
revoke all on function public.bind_soccer_event_game_v5(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb, boolean
) from public;
revoke all on function public.bind_basketball_event_game_v5(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb, boolean
) from public;

grant execute on function public.bind_soccer_event_game_v5(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb, boolean
) to authenticated;
grant execute on function public.bind_basketball_event_game_v5(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb, boolean
) to authenticated;

comment on function public.bind_event_game_v5(
  text, uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb, boolean
) is 'Private v4-compatible binding with manager-approved deleted-source preservation.';
comment on function public.bind_soccer_event_game_v5(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb, boolean
) is 'Fixed Soccer binding with explicit deleted-source recovery.';
comment on function public.bind_basketball_event_game_v5(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb, boolean
) is 'Fixed Basketball binding with explicit deleted-source recovery.';
