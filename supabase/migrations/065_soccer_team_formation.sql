-- SOC-S19A: versioned Soccer team formations remain setup-only defaults.

create or replace function public._validate_soccer_team_formation(
  p_formation jsonb
)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_template_id text;
  v_assignments jsonb;
  v_allowed_slots text[];
  v_assignment record;
begin
  if jsonb_typeof(p_formation) = 'null' then
    return;
  end if;
  if jsonb_typeof(p_formation) is distinct from 'object'
     or not (p_formation ?& array['version', 'templateId', 'assignments'])
     or (select count(*) from jsonb_object_keys(p_formation)) <> 3 then
    raise exception 'SPORT_SETTINGS_INVALID: soccer formation must use the exact schema';
  end if;
  if not public._sport_settings_is_integer(p_formation->'version')
     or (p_formation->>'version')::integer <> 1 then
    raise exception 'SPORT_SETTINGS_INVALID: soccer formation version is unsupported';
  end if;
  if jsonb_typeof(p_formation->'templateId') is distinct from 'string' then
    raise exception 'SPORT_SETTINGS_INVALID: soccer formation template is invalid';
  end if;

  v_template_id := p_formation->>'templateId';
  v_allowed_slots := case v_template_id
    when '11v11-4-3-3' then array['gk','lb','lcb','rcb','rb','lcm','cm','rcm','lw','st','rw']
    when '11v11-4-4-2' then array['gk','lb','lcb','rcb','rb','lm','lcm','rcm','rm','lst','rst']
    when '11v11-3-4-3' then array['gk','lcb','cb','rcb','lm','lcm','rcm','rm','lw','st','rw']
    when '9v9-3-3-2' then array['gk','lcb','cb','rcb','lm','cm','rm','lst','rst']
    when '9v9-3-2-3' then array['gk','lcb','cb','rcb','lcm','rcm','lw','st','rw']
    when '9v9-2-3-3' then array['gk','lcb','rcb','lm','cm','rm','lw','st','rw']
    when '7v7-2-3-1' then array['gk','lcb','rcb','lm','cm','rm','st']
    when '7v7-3-2-1' then array['gk','lcb','cb','rcb','lcm','rcm','st']
    when '7v7-2-2-2' then array['gk','lcb','rcb','lcm','rcm','lst','rst']
    else null
  end;
  if v_allowed_slots is null then
    raise exception 'SPORT_SETTINGS_INVALID: soccer formation template is unknown';
  end if;

  v_assignments := p_formation->'assignments';
  if jsonb_typeof(v_assignments) is distinct from 'object' then
    raise exception 'SPORT_SETTINGS_INVALID: soccer formation assignments must be an object';
  end if;
  for v_assignment in select key, value from jsonb_each(v_assignments)
  loop
    if not (v_assignment.key = any(v_allowed_slots)) then
      raise exception 'SPORT_SETTINGS_INVALID: soccer formation slot is invalid for template';
    end if;
    if jsonb_typeof(v_assignment.value) is distinct from 'string'
       or (v_assignment.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'SPORT_SETTINGS_INVALID: soccer formation player ids must be UUIDs';
    end if;
  end loop;
  if exists (
    select 1
    from jsonb_each(v_assignments) assignment
    group by lower(assignment.value #>> '{}')
    having count(*) > 1
  ) then
    raise exception 'SPORT_SETTINGS_INVALID: soccer formation player may occupy only one slot';
  end if;
end;
$$;

create or replace function public._validate_sport_settings_payload(
  p_sport_id text,
  p_schema_version integer,
  p_scope text,
  p_settings jsonb
)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_sport_id is null
     or p_schema_version is null
     or p_sport_id <> 'soccer' then
    raise exception 'SPORT_SETTINGS_UNSUPPORTED_SCHEMA';
  end if;
  if jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'SPORT_SETTINGS_INVALID: settings must be an object';
  end if;

  if p_scope = 'user' then
    if p_schema_version <> 1 then
      raise exception 'SPORT_SETTINGS_UNSUPPORTED_SCHEMA';
    end if;
    if not (p_settings ?& array['rules', 'display'])
       or (select count(*) from jsonb_object_keys(p_settings)) <> 2 then
      raise exception 'SPORT_SETTINGS_INVALID: personal settings must contain rules and display';
    end if;
    perform public._validate_soccer_rule_settings(p_settings->'rules', true);
    if jsonb_typeof(p_settings->'display') is distinct from 'object' then
      raise exception 'SPORT_SETTINGS_INVALID: soccer display settings are invalid';
    end if;
    if not ((p_settings->'display') ? 'fieldFlipped')
       or (select count(*) from jsonb_object_keys(p_settings->'display')) <> 1
       or jsonb_typeof(p_settings->'display'->'fieldFlipped') is distinct from 'boolean' then
      raise exception 'SPORT_SETTINGS_INVALID: soccer display settings are invalid';
    end if;
    return;
  end if;

  if p_scope = 'team' then
    if p_schema_version = 1 then
      if not (p_settings ? 'rules')
         or (select count(*) from jsonb_object_keys(p_settings)) <> 1 then
        raise exception 'SPORT_SETTINGS_INVALID: legacy team settings must contain only rules';
      end if;
      perform public._validate_soccer_rule_settings(p_settings->'rules', false);
      return;
    end if;
    if p_schema_version = 2 then
      if not (p_settings ?& array['rules', 'formation'])
         or (select count(*) from jsonb_object_keys(p_settings)) <> 2 then
        raise exception 'SPORT_SETTINGS_INVALID: team settings must contain rules and formation';
      end if;
      perform public._validate_soccer_rule_settings(p_settings->'rules', false);
      perform public._validate_soccer_team_formation(p_settings->'formation');
      return;
    end if;
    raise exception 'SPORT_SETTINGS_UNSUPPORTED_SCHEMA';
  end if;

  raise exception 'SPORT_SETTINGS_INVALID: settings scope is invalid';
end;
$$;

create or replace function public.save_team_sport_settings_revisioned(
  p_team_id uuid,
  p_sport_id text,
  p_schema_version integer,
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
  v_team_sport text;
  v_existing public.team_sport_settings%rowtype;
  v_saved public.team_sport_settings%rowtype;
  v_exists boolean;
  v_previous_settings jsonb := '{}'::jsonb;
  v_changed_fields jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if not public.has_active_app_access() then
    raise exception 'Active app access is required';
  end if;
  if coalesce(public.current_team_role(p_team_id), '') not in ('owner', 'admin') then
    raise exception 'Team owner or admin access is required';
  end if;
  if p_expected_revision is not null and p_expected_revision <= 0 then
    raise exception 'SPORT_SETTINGS_INVALID: expected revision must be positive';
  end if;

  select season.sport
  into v_team_sport
  from public.teams team
  join public.seasons season on season.id = team.season_id
  where team.id = p_team_id;
  if v_team_sport is null then
    raise exception 'Team sport could not be resolved';
  end if;
  if v_team_sport <> p_sport_id then
    raise exception 'Team sport does not match settings sport';
  end if;

  perform public._validate_sport_settings_payload(
    p_sport_id,
    p_schema_version,
    'team',
    p_settings
  );

  select *
  into v_existing
  from public.team_sport_settings
  where team_id = p_team_id
    and sport_id = p_sport_id
  for update;
  v_exists := found;

  if v_exists then
    if p_expected_revision is null or p_expected_revision <> v_existing.revision then
      return jsonb_build_object(
        'status', 'conflict',
        'record', public._sport_settings_record_json(
          v_existing.sport_id,
          v_existing.schema_version,
          v_existing.revision,
          v_existing.settings,
          v_existing.updated_at,
          v_existing.updated_by
        )
      );
    end if;

    v_previous_settings := v_existing.settings;
    update public.team_sport_settings
    set
      schema_version = p_schema_version,
      revision = revision + 1,
      settings = p_settings,
      updated_at = now(),
      updated_by = v_user_id
    where team_id = p_team_id
      and sport_id = p_sport_id
      and revision = p_expected_revision
    returning * into v_saved;
    if not found then
      select *
      into v_existing
      from public.team_sport_settings
      where team_id = p_team_id
        and sport_id = p_sport_id;
      if found then
        return jsonb_build_object(
          'status', 'conflict',
          'record', public._sport_settings_record_json(
            v_existing.sport_id,
            v_existing.schema_version,
            v_existing.revision,
            v_existing.settings,
            v_existing.updated_at,
            v_existing.updated_by
          )
        );
      end if;
      return jsonb_build_object('status', 'conflict', 'record', null);
    end if;
  else
    if p_expected_revision is not null then
      return jsonb_build_object('status', 'conflict', 'record', null);
    end if;

    insert into public.team_sport_settings (
      team_id,
      sport_id,
      schema_version,
      settings,
      updated_by
    ) values (
      p_team_id,
      p_sport_id,
      p_schema_version,
      p_settings,
      v_user_id
    )
    on conflict (team_id, sport_id) do nothing
    returning * into v_saved;

    if not found then
      select *
      into v_existing
      from public.team_sport_settings
      where team_id = p_team_id
        and sport_id = p_sport_id;
      return jsonb_build_object(
        'status', 'conflict',
        'record', public._sport_settings_record_json(
          v_existing.sport_id,
          v_existing.schema_version,
          v_existing.revision,
          v_existing.settings,
          v_existing.updated_at,
          v_existing.updated_by
        )
      );
    end if;
  end if;

  select coalesce(jsonb_agg(changed.key order by changed.key), '[]'::jsonb)
  into v_changed_fields
  from (
    select candidate.key
    from (
      select jsonb_object_keys(
        coalesce(v_previous_settings->'rules', '{}'::jsonb)
      ) as key
      union
      select jsonb_object_keys(
        coalesce(p_settings->'rules', '{}'::jsonb)
      ) as key
    ) candidate
    where v_previous_settings->'rules'->(candidate.key)
      is distinct from p_settings->'rules'->(candidate.key)
    union all
    select 'formation'
    where coalesce(v_previous_settings->'formation', 'null'::jsonb)
      is distinct from coalesce(p_settings->'formation', 'null'::jsonb)
  ) changed;

  perform public.record_access_audit_event(
    p_event_type => 'soccer_settings_changed',
    p_actor_user_id => v_user_id,
    p_team_id => p_team_id,
    p_metadata => jsonb_build_object(
      'sport_id', p_sport_id,
      'revision', v_saved.revision,
      'changed_fields', v_changed_fields
    )
  );

  return jsonb_build_object(
    'status', 'applied',
    'record', public._sport_settings_record_json(
      v_saved.sport_id,
      v_saved.schema_version,
      v_saved.revision,
      v_saved.settings,
      v_saved.updated_at,
      v_saved.updated_by
    )
  );
end;
$$;

revoke all on function public._validate_soccer_team_formation(jsonb) from public;
revoke all on function public._validate_sport_settings_payload(text, integer, text, jsonb) from public;
revoke all on function public.save_team_sport_settings_revisioned(
  uuid,
  text,
  integer,
  bigint,
  jsonb
) from public;

grant execute on function public.save_team_sport_settings_revisioned(
  uuid,
  text,
  integer,
  bigint,
  jsonb
) to authenticated;
