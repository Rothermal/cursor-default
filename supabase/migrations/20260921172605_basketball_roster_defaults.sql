-- BAR-1: additive team-only defaults. No historical match data is rewritten.
create or replace function public.save_basketball_team_settings_revisioned(
  p_team_id uuid, p_expected_revision bigint, p_settings jsonb
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_sport text;
  v_schema integer := 1;
  v_defaults jsonb;
  v_ids uuid[] := '{}';
  v_id jsonb;
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
  if v_sport is distinct from 'basketball' then raise exception 'Team sport does not match Basketball settings'; end if;
  -- Serialize first creation and old/new client writes for this team's settings.
  perform pg_advisory_xact_lock(hashtextextended('basketball-settings:' || p_team_id::text, 0));
  if p_settings ? 'lineupDefaults' then
    v_schema := 2;
    if not public._basketball_settings_exact_keys(p_settings, array['baseProfile', 'ruleOverrides', 'lineupDefaults']) then
      raise exception 'SPORT_SETTINGS_INVALID: invalid Basketball team defaults';
    end if;
    v_defaults := p_settings->'lineupDefaults';
    if not public._basketball_settings_exact_keys(v_defaults, array['version', 'starterPlayerIds'])
       or v_defaults->'version' is distinct from '1'::jsonb
       or jsonb_typeof(v_defaults->'starterPlayerIds') is distinct from 'array' then
      raise exception 'SPORT_SETTINGS_INVALID: invalid starter defaults';
    end if;
    if jsonb_array_length(v_defaults->'starterPlayerIds') > 5 then
      raise exception 'SPORT_SETTINGS_INVALID: at most five default starters';
    end if;
    for v_id in select value from jsonb_array_elements(v_defaults->'starterPlayerIds') loop
      if jsonb_typeof(v_id) is distinct from 'string' or
         (v_id #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'SPORT_SETTINGS_INVALID: invalid starter identity';
      end if;
      if (v_id #>> '{}')::uuid = any(v_ids) then
        raise exception 'SPORT_SETTINGS_INVALID: duplicate starter identity';
      end if;
      v_ids := array_append(v_ids, (v_id #>> '{}')::uuid);
    end loop;
    if exists (select 1 from unnest(v_ids) as starter(id) where not exists (
      select 1 from public.team_players roster where roster.team_id = p_team_id
        and roster.player_id = starter.id and roster.is_active
    )) then raise exception 'SPORT_SETTINGS_INVALID: remove unavailable default starters before saving'; end if;
    perform public._validate_basketball_settings_payload('team', p_settings - 'lineupDefaults');
  else
    if exists (select 1 from public.team_sport_settings where team_id = p_team_id
      and sport_id = 'basketball' and schema_version >= 2) then
      raise exception 'SPORT_SETTINGS_INVALID: refresh StatKeeper before editing roster defaults';
    end if;
    perform public._validate_basketball_settings_payload('team', p_settings);
  end if;
  return public._save_sport_settings_revisioned_core('team', v_user_id, p_team_id,
    'basketball', v_schema, p_expected_revision, p_settings, 'basketball_settings_changed');
end;
$$;
revoke all on function public.save_basketball_team_settings_revisioned(uuid, bigint, jsonb) from public;
grant execute on function public.save_basketball_team_settings_revisioned(uuid, bigint, jsonb) to authenticated;
notify pgrst, 'reload schema';
