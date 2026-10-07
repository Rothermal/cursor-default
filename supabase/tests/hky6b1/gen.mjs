// Writes check.sql: Hockey aggregate pages (075) over real bound, uploaded and finalized games,
// read as team roles. Usage: node gen.mjs <work dir holding cases.json from the HKY-5A cases>
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
const dir = process.argv[2]
const cases = JSON.parse(readFileSync(`${dir}/cases.json`, 'utf8'))
const byName = name => {
  const found = cases.find(x => x.name === name)
  if (!found) throw new Error(`No case ${name}`)
  return found
}
const q = v => v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`
const j = v => v === null || v === undefined ? 'null' : `${q(JSON.stringify(v))}::jsonb`
const [owner, scorer, viewer, outsider, season, team, player] = Array.from({ length: 7 }, () => randomUUID())
const as = id => `reset role; select set_config('request.jwt.claim.sub', '${id}', false); set role authenticated;\n`
// Fails the run unless the condition holds for the given role (null: the database owner).
const check = (id, label, condition) => (id ? as(id) : 'reset role;\n') +
  `do $$ begin if not coalesce((${condition}), false) then raise exception 'check failed: ${label}'; end if; raise notice 'ok: ${label}'; end $$;\n`
const refused = (id, label, call, message) => as(id) +
  `do $$ declare got text; begin begin perform ${call}; exception when others then got := sqlerrm; end; if got is distinct from ${q(message)} then raise exception 'check failed: ${label} gave %', got; end if; raise notice 'refused: ${label}'; end $$;\n`

let s = `\\set ON_ERROR_STOP 1\n\\pset footer off\n`
s += `insert into auth.users (id, email) values ('${owner}','o@x.test'),('${scorer}','s@x.test'),('${viewer}','v@x.test'),('${outsider}','x@x.test');\n`
s += `insert into public.seasons (id, owner_id, name, sport) values ('${season}', '${owner}', 'S', 'hockey');\n`
s += `insert into public.teams (id, owner_id, name, season_id) values ('${team}', '${owner}', 'Blades', '${season}');\n`
s += `insert into public.team_members (team_id, user_id, role, accepted_at) values ('${team}','${scorer}','scorer',now()),('${team}','${viewer}','viewer',now()) on conflict do nothing;\n`
s += `insert into public.players (id, first_name, created_by) values ('${player}', 'Pat', '${owner}');\n`
s += `insert into public.team_players (team_id, player_id) values ('${team}', '${player}');\n`

// Each game: bind as the scorer (team) or as its personal creator, upload, checkpoint, finalize.
const games = []
function game(key, caseName, { personal = false } = {}) {
  const c = byName(caseName)
  const recorder = scorer
  const events = c.events.map(e => ({ ...e, recorderUserId: recorder }))
  const participants = c.setup.participants.map(p => ({
    client_participant_id: p.id,
    client_player_id: p.playerId,
    source_player_id: !personal && p.id === 'p2' ? player : null,
    kind: 'player',
    display_name: p.displayName,
    jersey_number: p.number,
    snapshot: {},
  }))
  const teamArgs = personal ? `null, null` : `'${team}', '${season}'`
  s += `\\echo '== ${key}: ${caseName}'\n` + as(recorder)
  s += `select (public.bind_hockey_event_game_v5(null, ${q('local-' + key)}, ${teamArgs}, 'Blades', 'Rivals', null, '2026-10-0${games.length + 1}', ${j(participants)}, ${j(c.setup)}, false))->>'game_id' as game_id \\gset\n`
  s += `select set_config('t.${key}', :'game_id', false);\n`
  if (personal) s += `reset role; update public.game_participants set source_player_id = '${player}' where game_id = :'game_id' and client_participant_id = 'p2';\n`
  s += `reset role; create temporary table if not exists _ev (doc jsonb); grant all on _ev to authenticated; truncate _ev; insert into _ev select value from jsonb_array_elements(${j(events)});\n`
  s += as(recorder) + `do $$ declare e jsonb; r text; g uuid := current_setting('t.${key}')::uuid; acts jsonb; begin
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
  const revisions = events.map(e => ({ id: e.id, revision: e.revision }))
  const maxSeq = Math.max(...events.map(e => e.sequence))
  s += `select public.confirm_game_event_stream_checkpoint(:'game_id', 1, ${j(revisions)}, ${events.length}, ${maxSeq}, 'fp-${key}') is not null as checkpoint_ok;\n`
  const snapshot = { canonicalSchemaVersion: 1, version: 2, sportId: 'hockey', gameId: '__GAME__', primaryRecorderId: recorder, eventStream: { version: 1, events }, sportGameState: { sportId: 'hockey', setup: c.setup } }
  s += `select replace(${q(JSON.stringify(snapshot))}, '__GAME__', :'game_id')::jsonb as snapshot \\gset snap_\n`
  s += as(personal ? recorder : owner) + `select public.finalize_hockey_event_game(:'game_id', '${recorder}', ${j(revisions)}, 'fp-${key}', :'snap_snapshot'::jsonb) ->> 'publication_number' as published;\n`
  games.push(key)
}
game('completed', 'shootout early clinch')
game('reopened_ended', 'reopened and ended again')
game('early', 'ended early with a reason')
game('abandoned', 'abandoned in the second period')
game('personal', 'youth tie accepted', { personal: true })

const ids = page => `(select coalesce(array_agg(item->'game'->>'id' order by ord), '{}') from jsonb_array_elements(${page}->'items') with ordinality x(item, ord))`
const gid = key => `current_setting('t.${key}')`
const set = (...keys) => `array[${keys.map(gid).join(', ')}]::text[]`
const scope = (type, id, extra = '') => `public.get_hockey_scope_aggregate_publications('${type}', '${id}'${extra})`
const playerPage = (extra = '') => `public.get_hockey_player_aggregate_publications('${player}'${extra})`
const sameSet = (page, ...keys) => `(select array(select unnest(${ids(page)}) order by 1)) = (select array(select unnest(${set(...keys)}) order by 1))`

s += `\\echo '== completion predicate'\n`
s += check(null, 'all five published', `(select count(*) = 5 from public.game_event_canonical_publications where sport_id = 'hockey' and invalidated_at is null)`)
s += check(null, 'completed and reopened-then-ended count', `(select bool_and(public._hockey_canonical_snapshot_completed(canonical_snapshot) = (game_id::text = any(${set('completed', 'reopened_ended', 'personal')}))) from public.game_event_canonical_publications where sport_id = 'hockey')`)

s += `\\echo '== scope pages'\n`
for (const who of [viewer, scorer, owner]) {
  s += check(who, 'team scope: completed team games only', sameSet(scope('team', team), 'completed', 'reopened_ended'))
  s += check(who, 'season scope: completed team games only', sameSet(scope('season', season), 'completed', 'reopened_ended'))
}
s += check(viewer, 'viewer cannot manage', `(select bool_and(not (item->>'canManage')::boolean) from jsonb_array_elements(${scope('team', team)}->'items') item)`)
s += check(owner, 'owner manages', `(select bool_and((item->>'canManage')::boolean) from jsonb_array_elements(${scope('team', team)}->'items') item)`)
s += check(viewer, 'item carries the snapshot and source map', `(select (item->'canonicalSnapshot'->>'sportId') = 'hockey' and (item->'participantSourceMap'->>'p2') = '${player}' from jsonb_array_elements(${scope('team', team)}->'items') item where item->'game'->>'id' = ${gid('completed')})`)
s += check(viewer, 'tournament scope empty', `jsonb_array_length(${scope('tournament', team)}->'items') = 0`)
s += check(outsider, 'outsider sees no team games', `jsonb_array_length(${scope('team', team)}->'items') = 0`)

s += `\\echo '== keyset paging'\n`
s += as(viewer) + `select set_config('t.first_page', ${scope('team', team, ', null, null, 1')}::text, false);\n`
const first = `current_setting('t.first_page')::jsonb`
s += check(viewer, 'page 1 has one item and a cursor', `jsonb_array_length(${first}->'items') = 1 and jsonb_typeof(${first}->'nextCursor') = 'object'`)
s += as(viewer) + `select set_config('t.second_page', ${scope('team', team, `, (${first}#>>'{nextCursor,finalizedAt}')::timestamptz, (${first}#>>'{nextCursor,publicationId}')::uuid, 1`)}::text, false);\n`
const second = `current_setting('t.second_page')::jsonb`
s += check(viewer, 'page 2 is the other game and ends', `jsonb_array_length(${second}->'items') = 1 and ${second}->'nextCursor' = 'null'::jsonb and (${second}#>>'{items,0,game,id}') <> (${first}#>>'{items,0,game,id}')`)

s += `\\echo '== player pages'\n`
s += check(scorer, 'player: team games plus the personal game', sameSet(playerPage(), 'completed', 'reopened_ended', 'personal'))
s += check(scorer, 'player filtered to the team', sameSet(playerPage(`, '${team}'`), 'completed', 'reopened_ended'))
s += check(viewer, 'viewer cannot read the personal game', sameSet(playerPage(), 'completed', 'reopened_ended'))
s += check(outsider, 'outsider reads nothing', `jsonb_array_length(${playerPage()}->'items') = 0`)

s += `\\echo '== reopen drops a game'\n`
s += as(owner) + `select public.reopen_hockey_event_game(current_setting('t.completed')::uuid, 'Wrong score') ? 'reopened_at' as reopened;\n`
s += check(viewer, 'reopened game leaves the team page', sameSet(scope('team', team), 'reopened_ended'))

s += `\\echo '== refusals'\n`
s += refused(viewer, 'private core not callable', `public._event_aggregate_publication_page('hockey', 'team', '${team}', '${player}')`, 'permission denied for function _event_aggregate_publication_page')
s += refused(viewer, 'bad scope type', scope('player', team), 'Aggregate scope type is invalid')
s += refused(viewer, 'page size', scope('team', team, ', null, null, 51'), 'Aggregate page size must be between 1 and 50')
s += refused(viewer, 'half cursor', scope('team', team, ', now(), null'), 'Aggregate cursor must include both finalized_at and publication_id')
s += `reset role; select set_config('request.jwt.claim.sub', '${outsider}', false);\n`
s += `do $$ declare got text; begin begin perform public._event_aggregate_publication_page('baseball', 'team', '${team}'); exception when others then got := sqlerrm; end; if got is distinct from 'Aggregate sport is invalid' then raise exception 'check failed: baseball page gave %', got; end if; raise notice 'refused: baseball page'; end $$;\n`

s += `\\echo '== other sports unchanged'\n`
s += check(viewer, 'basketball page still answers', `jsonb_array_length(public.get_basketball_scope_aggregate_publications('team', '${team}')->'items') = 0`)
s += check(viewer, 'soccer page still answers', `jsonb_array_length(public.get_soccer_scope_aggregate_publications('team', '${team}')->'items') = 0`)

s += `\\echo '== capability handshakes'\n`
s += check(scorer, 'aggregate contract 1', `public.get_hockey_aggregate_capabilities() = '{"contractVersion":1,"sportId":"hockey","aggregateContractVersion":1,"migration":75}'::jsonb`)
s += check(scorer, 'release contract unchanged', `(public.get_hockey_release_capabilities()->>'contractVersion') = '2' and (public.get_hockey_release_capabilities()->>'migration') = '74'`)
s += `reset role; begin; drop function public.get_hockey_player_aggregate_publications(uuid, uuid, uuid, timestamptz, uuid, integer);\n`
s += `select set_config('request.jwt.claim.sub', '${scorer}', true); set local role authenticated;\n`
s += `do $$ begin if public.get_hockey_aggregate_capabilities() <> '{"contractVersion":0}'::jsonb then raise exception 'check failed: missing wrapper'; end if; if (public.get_hockey_release_capabilities()->>'contractVersion') <> '2' then raise exception 'check failed: release contract without wrapper'; end if; raise notice 'ok: missing wrapper reads contract 0, release contract still 2'; end $$;\n`
s += `rollback;\n`
s += `reset role; update public.account_access set status = 'suspended' where user_id = '${outsider}';\n`
s += refused(outsider, 'suspended account', `public.get_hockey_aggregate_capabilities()`, 'APP_ACCESS_UNAVAILABLE')
s += refused(outsider, 'suspended page', scope('team', team), 'APP_ACCESS_UNAVAILABLE')
s += `reset role; select set_config('request.jwt.claim.sub', '', false); set role authenticated;\n`
s += `do $$ declare got text; begin begin perform public.get_hockey_aggregate_capabilities(); exception when others then got := sqlerrm; end; if got is distinct from 'Authentication required' then raise exception 'check failed: anonymous gave %', got; end if; raise notice 'refused: anonymous handshake'; end $$;\n`
s += `reset role;\n`
writeFileSync(`${dir}/check.sql`, s)
