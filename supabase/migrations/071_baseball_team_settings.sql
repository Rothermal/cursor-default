-- Migration 071 / BSB-2: Baseball team defaults (rules profile, limited rule overrides
-- and default lineup). Additive only: no existing function, row or other sport changes.
-- The event-platform allow-lists stay untouched until a sport reaches cloud work.

create or replace function public._baseball_settings_int_between(
  p_value jsonb,
  p_min integer,
  p_max integer
)
returns boolean
language sql
immutable
set search_path = public
as $$
  -- CASE keeps the cast behind the type check so malformed values fail validation cleanly.
  select case
    when jsonb_typeof(p_value) = 'number' and p_value::text ~ '^-?[0-9]{1,6}$'
      then (p_value::text)::integer between p_min and p_max
    else false
  end;
$$;

revoke all on function public._baseball_settings_int_between(jsonb, integer, integer) from public, anon, authenticated;

create or replace function public._validate_baseball_team_settings_payload(
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
  v_overrides jsonb;
  v_lineup jsonb;
  v_key text;
  v_value jsonb;
  v_rule jsonb;
  v_ids uuid[] := '{}';
  v_fielders uuid[] := '{}';
  v_id uuid;
begin
  if not public._basketball_settings_exact_keys(
    p_settings, array['settingsSchemaVersion', 'baseProfile', 'ruleOverrides', 'lineupDefaults']
  ) or p_settings->'settingsSchemaVersion' is distinct from '1'::jsonb then
    raise exception 'SPORT_SETTINGS_INVALID: invalid Baseball team settings';
  end if;

  if not public._basketball_settings_exact_keys(p_settings->'baseProfile', array['profileId', 'profileVersion'])
     or p_settings->'baseProfile'->'profileVersion' is distinct from '1'::jsonb
     or coalesce(p_settings->'baseProfile'->>'profileId', '') not in (
       'nfhs_baseball', 'youth_baseball', 'mlb', 'ncaa_baseball',
       'nfhs_softball_fastpitch', 'softball_slowpitch', 'custom'
     ) then
    raise exception 'SPORT_SETTINGS_INVALID: unknown Baseball rules profile';
  end if;

  v_overrides := p_settings->'ruleOverrides';
  if jsonb_typeof(v_overrides) is distinct from 'object' then
    raise exception 'SPORT_SETTINGS_INVALID: invalid Baseball rule overrides';
  end if;
  for v_key, v_value in select key, value from jsonb_each(v_overrides) loop
    case v_key
      when 'scheduledInnings' then
        if not public._baseball_settings_int_between(v_value, 1, 15) then
          raise exception 'SPORT_SETTINGS_INVALID: invalid scheduled innings';
        end if;
      when 'battingOrderFormat' then
        if jsonb_typeof(v_value) is distinct from 'string'
           or (v_value #>> '{}') not in ('standard', 'designated_hitter', 'extra_hitter', 'continuous') then
          raise exception 'SPORT_SETTINGS_INVALID: invalid batting order format';
        end if;
      when 'maxExtraHitters' then
        if not public._baseball_settings_int_between(v_value, 0, 5) then
          raise exception 'SPORT_SETTINGS_INVALID: invalid extra hitters';
        end if;
      when 'runRules' then
        if jsonb_typeof(v_value) is distinct from 'array' or jsonb_array_length(v_value) > 5 then
          raise exception 'SPORT_SETTINGS_INVALID: invalid run rules';
        end if;
        for v_rule in select value from jsonb_array_elements(v_value) loop
          if not public._basketball_settings_exact_keys(v_rule, array['afterInning', 'lead'])
             or not public._baseball_settings_int_between(v_rule->'afterInning', 1, 15)
             or not public._baseball_settings_int_between(v_rule->'lead', 1, 100) then
            raise exception 'SPORT_SETTINGS_INVALID: invalid run rule';
          end if;
        end loop;
      when 'pitchCountLimit' then
        if jsonb_typeof(v_value) <> 'null' and not public._baseball_settings_int_between(v_value, 1, 500) then
          raise exception 'SPORT_SETTINGS_INVALID: invalid pitch count limit';
        end if;
      else
        raise exception 'SPORT_SETTINGS_INVALID: unsupported Baseball rule override';
    end case;
  end loop;

  v_lineup := p_settings->'lineupDefaults';
  if not public._basketball_settings_exact_keys(v_lineup, array['version', 'battingOrder', 'defense'])
     or v_lineup->'version' is distinct from '1'::jsonb
     or jsonb_typeof(v_lineup->'battingOrder') is distinct from 'array'
     or jsonb_typeof(v_lineup->'defense') is distinct from 'object'
     or jsonb_array_length(v_lineup->'battingOrder') > 30 then
    raise exception 'SPORT_SETTINGS_INVALID: invalid Baseball default lineup';
  end if;

  for v_value in select value from jsonb_array_elements(v_lineup->'battingOrder') loop
    if jsonb_typeof(v_value) is distinct from 'string' or
       (v_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'SPORT_SETTINGS_INVALID: invalid batting order identity';
    end if;
    v_id := (v_value #>> '{}')::uuid;
    if v_id = any(v_ids) then
      raise exception 'SPORT_SETTINGS_INVALID: duplicate batting order identity';
    end if;
    v_ids := array_append(v_ids, v_id);
  end loop;

  for v_key, v_value in select key, value from jsonb_each(v_lineup->'defense') loop
    if v_key not in ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10') then
      raise exception 'SPORT_SETTINGS_INVALID: invalid fielding position';
    end if;
    if jsonb_typeof(v_value) is distinct from 'string' or
       (v_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'SPORT_SETTINGS_INVALID: invalid fielder identity';
    end if;
    v_id := (v_value #>> '{}')::uuid;
    if v_id = any(v_fielders) then
      raise exception 'SPORT_SETTINGS_INVALID: a player can field only one position';
    end if;
    v_fielders := array_append(v_fielders, v_id);
  end loop;

  if exists (
    select 1 from unnest(v_ids || v_fielders) as lineup_player(id)
    where not exists (
      select 1 from public.team_players roster
      where roster.team_id = p_team_id and roster.player_id = lineup_player.id and roster.is_active
    )
  ) then
    raise exception 'SPORT_SETTINGS_INVALID: remove unavailable players from the default lineup before saving';
  end if;
end;
$$;

revoke all on function public._validate_baseball_team_settings_payload(uuid, jsonb) from public, anon, authenticated;

create or replace function public.save_baseball_team_settings_revisioned(
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
  if v_sport is distinct from 'baseball' then raise exception 'Team sport does not match Baseball settings'; end if;
  perform pg_advisory_xact_lock(hashtextextended('baseball-settings:' || p_team_id::text, 0));
  perform public._validate_baseball_team_settings_payload(p_team_id, p_settings);
  return public._save_sport_settings_revisioned_core('team', v_user_id, p_team_id,
    'baseball', 1, p_expected_revision, p_settings, 'baseball_settings_changed');
end;
$$;

revoke all on function public.save_baseball_team_settings_revisioned(uuid, bigint, jsonb) from public;
grant execute on function public.save_baseball_team_settings_revisioned(uuid, bigint, jsonb) to authenticated;
notify pgrst, 'reload schema';
