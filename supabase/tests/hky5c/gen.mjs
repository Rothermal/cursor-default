// Writes check.sql for the HKY-5C database check: the client parser's verdict on every settings
// case against `_validate_hockey_settings_payload`, then the save RPCs as real team roles.
// Usage: node gen.mjs <work dir holding cases.json>
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
const dir = process.argv[2]
const { active, cases } = JSON.parse(readFileSync(`${dir}/cases.json`, 'utf8'))
const q = v => v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`
const j = v => `${q(JSON.stringify(v))}::jsonb`
const [owner, admin, scorer, viewer, outsider, season, team, otherSeason, otherTeam] = Array.from({ length: 9 }, () => randomUUID())
const inactive = '00000000-0000-4000-8000-000000000099'
const as = id => `reset role; select set_config('request.jwt.claim.sub', '${id}', false); set role authenticated;\n`
// Runs `call` as a role and fails the check unless it raises an error containing `message`.
const refused = (id, label, call, message) => as(id) + `do $$ begin
  begin perform ${call}; exception when others then
    if position(${q(message)} in sqlerrm) = 0 then raise exception '${label}: unexpected error %', sqlerrm; end if;
    raise notice 'refused: ${label}'; return;
  end;
  raise exception '${label}: was not refused';
end $$;\n`
const check = (label, condition) => `reset role;\ndo $$ begin if not coalesce((${condition}), false) then raise exception 'check failed: ${label}'; end if; end $$;\n`

let s = `\\set ON_ERROR_STOP 1\n\\pset footer off\n`
s += `insert into auth.users (id, email) values ('${owner}','o@x.test'),('${admin}','a@x.test'),('${scorer}','s@x.test'),('${viewer}','v@x.test'),('${outsider}','x@x.test');\n`
s += `insert into public.seasons (id, owner_id, name, sport) values ('${season}', '${owner}', 'S', 'hockey'), ('${otherSeason}', '${owner}', 'B', 'basketball');\n`
s += `insert into public.teams (id, owner_id, name, season_id) values ('${team}', '${owner}', 'Blades', '${season}'), ('${otherTeam}', '${owner}', 'Hoops', '${otherSeason}');\n`
s += `insert into public.team_members (team_id, user_id, role, accepted_at) values ('${team}','${admin}','admin',now()),('${team}','${scorer}','scorer',now()),('${team}','${viewer}','viewer',now()) on conflict do nothing;\n`
s += `select set_config('request.jwt.claim.sub', '${owner}', false);\n`
s += `insert into public.players (id, first_name, created_by) select id::uuid, 'P', '${owner}' from unnest(${q(`{${[...active, inactive].join(',')}}`)}::text[]) as ids(id);\n`
s += `insert into public.team_players (team_id, player_id, is_active) select '${team}', id::uuid, true from unnest(${q(`{${active.join(',')}}`)}::text[]) as ids(id);\n`
s += `insert into public.team_players (team_id, player_id, is_active) values ('${team}', '${inactive}', false);\n`

s += `\\echo '== parity with the client parser'\n`
s += `create temporary table parity (name text, scope text, expected boolean, error text);\n`
for (const c of cases) {
  s += `do $$ begin
  begin
    perform public._validate_hockey_settings_payload(${q(c.scope)}, ${c.scope === 'team' ? `'${team}'` : 'null'}, ${j(c.settings)});
    insert into parity values (${q(c.name)}, ${q(c.scope)}, ${c.ok}, null);
  exception when others then
    insert into parity values (${q(c.name)}, ${q(c.scope)}, ${c.ok}, sqlerrm);
  end;
end $$;\n`
}
s += `select scope, name, expected, coalesce(error, '') as server_error, (error is null) = expected as pass from parity order by scope desc, expected desc, name;\n`
s += `do $$ begin if exists (select 1 from parity where (error is null) <> expected) then raise exception 'parity failed'; end if; end $$;\n`

const youth = { settingsSchemaVersion: 1, baseProfile: { profileId: 'usa_hockey_youth', profileVersion: 1 }, ruleOverrides: {} }
const ncaa = { ...youth, baseProfile: { profileId: 'ncaa', profileVersion: 1 }, ruleOverrides: { trapezoid: true } }
const lineup = { version: 1, starterPlayerIds: active.slice(0, 5), startingGoaliePlayerId: active[5], backupGoaliePlayerId: active[6] }
const teamSettings = { ...ncaa, lineupDefaults: lineup }

s += `\\echo '== capabilities'\n` + as(scorer)
s += `select public.get_hockey_release_capabilities();\n`
s += as(scorer) + `do $$ begin if public.get_hockey_release_capabilities() <> '{"contractVersion":2,"migration":74,"eventTransportVersion":4,"recoveryVersion":1,"recorderResolutionVersion":1,"canonicalFinalizationVersion":1,"setupSnapshotVersion":1,"settingsContractVersion":1}'::jsonb then raise exception 'capabilities differ'; end if; end $$;\n`

s += `\\echo '== personal settings (scorer)'\n` + as(scorer)
s += `select public.save_hockey_user_settings_revisioned(null, ${j(ncaa)})->>'status' as first_save;\n`
s += as(scorer) + `do $$ declare r jsonb; begin
  r := public.save_hockey_user_settings_revisioned(null, ${j(youth)});
  if r->>'status' <> 'conflict' or (r->'record'->>'revision')::int <> 1 then raise exception 'stale personal save was not a conflict: %', r; end if;
  r := public.save_hockey_user_settings_revisioned(1, ${j(youth)});
  if r->>'status' <> 'applied' or (r->'record'->>'revision')::int <> 2 then raise exception 'personal save: %', r; end if;
end $$;\n`
s += refused(scorer, 'personal settings with a lineup', `public.save_hockey_user_settings_revisioned(2, ${j(teamSettings)})`, 'SPORT_SETTINGS_INVALID')
s += check('personal row', `(select settings = ${j(youth)} and revision = 2 from public.user_sport_settings where user_id = '${scorer}' and sport_id = 'hockey')`)

s += `\\echo '== team settings by role'\n`
s += refused(scorer, 'scorer team save', `public.save_hockey_team_settings_revisioned('${team}', null, ${j(teamSettings)})`, 'owner or admin')
s += refused(viewer, 'viewer team save', `public.save_hockey_team_settings_revisioned('${team}', null, ${j(teamSettings)})`, 'owner or admin')
s += refused(outsider, 'outsider team save', `public.save_hockey_team_settings_revisioned('${team}', null, ${j(teamSettings)})`, 'owner or admin')
s += refused(owner, 'basketball team', `public.save_hockey_team_settings_revisioned('${otherTeam}', null, ${j(teamSettings)})`, 'does not match Hockey')
s += refused(owner, 'inactive goalie', `public.save_hockey_team_settings_revisioned('${team}', null, ${j({ ...teamSettings, lineupDefaults: { ...lineup, backupGoaliePlayerId: inactive } })})`, 'remove unavailable players')
s += as(owner) + `select public.save_hockey_team_settings_revisioned('${team}', null, ${j(teamSettings)})->>'status' as owner_save;\n`
s += as(admin) + `do $$ declare r jsonb; begin
  r := public.save_hockey_team_settings_revisioned('${team}', null, ${j(teamSettings)});
  if r->>'status' <> 'conflict' then raise exception 'stale team save was not a conflict: %', r; end if;
  r := public.save_hockey_team_settings_revisioned('${team}', 1, ${j({ ...teamSettings, ruleOverrides: {} })});
  if r->>'status' <> 'applied' or (r->'record'->>'revision')::int <> 2 then raise exception 'admin save: %', r; end if;
end $$;\n`
s += as(viewer) + `do $$ begin if (select revision from public.team_sport_settings where team_id = '${team}' and sport_id = 'hockey') <> 2 then raise exception 'viewer cannot read the team row'; end if; end $$;\n`
s += check('audit rows', `(select count(*) = 2 and bool_and(metadata->>'sport_id' = 'hockey') from public.access_audit_events where team_id = '${team}' and event_type = 'hockey_settings_changed')`)
s += check('private helpers', `not has_function_privilege('authenticated', 'public._validate_hockey_settings_payload(text,uuid,jsonb)', 'execute') and not has_function_privilege('authenticated', 'public._hockey_rules_error(jsonb)', 'execute')`)
s += `\\echo 'HKY-5C flow passed'\n`
writeFileSync(`${dir}/check.sql`, s)
