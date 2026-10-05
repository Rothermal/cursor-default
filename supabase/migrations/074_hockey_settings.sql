-- HKY-5C: fixed Hockey personal and team settings writes over the shared revisioned core
-- (062 and 071 pattern), and Hockey release capability contract 2. Additive only: no table,
-- row, event-platform function or other sport changes.
--
-- The server checks the same exact shapes as `parseHockeySettings` and
-- `parseHockeyTeamSettings`: the overrides are layered on the stored profile's rules and the
-- result must be valid Hockey rules. `_hockey_profile_rules` mirrors `src/lib/hockey/profiles.ts`
-- (version 1 of every profile); a unit test keeps the two equal.

create or replace function public._hockey_settings_int_between(
  p_value jsonb,
  p_min bigint,
  p_max bigint
)
returns boolean
language sql
immutable
set search_path = public
as $$
  -- CASE keeps the cast behind the type check so malformed values fail validation cleanly.
  select case
    when jsonb_typeof(p_value) = 'number' and p_value::text ~ '^-?[0-9]{1,10}$'
      then (p_value::text)::bigint between p_min and p_max
    else false
  end;
$$;

create or replace function public._hockey_settings_whole_seconds(
  p_value jsonb,
  p_min bigint,
  p_max bigint
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select public._hockey_settings_int_between(p_value, p_min, p_max)
    and (p_value::text)::bigint % 1000 = 0;
$$;

create or replace function public._hockey_profile_rules(p_profile_id text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case p_profile_id
    when 'usa_hockey_youth' then '{"regulation":{"periods":3,"periodLengthMs":900000},"clockModel":"anchored","clock":{"display":"count_down","mode":"stop_time"},"skatersPerSide":5,"minimumSkaters":3,"overtime":null,"shootout":null,"tiesAllowed":true,"penalties":{"minorMs":120000,"doubleMinorMs":240000,"majorMs":300000,"misconductMs":600000,"releaseMinorOnPowerPlayGoal":true,"coincidentalMinors":"substitute"},"trapezoid":false}'::jsonb
    when 'recreational' then '{"regulation":{"periods":3,"periodLengthMs":900000},"clockModel":"anchored","clock":{"display":"count_down","mode":"running"},"skatersPerSide":5,"minimumSkaters":3,"overtime":null,"shootout":null,"tiesAllowed":true,"penalties":{"minorMs":120000,"doubleMinorMs":240000,"majorMs":300000,"misconductMs":600000,"releaseMinorOnPowerPlayGoal":true,"coincidentalMinors":"substitute"},"trapezoid":false}'::jsonb
    when 'high_school_us' then '{"regulation":{"periods":3,"periodLengthMs":1020000},"clockModel":"anchored","clock":{"display":"count_down","mode":"stop_time"},"skatersPerSide":5,"minimumSkaters":3,"overtime":{"lengthMs":480000,"skaters":5,"repeat":false,"endsPolicy":"continue_alternation","suddenDeath":true},"shootout":null,"tiesAllowed":true,"penalties":{"minorMs":120000,"doubleMinorMs":240000,"majorMs":300000,"misconductMs":600000,"releaseMinorOnPowerPlayGoal":true,"coincidentalMinors":"substitute"},"trapezoid":false}'::jsonb
    when 'ncaa' then '{"regulation":{"periods":3,"periodLengthMs":1200000},"clockModel":"anchored","clock":{"display":"count_down","mode":"stop_time"},"skatersPerSide":5,"minimumSkaters":3,"overtime":{"lengthMs":300000,"skaters":3,"repeat":false,"endsPolicy":"continue_alternation","suddenDeath":true},"shootout":null,"tiesAllowed":true,"penalties":{"minorMs":120000,"doubleMinorMs":240000,"majorMs":300000,"misconductMs":600000,"releaseMinorOnPowerPlayGoal":true,"coincidentalMinors":"substitute"},"trapezoid":false}'::jsonb
    when 'nhl_regular' then '{"regulation":{"periods":3,"periodLengthMs":1200000},"clockModel":"anchored","clock":{"display":"count_down","mode":"stop_time"},"skatersPerSide":5,"minimumSkaters":3,"overtime":{"lengthMs":300000,"skaters":3,"repeat":false,"endsPolicy":"continue_alternation","suddenDeath":true},"shootout":{"rounds":3,"repeatShooters":"after_all"},"tiesAllowed":false,"penalties":{"minorMs":120000,"doubleMinorMs":240000,"majorMs":300000,"misconductMs":600000,"releaseMinorOnPowerPlayGoal":true,"coincidentalMinors":"play_short"},"trapezoid":true}'::jsonb
    when 'nhl_playoffs' then '{"regulation":{"periods":3,"periodLengthMs":1200000},"clockModel":"anchored","clock":{"display":"count_down","mode":"stop_time"},"skatersPerSide":5,"minimumSkaters":3,"overtime":{"lengthMs":1200000,"skaters":5,"repeat":true,"endsPolicy":"continue_alternation","suddenDeath":true},"shootout":null,"tiesAllowed":false,"penalties":{"minorMs":120000,"doubleMinorMs":240000,"majorMs":300000,"misconductMs":600000,"releaseMinorOnPowerPlayGoal":true,"coincidentalMinors":"play_short"},"trapezoid":true}'::jsonb
    when 'custom' then '{"regulation":{"periods":3,"periodLengthMs":900000},"clockModel":"anchored","clock":{"display":"count_down","mode":"stop_time"},"skatersPerSide":5,"minimumSkaters":3,"overtime":null,"shootout":null,"tiesAllowed":true,"penalties":{"minorMs":120000,"doubleMinorMs":240000,"majorMs":300000,"misconductMs":600000,"releaseMinorOnPowerPlayGoal":true,"coincidentalMinors":"substitute"},"trapezoid":false}'::jsonb
    else null
  end;
$$;

-- Mirrors `validateHockeyMatchRules` for the ten rule fields. Returns null when valid.
create or replace function public._hockey_rules_error(p_rules jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_regulation jsonb := p_rules->'regulation';
  v_clock jsonb := p_rules->'clock';
  v_overtime jsonb := p_rules->'overtime';
  v_shootout jsonb := p_rules->'shootout';
  v_penalties jsonb := p_rules->'penalties';
  v_skaters bigint;
begin
  if not public._basketball_settings_exact_keys(p_rules, array[
    'regulation', 'clockModel', 'clock', 'skatersPerSide', 'minimumSkaters',
    'overtime', 'shootout', 'tiesAllowed', 'penalties', 'trapezoid'
  ]) then
    return 'rules contain unknown or missing fields';
  end if;

  if not public._basketball_settings_exact_keys(v_regulation, array['periods', 'periodLengthMs'])
     or not public._hockey_settings_int_between(v_regulation->'periods', 1, 5)
     or not public._hockey_settings_whole_seconds(v_regulation->'periodLengthMs', 60000, 3600000) then
    return 'invalid regulation';
  end if;

  if p_rules->'clockModel' = '"anchored"'::jsonb then
    if not public._basketball_settings_exact_keys(v_clock, array['display', 'mode'])
       or coalesce(v_clock->>'display', '') not in ('count_down', 'count_up')
       or jsonb_typeof(v_clock->'display') is distinct from 'string'
       or coalesce(v_clock->>'mode', '') not in ('stop_time', 'running')
       or jsonb_typeof(v_clock->'mode') is distinct from 'string' then
      return 'invalid clock';
    end if;
  elsif p_rules->'clockModel' = '"none"'::jsonb then
    if jsonb_typeof(v_clock) is distinct from 'null' then
      return 'a clockless game cannot have clock settings';
    end if;
  else
    return 'invalid clock model';
  end if;

  if not public._hockey_settings_int_between(p_rules->'skatersPerSide', 3, 6) then
    return 'invalid skaters per side';
  end if;
  v_skaters := (p_rules->>'skatersPerSide')::bigint;
  if not public._hockey_settings_int_between(p_rules->'minimumSkaters', 3, v_skaters) then
    return 'invalid minimum skaters';
  end if;

  if jsonb_typeof(v_overtime) is distinct from 'null' then
    if not (
         public._basketball_settings_exact_keys(v_overtime, array['lengthMs', 'skaters', 'repeat', 'endsPolicy'])
         or (
           public._basketball_settings_exact_keys(
             v_overtime, array['lengthMs', 'skaters', 'repeat', 'endsPolicy', 'suddenDeath']
           )
           and jsonb_typeof(v_overtime->'suddenDeath') = 'boolean'
         )
       )
       or not public._hockey_settings_whole_seconds(v_overtime->'lengthMs', 60000, 3600000)
       or not public._hockey_settings_int_between(v_overtime->'skaters', 3, v_skaters)
       or jsonb_typeof(v_overtime->'repeat') is distinct from 'boolean'
       or jsonb_typeof(v_overtime->'endsPolicy') is distinct from 'string'
       or (v_overtime->>'endsPolicy') not in ('continue_alternation', 'same_as_last_regulation') then
      return 'invalid overtime';
    end if;
  end if;

  if jsonb_typeof(v_shootout) is distinct from 'null' then
    if not public._basketball_settings_exact_keys(v_shootout, array['rounds', 'repeatShooters'])
       or not public._hockey_settings_int_between(v_shootout->'rounds', 1, 10)
       or jsonb_typeof(v_shootout->'repeatShooters') is distinct from 'string'
       or (v_shootout->>'repeatShooters') not in ('after_all', 'never', 'any') then
      return 'invalid shootout';
    end if;
  end if;

  if jsonb_typeof(p_rules->'tiesAllowed') is distinct from 'boolean' then
    return 'invalid ties allowed';
  end if;
  if p_rules->'tiesAllowed' = 'false'::jsonb
     and jsonb_typeof(v_shootout) = 'null'
     and not (jsonb_typeof(v_overtime) = 'object' and v_overtime->'repeat' = 'true'::jsonb) then
    return 'a game without ties needs a shootout or repeating overtime';
  end if;

  if not public._basketball_settings_exact_keys(v_penalties, array[
       'minorMs', 'doubleMinorMs', 'majorMs', 'misconductMs',
       'releaseMinorOnPowerPlayGoal', 'coincidentalMinors'
     ])
     or not public._hockey_settings_whole_seconds(v_penalties->'minorMs', 30000, 600000) then
    return 'invalid penalties';
  end if;
  if not public._hockey_settings_whole_seconds(
       v_penalties->'doubleMinorMs', (v_penalties->>'minorMs')::bigint, 1200000
     )
     or not public._hockey_settings_whole_seconds(
       v_penalties->'majorMs', (v_penalties->>'minorMs')::bigint, 1200000
     )
     or not public._hockey_settings_whole_seconds(v_penalties->'misconductMs', 60000, 1200000)
     or jsonb_typeof(v_penalties->'releaseMinorOnPowerPlayGoal') is distinct from 'boolean'
     or jsonb_typeof(v_penalties->'coincidentalMinors') is distinct from 'string'
     or (v_penalties->>'coincidentalMinors') not in ('substitute', 'play_short') then
    return 'invalid penalties';
  end if;

  if jsonb_typeof(p_rules->'trapezoid') is distinct from 'boolean' then
    return 'invalid trapezoid';
  end if;
  return null;
end;
$$;

create or replace function public._validate_hockey_settings_payload(
  p_scope text,
  p_team_id uuid,
  p_settings jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_overrides jsonb := p_settings->'ruleOverrides';
  v_profile jsonb;
  v_error text;
  v_lineup jsonb;
  v_value jsonb;
  v_starters uuid[] := '{}';
  v_starting uuid;
  v_backup uuid;
  v_id uuid;
begin
  if p_scope = 'user' then
    if not public._basketball_settings_exact_keys(
      p_settings, array['settingsSchemaVersion', 'baseProfile', 'ruleOverrides']
    ) then
      raise exception 'SPORT_SETTINGS_INVALID: invalid Hockey personal settings';
    end if;
  elsif p_scope = 'team' then
    if not public._basketball_settings_exact_keys(
      p_settings, array['settingsSchemaVersion', 'baseProfile', 'ruleOverrides', 'lineupDefaults']
    ) then
      raise exception 'SPORT_SETTINGS_INVALID: invalid Hockey team settings';
    end if;
  else
    raise exception 'SPORT_SETTINGS_INVALID: settings scope is invalid';
  end if;
  if p_settings->'settingsSchemaVersion' is distinct from '1'::jsonb then
    raise exception 'SPORT_SETTINGS_INVALID: unsupported Hockey settings version';
  end if;

  if not public._basketball_settings_exact_keys(p_settings->'baseProfile', array['profileId', 'profileVersion'])
     or p_settings->'baseProfile'->'profileVersion' is distinct from '1'::jsonb
     or jsonb_typeof(p_settings->'baseProfile'->'profileId') is distinct from 'string' then
    raise exception 'SPORT_SETTINGS_INVALID: unknown Hockey rules profile';
  end if;
  v_profile := public._hockey_profile_rules(p_settings->'baseProfile'->>'profileId');
  if v_profile is null then
    raise exception 'SPORT_SETTINGS_INVALID: unknown Hockey rules profile';
  end if;

  if jsonb_typeof(v_overrides) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(v_overrides) as override(key)
    where override.key not in (
      'regulation', 'clockModel', 'clock', 'skatersPerSide', 'minimumSkaters',
      'overtime', 'shootout', 'tiesAllowed', 'penalties', 'trapezoid'
    )
  ) then
    raise exception 'SPORT_SETTINGS_INVALID: unsupported Hockey rule override';
  end if;
  -- Top-level concatenation replaces each overridden field whole, like the client.
  v_error := public._hockey_rules_error(v_profile || v_overrides);
  if v_error is not null then
    raise exception 'SPORT_SETTINGS_INVALID: Hockey rule overrides are invalid: %', v_error;
  end if;

  if p_scope <> 'team' then return; end if;

  v_lineup := p_settings->'lineupDefaults';
  if not public._basketball_settings_exact_keys(v_lineup, array[
       'version', 'starterPlayerIds', 'startingGoaliePlayerId', 'backupGoaliePlayerId'
     ])
     or v_lineup->'version' is distinct from '1'::jsonb
     or jsonb_typeof(v_lineup->'starterPlayerIds') is distinct from 'array'
     or jsonb_array_length(v_lineup->'starterPlayerIds') > 6 then
    raise exception 'SPORT_SETTINGS_INVALID: invalid Hockey default lineup';
  end if;
  for v_value in select value from jsonb_array_elements(v_lineup->'starterPlayerIds') loop
    if jsonb_typeof(v_value) is distinct from 'string' or
       (v_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'SPORT_SETTINGS_INVALID: invalid starter identity';
    end if;
    v_id := (v_value #>> '{}')::uuid;
    if v_id = any(v_starters) then
      raise exception 'SPORT_SETTINGS_INVALID: duplicate starter identity';
    end if;
    v_starters := array_append(v_starters, v_id);
  end loop;

  foreach v_value in array array[v_lineup->'startingGoaliePlayerId', v_lineup->'backupGoaliePlayerId'] loop
    if jsonb_typeof(v_value) <> 'null' and (
      jsonb_typeof(v_value) is distinct from 'string' or
      (v_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then
      raise exception 'SPORT_SETTINGS_INVALID: invalid goalie identity';
    end if;
  end loop;
  v_starting := (v_lineup->>'startingGoaliePlayerId')::uuid;
  v_backup := (v_lineup->>'backupGoaliePlayerId')::uuid;
  if (v_starting is not null and (v_starting = v_backup or v_starting = any(v_starters)))
     or (v_backup is not null and v_backup = any(v_starters)) then
    raise exception 'SPORT_SETTINGS_INVALID: a player can have only one default lineup role';
  end if;

  if exists (
    select 1
    from unnest(v_starters || array_remove(array[v_starting, v_backup], null)) as lineup_player(id)
    where not exists (
      select 1 from public.team_players roster
      where roster.team_id = p_team_id and roster.player_id = lineup_player.id and roster.is_active
    )
  ) then
    raise exception 'SPORT_SETTINGS_INVALID: remove unavailable players from the default lineup before saving';
  end if;
end;
$$;

create or replace function public.save_hockey_user_settings_revisioned(
  p_expected_revision bigint,
  p_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.has_active_app_access() then raise exception 'Active app access is required'; end if;
  if p_expected_revision is not null and p_expected_revision <= 0 then
    raise exception 'SPORT_SETTINGS_INVALID: expected revision must be positive';
  end if;
  perform public._validate_hockey_settings_payload('user', null, p_settings);
  return public._save_sport_settings_revisioned_core('user', v_user_id, null,
    'hockey', 1, p_expected_revision, p_settings, null);
end;
$$;

create or replace function public.save_hockey_team_settings_revisioned(
  p_team_id uuid,
  p_expected_revision bigint,
  p_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_sport text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.has_active_app_access() then raise exception 'Active app access is required'; end if;
  if coalesce(public.current_team_role(p_team_id), '') not in ('owner', 'admin') then
    raise exception 'Team owner or admin access is required';
  end if;
  if p_expected_revision is not null and p_expected_revision <= 0 then
    raise exception 'SPORT_SETTINGS_INVALID: expected revision must be positive';
  end if;
  select season.sport into v_sport from public.teams team
    join public.seasons season on season.id = team.season_id where team.id = p_team_id;
  if v_sport is distinct from 'hockey' then raise exception 'Team sport does not match Hockey settings'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hockey-settings:' || p_team_id::text, 0));
  perform public._validate_hockey_settings_payload('team', p_team_id, p_settings);
  return public._save_sport_settings_revisioned_core('team', v_user_id, p_team_id,
    'hockey', 1, p_expected_revision, p_settings, 'hockey_settings_changed');
end;
$$;

-- Contract 2 adds the settings writes to the contract-1 checks (073, unchanged otherwise).
create or replace function public.get_hockey_release_capabilities()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'Authentication required';
  end if;
  if not public.has_active_app_access() then
    raise insufficient_privilege using message = 'APP_ACCESS_UNAVAILABLE';
  end if;

  -- Fail closed without exposing which schema object is unavailable.
  if
    not public.is_event_platform_sport('hockey')
    or to_regclass('public.games') is null
    or to_regclass('public.game_participants') is null
    or to_regclass('public.game_events') is null
    or to_regclass('public.game_event_stream_checkpoints') is null
    or to_regclass('public.game_event_setup_snapshots') is null
    or to_regclass('public.game_event_conflicts') is null
    or to_regclass('public.game_event_primary_recorders') is null
    or to_regclass('public.game_event_primary_recorder_audit') is null
    or to_regclass('public.game_event_canonical_publications') is null
    or to_regclass('public.user_sport_settings') is null
    or to_regclass('public.team_sport_settings') is null
    or to_regprocedure(
      'public.bind_hockey_event_game_v5(uuid,text,uuid,uuid,text,text,text,date,jsonb,jsonb,boolean)'
    ) is null
    or to_regprocedure(
      'public.upsert_game_event_revisioned(uuid,uuid,text,text,integer,bigint,integer,text,integer,bigint,timestamptz,text,jsonb,jsonb,jsonb,timestamptz,timestamptz,timestamptz)'
    ) is null
    or to_regprocedure(
      'public.record_game_event_conflict(uuid,uuid,jsonb,jsonb)'
    ) is null
    or to_regprocedure(
      'public.resolve_game_event_conflict(uuid,text,jsonb)'
    ) is null
    or to_regprocedure(
      'public.confirm_game_event_stream_checkpoint(uuid,integer,jsonb,integer,bigint,text)'
    ) is null
    or to_regprocedure('public.get_hockey_game_recorders(uuid)') is null
    or to_regprocedure('public.get_hockey_primary_recorder_history(uuid)') is null
    or to_regprocedure('public.set_hockey_primary_recorder(uuid,uuid)') is null
    or to_regprocedure('public.get_hockey_finalization_readiness(uuid)') is null
    or to_regprocedure('public.get_hockey_canonical_publication(uuid)') is null
    or to_regprocedure(
      'public.get_hockey_primary_conflicts_for_finalization(uuid)'
    ) is null
    or to_regprocedure(
      'public.resolve_hockey_primary_conflict_for_finalization(uuid,text)'
    ) is null
    or to_regprocedure(
      'public.confirm_hockey_primary_checkpoint_for_finalization(uuid,uuid,integer,jsonb,integer,bigint,text)'
    ) is null
    or to_regprocedure(
      'public.finalize_hockey_event_game(uuid,uuid,jsonb,text,jsonb)'
    ) is null
    or to_regprocedure('public.reopen_hockey_event_game(uuid,text)') is null
    or to_regprocedure(
      'public.get_hockey_canonical_publication_history(uuid)'
    ) is null
    or to_regprocedure('public.save_hockey_user_settings_revisioned(bigint,jsonb)') is null
    or to_regprocedure('public.save_hockey_team_settings_revisioned(uuid,bigint,jsonb)') is null
  then
    return jsonb_build_object('contractVersion', 0);
  end if;

  return jsonb_build_object(
    'contractVersion', 2,
    'migration', 74,
    'eventTransportVersion', 4,
    'recoveryVersion', 1,
    'recorderResolutionVersion', 1,
    'canonicalFinalizationVersion', 1,
    'setupSnapshotVersion', 1,
    'settingsContractVersion', 1
  );
end;
$$;

revoke all on function public._hockey_settings_int_between(jsonb, bigint, bigint) from public, anon, authenticated;
revoke all on function public._hockey_settings_whole_seconds(jsonb, bigint, bigint) from public, anon, authenticated;
revoke all on function public._hockey_profile_rules(text) from public, anon, authenticated;
revoke all on function public._hockey_rules_error(jsonb) from public, anon, authenticated;
revoke all on function public._validate_hockey_settings_payload(text, uuid, jsonb) from public, anon, authenticated;

revoke all on function public.save_hockey_user_settings_revisioned(bigint, jsonb) from public;
grant execute on function public.save_hockey_user_settings_revisioned(bigint, jsonb) to authenticated;
revoke all on function public.save_hockey_team_settings_revisioned(uuid, bigint, jsonb) from public;
grant execute on function public.save_hockey_team_settings_revisioned(uuid, bigint, jsonb) to authenticated;
revoke all on function public.get_hockey_release_capabilities() from public;
grant execute on function public.get_hockey_release_capabilities() to authenticated;

comment on function public.save_hockey_user_settings_revisioned(bigint, jsonb) is
  'Hockey personal rules default with compare-and-swap revision.';
comment on function public.save_hockey_team_settings_revisioned(uuid, bigint, jsonb) is
  'Hockey team rules and lineup defaults; owner or admin only, audited as hockey_settings_changed.';

notify pgrst, 'reload schema';
