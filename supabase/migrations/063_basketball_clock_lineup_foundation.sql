-- BKE-6A1: strict version-3 Basketball settings and an isolated feature handshake.

alter function public._validate_basketball_rule_overrides(jsonb)
  rename to _validate_basketball_rule_overrides_v2;

create or replace function public._validate_basketball_rule_overrides(p_overrides jsonb)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_allowed constant text[] := array[
    'regulationSegments',
    'overtimeTemplate',
    'foulWindows',
    'timeoutPools',
    'personalFoulLimit',
    'clockModel',
    'clockDisplayDirection',
    'clockExpiration',
    'stoppageMode',
    'equalPlayPolicy'
  ];
  v_v3_only_count integer;
  v_policy jsonb;
begin
  if jsonb_typeof(p_overrides) is distinct from 'object'
     or exists (
       select 1
       from jsonb_object_keys(p_overrides) key
       where not (key = any(v_allowed))
     ) then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball rule overrides are invalid';
  end if;

  v_v3_only_count :=
    (case when p_overrides ? 'clockDisplayDirection' then 1 else 0 end) +
    (case when p_overrides ? 'clockExpiration' then 1 else 0 end) +
    (case when p_overrides ? 'stoppageMode' then 1 else 0 end) +
    (case when p_overrides ? 'equalPlayPolicy' then 1 else 0 end);

  -- A version-2 clockModel:none override remains valid and keeps its historical shape.
  if v_v3_only_count = 0 then
    perform public._validate_basketball_rule_overrides_v2(p_overrides);
    return;
  end if;
  if v_v3_only_count <> 4 or not (p_overrides ? 'clockModel') then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball clock and lineup overrides must be saved together';
  end if;

  if jsonb_typeof(p_overrides->'clockModel') is distinct from 'string'
     or p_overrides->>'clockModel' not in ('none', 'anchored')
     or jsonb_typeof(p_overrides->'clockDisplayDirection') is distinct from 'string'
     or p_overrides->>'clockDisplayDirection' not in ('count_down', 'count_up')
     or jsonb_typeof(p_overrides->'clockExpiration') is distinct from 'string'
     or p_overrides->>'clockExpiration' <> 'stop_at_zero'
     or jsonb_typeof(p_overrides->'stoppageMode') is distinct from 'string'
     or p_overrides->>'stoppageMode' <> 'explicit' then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball clock and stoppage rules are invalid';
  end if;

  v_policy := p_overrides->'equalPlayPolicy';
  if jsonb_typeof(v_policy) is distinct from 'object'
     or not public._basketball_settings_exact_keys(
       v_policy,
       array[
         'mode', 'minimumPeriods', 'maximumConsecutivePeriods',
         'maximumPeriodImbalance'
       ]
     )
     or jsonb_typeof(v_policy->'mode') is distinct from 'string'
     or v_policy->>'mode' not in ('off', 'advisory', 'enforced')
     or exists (
       select 1
       from jsonb_each(v_policy) item
       where item.key <> 'mode'
         and item.value <> 'null'::jsonb
         and (
           not public._sport_settings_is_integer(item.value)
           or (item.value #>> '{}')::integer <= 0
         )
     ) then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball equal-play policy is invalid';
  end if;
  if p_overrides->>'clockModel' = 'none' and v_policy->>'mode' <> 'off' then
    raise exception 'SPORT_SETTINGS_INVALID: Clockless Basketball requires equal play to be off';
  end if;

  perform public._validate_basketball_rule_overrides_v2(
    jsonb_set(
      p_overrides
        - 'clockDisplayDirection'
        - 'clockExpiration'
        - 'stoppageMode'
        - 'equalPlayPolicy',
      '{clockModel}',
      '"none"'::jsonb,
      true
    )
  );
end;
$$;

create or replace function public.get_basketball_clock_lineup_capabilities_v1()
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
  return jsonb_build_object('clockAndLineupsVersion', 1);
end;
$$;

revoke all on function public._validate_basketball_rule_overrides_v2(jsonb) from public;
revoke all on function public._validate_basketball_rule_overrides(jsonb) from public;
revoke all on function public.get_basketball_clock_lineup_capabilities_v1() from public;
revoke execute on function public.get_basketball_clock_lineup_capabilities_v1() from anon;
grant execute on function public.get_basketball_clock_lineup_capabilities_v1() to authenticated;

comment on function public.get_basketball_clock_lineup_capabilities_v1() is
  'Exact BKE-6A Basketball clock and lineup feature capability.';

notify pgrst, 'reload schema';
