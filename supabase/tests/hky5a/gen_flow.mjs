// Writes flow.sql: the shootout early-clinch game through bind, upload, readiness, finalize and
// reopen as real team roles. Usage: node gen_flow.mjs <work dir holding cases.json>
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
const dir = process.argv[2]
const cases = JSON.parse(readFileSync(`${dir}/cases.json`, 'utf8'))
const c = cases.find(x => x.name === 'shootout early clinch')
const q = v => v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`
const j = v => v === null || v === undefined ? 'null' : `${q(JSON.stringify(v))}::jsonb`
const [owner, scorer, viewer, outsider, season, team] = Array.from({ length: 6 }, () => randomUUID())
const local = 'local-' + randomUUID()
const participants = c.setup.participants.map(p => ({ client_participant_id: p.id, client_player_id: p.playerId, source_player_id: null, kind: 'player', display_name: p.displayName, jersey_number: p.number, snapshot: {} }))
const setup = { ...c.setup }
const events = c.events.map(e => ({ ...e, recorderUserId: scorer }))
const as = id => `reset role; select set_config('request.jwt.claim.sub', '${id}', false); set role authenticated;\n`
// Fails the run unless the condition holds for the given role (null: the database owner).
const check = (id, label, condition) => (id ? as(id) : 'reset role;\n') + `do $$ begin if not coalesce((${condition}), false) then raise exception 'check failed: ${label}'; end if; end $$;\n`
let s = `\\set ON_ERROR_STOP 1\n\\pset footer off\n`
s += `insert into auth.users (id, email) values ('${owner}','o@x.test'),('${scorer}','s@x.test'),('${viewer}','v@x.test'),('${outsider}','x@x.test');\n`
s += `insert into public.seasons (id, owner_id, name, sport) values ('${season}', '${owner}', 'S', 'hockey');\n`
s += `insert into public.teams (id, owner_id, name, season_id) values ('${team}', '${owner}', 'Blades', '${season}');\n`
s += `insert into public.team_members (team_id, user_id, role, accepted_at) values ('${team}','${scorer}','scorer',now()),('${team}','${viewer}','viewer',now()) on conflict do nothing;\n`
s += `select user_id = '${owner}' as owner_row, role, accepted_at is not null as accepted from public.team_members where team_id = '${team}' order by role;\n`
s += `\\echo '== capabilities (scorer)'\n` + as(scorer) + `select public.get_hockey_release_capabilities();\n`
s += check(scorer, 'capabilities', `(public.get_hockey_release_capabilities()->>'contractVersion') = '1' and (public.get_hockey_release_capabilities()->>'migration') = '73'`)
s += `\\echo '== bind as scorer'\n` + as(scorer)
s += `select (public.bind_hockey_event_game_v5(null, ${q(local)}, '${team}', '${season}', 'Blades', 'Rivals', null, '2026-10-03', ${j(participants)}, ${j(setup)}, false))->>'game_id' as game_id \\gset\n`
s += `\\echo game :game_id\n`
s += `create temporary table if not exists _ev (doc jsonb);\n`
s += `reset role; grant all on _ev to authenticated; truncate _ev; insert into _ev select value from jsonb_array_elements(${j(events)});\n`
s += as(scorer) + `do $$ declare e jsonb; r text; g uuid := current_setting('flow.game')::uuid; acts jsonb; begin
  for e in select doc from _ev order by (doc->>'sequence')::bigint loop
    select coalesce(jsonb_agg(case when a.value->>'kind' = 'player' then jsonb_set(a.value, '{playerId}', to_jsonb(p.id::text)) else a.value end order by a.ordinality), '[]'::jsonb)
      into acts
      from jsonb_array_elements(e->'actors') with ordinality a(value, ordinality)
      left join public.game_participants p on p.game_id = g and p.client_player_id = a.value->>'playerId';
    r := public.upsert_game_event_revisioned((e->>'id')::uuid, g, e->>'sportId', e->>'eventType', (e->>'schemaVersion')::int, (e->>'sequence')::bigint, (e->>'revision')::int,
      e#>>'{period,id}', (e#>>'{period,order}')::int, nullif(e->>'elapsedMs','')::bigint, (e->>'occurredAt')::timestamptz, e->>'teamSide', nullif(e->'location','null'::jsonb), acts, e->'payload',
      (e->>'createdAt')::timestamptz, (e->>'updatedAt')::timestamptz, nullif(e->>'deletedAt','')::timestamptz);
    if r is distinct from 'applied' and r is distinct from 'inserted' and r is distinct from 'written' then raise exception 'upsert % -> %', e->>'eventType', r; end if;
  end loop;
end $$;\n`
s = s.replace(`\\echo game :game_id\n`, `\\echo game :game_id\nselect set_config('flow.game', :'game_id', false);\n`)
const revisions = events.map(e => ({ id: e.id, revision: e.revision }))
const maxSeq = Math.max(...events.map(e => e.sequence))
s += `select public.confirm_game_event_stream_checkpoint(:'game_id', 1, ${j(revisions)}, ${events.length}, ${maxSeq}, 'fp-1') is not null as checkpoint_ok;\n`
s += check(null, 'events uploaded', `(select count(*) from public.game_events where game_id = current_setting('flow.game')::uuid) = ${events.length}`)
s += `\\echo '== readiness as viewer, scorer, owner'\n`
for (const [name, id] of [['viewer', viewer], ['scorer', scorer], ['owner', owner]]) {
  s += as(id) + `select '${name}' as who, game_status, can_finalize, can_reopen, primary_recorded_by = '${scorer}' as primary_is_scorer, primary_ended, primary_checkpoint_current, primary_conflict_count from public.get_hockey_finalization_readiness(:'game_id');\n`
}
s += as(owner) + `select count(*) as recorders, bool_or(is_primary) as has_primary, max(event_count) as events_seen_by_manager from public.get_hockey_game_recorders(:'game_id');\n`
s += as(viewer) + `select count(*) as recorders, max(event_count) as events_seen_by_viewer from public.get_hockey_game_recorders(:'game_id');\n`
s += check(viewer, 'viewer cannot finalize', `not (select can_finalize from public.get_hockey_finalization_readiness(current_setting('flow.game')::uuid))`)
s += check(scorer, 'scorer cannot finalize', `not (select can_finalize from public.get_hockey_finalization_readiness(current_setting('flow.game')::uuid))`)
s += check(owner, 'owner readiness', `(select can_finalize and primary_recorded_by = '${scorer}' and primary_ended and primary_checkpoint_current and primary_conflict_count = 0 from public.get_hockey_finalization_readiness(current_setting('flow.game')::uuid))`)
s += check(owner, 'manager recorder detail', `(select max(event_count) from public.get_hockey_game_recorders(current_setting('flow.game')::uuid)) = ${events.length}`)
s += check(viewer, 'viewer recorder detail hidden', `(select max(event_count) from public.get_hockey_game_recorders(current_setting('flow.game')::uuid)) is null`)
const snapshot = { canonicalSchemaVersion: 1, version: 2, sportId: 'hockey', gameId: '__GAME__', primaryRecorderId: scorer, eventStream: { version: 1, events }, sportGameState: { sportId: 'hockey', setup } }
const snapJson = JSON.stringify(snapshot).replace(/'/g, "''")
s += `select replace('${snapJson}', '__GAME__', :'game_id')::jsonb as snapshot \\gset snap_\n`
s += `\\echo '== finalize as viewer (refused), with bad schema (refused), then owner'\n`
s += as(viewer) + `do $$ declare accepted boolean := false; begin begin perform public.finalize_hockey_event_game(current_setting('flow.game')::uuid, '${scorer}', ${j(revisions)}, 'fp-1', current_setting('flow.snap')::jsonb); accepted := true; exception when others then raise notice 'viewer finalize refused: %', sqlerrm; end; if accepted then raise exception 'viewer finalized'; end if; end $$;\n`
s = s.replace(`\\echo '== finalize as viewer`, `reset role; select set_config('flow.snap', :'snap_snapshot', false);\n\\echo '== finalize as viewer`)
s += as(owner) + `do $$ declare accepted boolean := false; begin begin perform public.finalize_hockey_event_game(current_setting('flow.game')::uuid, '${scorer}', ${j(revisions)}, 'fp-1', current_setting('flow.snap')::jsonb - 'canonicalSchemaVersion'); accepted := true; exception when others then raise notice 'missing schema refused: %', sqlerrm; end; if accepted then raise exception 'no schema finalized'; end if; end $$;\n`
s += as(owner) + `select public.finalize_hockey_event_game(:'game_id', '${scorer}', ${j(revisions)}, 'fp-1', :'snap_snapshot'::jsonb) ->> 'publication_number' as published;\n`
s += `reset role; select status, home_team_score, opponent_score from public.games where id = :'game_id';\n`
s += as(owner) + `select publication_number, (canonical_snapshot->>'sportId') as sport from public.get_hockey_canonical_publication(:'game_id');\n`
s += check(null, 'final 1-0', `(select status = 'final' and home_team_score = 1 and opponent_score = 0 from public.games where id = current_setting('flow.game')::uuid)`)
s += check(owner, 'publication 1', `(select publication_number = 1 from public.get_hockey_canonical_publication(current_setting('flow.game')::uuid))`)
s += `\\echo '== scorer writes after final (refused)'\n` + as(scorer) + `do $$ declare accepted boolean := false; begin begin perform public.upsert_game_event_revisioned(gen_random_uuid(), current_setting('flow.game')::uuid, 'hockey', 'hockey.shot', 1, 999, 1, 'regulation-1', 1, null, now(), 'tracked', null, '[]', '{"captureCommandId":null,"outcome":"goal","missType":null,"emptyNet":false,"penaltyShot":false,"strength":null,"onIce":null}', now(), now(), null); accepted := true; exception when others then raise notice 'final write refused: %', sqlerrm; end; if accepted then raise exception 'write accepted'; end if; end $$;\n`
s += `\\echo '== reopen: short reason refused, scorer refused, owner ok'\n`
s += as(owner) + `do $$ declare accepted boolean := false; begin begin perform public.reopen_hockey_event_game(current_setting('flow.game')::uuid, 'x'); accepted := true; exception when others then raise notice 'short reason refused: %', sqlerrm; end; if accepted then raise exception 'short reason accepted'; end if; end $$;\n`
s += as(scorer) + `do $$ declare accepted boolean := false; begin begin perform public.reopen_hockey_event_game(current_setting('flow.game')::uuid, 'Wrong score'); accepted := true; exception when others then raise notice 'scorer reopen refused: %', sqlerrm; end; if accepted then raise exception 'scorer reopened'; end if; end $$;\n`
s += as(owner) + `select public.reopen_hockey_event_game(:'game_id', 'Wrong score') ? 'reopened_at' as reopened;\n`
s += `reset role; select status, home_team_score, opponent_score from public.games where id = :'game_id';\n`
s += as(owner) + `select publication_number, is_active, invalidation_reason from public.get_hockey_canonical_publication_history(:'game_id');\n`
s += check(null, 'reopened game', `(select status <> 'final' and home_team_score is null and opponent_score = 0 from public.games where id = current_setting('flow.game')::uuid)`)
s += check(owner, 'publication 1 invalidated', `(select bool_and(not is_active and invalidation_reason is not null) from public.get_hockey_canonical_publication_history(current_setting('flow.game')::uuid))`)
s += as(scorer) + `do $$ declare accepted boolean := false; begin begin perform public.get_hockey_canonical_publication_history(current_setting('flow.game')::uuid); accepted := true; exception when others then raise notice 'scorer history refused: %', sqlerrm; end; if accepted then raise exception 'scorer read history'; end if; end $$;\n`
s += `\\echo '== refinalize after reopen (same checkpoint) -> publication 2'\n` + as(owner) + `select public.finalize_hockey_event_game(:'game_id', '${scorer}', ${j(revisions)}, 'fp-1', :'snap_snapshot'::jsonb) ->> 'publication_number' as published;\n`
s += `reset role; select status, home_team_score, opponent_score from public.games where id = :'game_id';\n`
s += `select event_type, metadata->>'publication_number' as n from public.access_audit_events where game_id = :'game_id' order by created_at, event_type;\n`
s += check(null, 'final 1-0 again', `(select status = 'final' and home_team_score = 1 and opponent_score = 0 from public.games where id = current_setting('flow.game')::uuid)`)
s += check(owner, 'publication 2', `(select publication_number = 2 from public.get_hockey_canonical_publication(current_setting('flow.game')::uuid))`)
s += `reset role; do $$ begin if (select string_agg(event_type || ':' || coalesce(metadata->>'publication_number', ''), ',' order by created_at, event_type) from public.access_audit_events where game_id = current_setting('flow.game')::uuid) <> 'hockey_game_finalized:1,hockey_game_reopened:1,hockey_game_finalized:2' then raise exception 'check failed: audit rows'; end if; end $$;\n`
s += `\\echo '== outsider and other sports'\n` + as(outsider) + `do $$ declare accepted boolean := false; begin begin perform * from public.get_hockey_finalization_readiness(current_setting('flow.game')::uuid); accepted := true; exception when others then raise notice 'outsider readiness refused: %', sqlerrm; end; if accepted then raise exception 'outsider read'; end if; end $$;\n`
s += as(outsider) + `do $$ declare accepted boolean := false; begin begin perform public.bind_event_game_v5('baseball', null, 'b-1', null, null, 'A', 'B', null, current_date, '[]', '{"version":1}', false); accepted := true; exception when others then raise notice 'baseball bind refused: %', sqlerrm; end; if accepted then raise exception 'baseball bound'; end if; end $$;\n`
s += as(outsider) + `do $$ declare accepted boolean := false; begin begin perform public.bind_hockey_event_game_v5(null, 'h-2', null, null, 'A', 'B', null, current_date, '[]', '{"version":2}', false); accepted := true; exception when others then raise notice 'hockey setup v2 refused: %', sqlerrm; end; if accepted then raise exception 'hockey v2 bound'; end if; end $$;\n`
s += as(outsider) + `select (public.bind_hockey_event_game_v5(null, 'h-personal', null, null, 'A', 'B', null, current_date, '[]', '{"version":1}', false)) ? 'game_id' as personal_hockey_bound;\n`
s += check(outsider, 'personal Hockey bind', `public.bind_hockey_event_game_v5(null, 'h-personal-2', null, null, 'A', 'B', null, current_date, '[]', '{"version":1}', false) ? 'game_id'`)
// The private cores, called directly as the database owner, refuse Baseball by sport.
for (const [label, call] of [
  ['baseball private bind', `public.bind_event_game_v2('baseball', null, 'b-2', null, null, 'A', 'B', null, current_date, '[]', '{"version":1}')`],
  ['baseball private readiness', `public.get_event_finalization_readiness('baseball', current_setting('flow.game')::uuid)`],
]) {
  s += `reset role; select set_config('request.jwt.claim.sub', '${outsider}', false);\n`
  s += `do $$ declare message text; begin begin perform ${call}; exception when others then message := sqlerrm; end; if message is distinct from 'Sport is not supported by the event platform' then raise exception 'check failed: ${label} gave %', message; end if; raise notice '${label} refused: %', message; end $$;\n`
}
s += `reset role;\n`
writeFileSync(`${dir}/flow.sql`, s)
