-- BSB-7C1: fixed personal settings RPCs. Existing team settings, event transport,
-- aggregate/link capabilities and release contract 2/078 remain unchanged.

create or replace function public._validate_baseball_personal_settings(p_settings jsonb)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if not public._basketball_settings_exact_keys(
    p_settings, array['settingsSchemaVersion', 'baseProfile', 'ruleOverrides']
  ) then
    raise exception 'SPORT_SETTINGS_INVALID: invalid personal Baseball settings';
  end if;
  -- All five permitted overrides share 071's exact bounds and immutable profiles.
  -- An empty lineup validates no player identities and never enters the saved payload.
  perform public._validate_baseball_team_settings_payload(null,
    p_settings || jsonb_build_object('lineupDefaults',
      jsonb_build_object('version', 1, 'battingOrder', '[]'::jsonb, 'defense', '{}'::jsonb)));
end;
$$;

create or replace function public.get_baseball_personal_settings(p_expected_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_record public.user_sport_settings%rowtype;
begin
  if v_user_id is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  if not public.has_active_app_access() then raise insufficient_privilege using message = 'Active app access is required'; end if;
  if p_expected_user_id is distinct from v_user_id then
    raise insufficient_privilege using message = 'The settings account changed';
  end if;
  select * into v_record from public.user_sport_settings
    where user_id = v_user_id and sport_id = 'baseball';
  if not found then return jsonb_build_object('status', 'missing'); end if;
  return jsonb_build_object('status', 'loaded', 'record', public._sport_settings_record_json(
    v_record.sport_id, v_record.schema_version, v_record.revision,
    v_record.settings, v_record.updated_at, null));
end;
$$;

create or replace function public.save_baseball_user_settings_revisioned(
  p_expected_user_id uuid,
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
  if v_user_id is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  if not public.has_active_app_access() then raise insufficient_privilege using message = 'Active app access is required'; end if;
  if p_expected_user_id is distinct from v_user_id then
    raise insufficient_privilege using message = 'The settings account changed';
  end if;
  if p_expected_revision is not null and p_expected_revision <= 0 then
    raise exception 'SPORT_SETTINGS_INVALID: expected revision must be positive';
  end if;
  perform public._validate_baseball_personal_settings(p_settings);
  return public._save_sport_settings_revisioned_core('user', v_user_id, null,
    'baseball', 1, p_expected_revision, p_settings, null);
end;
$$;

create or replace function public.get_baseball_personal_settings_capabilities()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  if not public.has_active_app_access() then raise insufficient_privilege using message = 'Active app access is required'; end if;
  return jsonb_build_object('contractVersion', 1, 'sportId', 'baseball',
    'personalSettingsVersion', 1, 'migration', 80);
end;
$$;

revoke all on function public._validate_baseball_personal_settings(jsonb) from public, anon, authenticated;
revoke all on function public.get_baseball_personal_settings(uuid) from public, anon;
revoke all on function public.save_baseball_user_settings_revisioned(uuid, bigint, jsonb) from public, anon;
revoke all on function public.get_baseball_personal_settings_capabilities() from public, anon;
grant execute on function public.get_baseball_personal_settings(uuid) to authenticated;
grant execute on function public.save_baseball_user_settings_revisioned(uuid, bigint, jsonb) to authenticated;
grant execute on function public.get_baseball_personal_settings_capabilities() to authenticated;

notify pgrst, 'reload schema';
