-- BKE-4A2: sport-neutral setup recovery and same-recorder conflicts.

create or replace function public.bind_event_game_v2(
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
  p_setup_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_bound_local_id text;
  v_binding jsonb;
  v_game_id uuid;
  v_participants jsonb;
  v_setup_written boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.is_event_platform_sport(p_sport_id) then
    raise exception 'Sport is not supported by the event platform';
  end if;
  if jsonb_typeof(p_setup_snapshot) <> 'object'
     or p_setup_snapshot->>'version' <> '1' then
    raise exception '% setup snapshot is invalid', initcap(p_sport_id);
  end if;

  if p_existing_game_id is not null then
    select game.client_local_game_id into v_bound_local_id
    from public.games game
    where game.id = p_existing_game_id
      and game.created_by = v_user_id
      and game.status <> 'final'
      and game.sport_id = p_sport_id
      and game.team_id is not distinct from p_source_team_id;
    if not found or v_bound_local_id is null then
      raise exception 'Existing % game binding is unavailable or incompatible',
        lower(p_sport_id);
    end if;
  else
    v_bound_local_id := p_client_local_game_id;
  end if;

  v_binding := public.bind_event_game(
    p_sport_id,
    v_bound_local_id,
    p_source_team_id,
    p_source_season_id,
    p_team_name,
    p_opponent_name,
    p_competition_name,
    p_game_date,
    p_participants
  );
  v_game_id := (v_binding->>'game_id')::uuid;

  if not exists (
    select 1
    from public.games game
    where game.id = v_game_id
      and game.sport_id = p_sport_id
  ) then
    raise exception 'Bound game sport is incompatible with the setup snapshot';
  end if;

  insert into public.game_event_setup_snapshots (
    game_id, sport_id, setup_snapshot, updated_by
  ) values (
    v_game_id, p_sport_id, p_setup_snapshot, v_user_id
  )
  on conflict (game_id) do update set
    updated_at = now(),
    updated_by = excluded.updated_by
  where game_event_setup_snapshots.sport_id = excluded.sport_id
    and game_event_setup_snapshots.setup_snapshot is not distinct from
      excluded.setup_snapshot
  returning true into v_setup_written;

  if not coalesce(v_setup_written, false) then
    raise exception '% setup snapshot cannot be replaced', initcap(p_sport_id);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', participant.id,
    'client_participant_id', participant.client_participant_id,
    'client_player_id', participant.client_player_id,
    'display_name', participant.display_name,
    'jersey_number', participant.jersey_number
  ) order by participant.created_at, participant.id), '[]'::jsonb)
  into v_participants
  from public.game_participants participant
  where participant.game_id = v_game_id;

  return v_binding || jsonb_build_object('participants', v_participants);
end;
$$;

revoke all on function public.bind_event_game_v2(
  text, uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) from public;

comment on function public.bind_event_game_v2(
  text, uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) is
  'Private sport-neutral event-game adoption and immutable setup binding.';

create or replace function public.bind_soccer_event_game_v2(
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
  select public.bind_event_game_v2(
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
    p_setup_snapshot
  );
$$;

revoke all on function public.bind_soccer_event_game_v2(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) from public;
grant execute on function public.bind_soccer_event_game_v2(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) to authenticated;

comment on function public.bind_soccer_event_game_v2(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) is
  'Permanent Soccer recovery wrapper over the private event-platform v2 binding.';

-- Preserve migration 046 conflict recording, including late non-primary Soccer audit uploads,
-- while making the supported game-sport boundary explicit.
create or replace function public.record_game_event_conflict(
  p_game_id uuid,
  p_event_id uuid,
  p_local_event jsonb,
  p_remote_event jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_game_sport_id text;
  v_conflict_id uuid;
  v_remote_revision integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select game.sport_id into v_game_sport_id
  from public.games game
  where game.id = p_game_id
  for share;
  if not found then raise exception 'Game not found'; end if;
  if not public.is_event_platform_sport(v_game_sport_id) then
    raise exception 'Game sport is not supported by the event platform';
  end if;
  if not public.can_track_game(p_game_id)
     and not (
       v_game_sport_id = 'soccer'
       and public.can_upload_final_soccer_audit(p_game_id, v_user_id)
     ) then
    raise exception 'Not authorized to resolve this game';
  end if;
  if jsonb_typeof(p_local_event) <> 'object'
     or jsonb_typeof(p_remote_event) <> 'object'
     or p_local_event->>'id' is distinct from p_event_id::text
     or p_remote_event->>'id' is distinct from p_event_id::text then
    raise exception 'Conflict event snapshots are invalid';
  end if;

  select event.revision into v_remote_revision
  from public.game_events event
  where event.id = p_event_id
    and event.game_id = p_game_id
    and event.recorded_by = v_user_id;
  if not found or v_remote_revision is distinct from
      (p_remote_event->>'revision')::integer then
    raise exception 'Remote conflict revision is no longer current';
  end if;

  update public.game_event_conflicts set
    local_event = p_local_event,
    remote_event = p_remote_event,
    detected_at = now()
  where game_id = p_game_id
    and recorded_by = v_user_id
    and event_id = p_event_id
    and status = 'open'
  returning id into v_conflict_id;

  if v_conflict_id is null then
    insert into public.game_event_conflicts (
      game_id, recorded_by, event_id, local_event, remote_event
    ) values (
      p_game_id, v_user_id, p_event_id, p_local_event, p_remote_event
    )
    on conflict do nothing
    returning id into v_conflict_id;
  end if;
  if v_conflict_id is null then
    select conflict.id into v_conflict_id
    from public.game_event_conflicts conflict
    where conflict.game_id = p_game_id
      and conflict.recorded_by = v_user_id
      and conflict.event_id = p_event_id
      and conflict.status = 'open';
  end if;
  return v_conflict_id;
end;
$$;

create or replace function public.resolve_game_event_conflict(
  p_conflict_id uuid,
  p_resolution text,
  p_resolved_event jsonb
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_game_sport_id text;
  v_resolved_at timestamptz;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_resolution not in ('local', 'remote')
     or jsonb_typeof(p_resolved_event) <> 'object' then
    raise exception 'Conflict resolution is invalid';
  end if;

  select game.sport_id into v_game_sport_id
  from public.game_event_conflicts conflict
  join public.games game on game.id = conflict.game_id
  where conflict.id = p_conflict_id
    and conflict.recorded_by = v_user_id;
  if found and not public.is_event_platform_sport(v_game_sport_id) then
    raise exception 'Game sport is not supported by the event platform';
  end if;

  update public.game_event_conflicts set
    status = 'resolved',
    resolution = p_resolution,
    resolved_event = p_resolved_event,
    resolved_at = now(),
    resolved_by = v_user_id
  where id = p_conflict_id
    and recorded_by = v_user_id
    and status = 'open'
    and event_id::text = p_resolved_event->>'id'
  returning resolved_at into v_resolved_at;

  if v_resolved_at is null then
    select conflict.resolved_at into v_resolved_at
    from public.game_event_conflicts conflict
    where conflict.id = p_conflict_id
      and conflict.recorded_by = v_user_id
      and conflict.status = 'resolved'
      and conflict.resolution = p_resolution
      and conflict.resolved_event is not distinct from p_resolved_event;
  end if;
  if v_resolved_at is null then raise exception 'Conflict was not found'; end if;
  return v_resolved_at;
end;
$$;

revoke all on function public.record_game_event_conflict(
  uuid, uuid, jsonb, jsonb
) from public;
grant execute on function public.record_game_event_conflict(
  uuid, uuid, jsonb, jsonb
) to authenticated;
revoke all on function public.resolve_game_event_conflict(
  uuid, text, jsonb
) from public;
grant execute on function public.resolve_game_event_conflict(
  uuid, text, jsonb
) to authenticated;

comment on table public.game_event_setup_snapshots is
  'Immutable event-platform sport setup required to rebuild a game on another device.';
comment on table public.game_event_conflicts is
  'Durable same-recorder competing event revisions and explicit resolution audit.';
