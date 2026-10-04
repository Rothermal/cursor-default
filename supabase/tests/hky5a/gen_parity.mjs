// Writes parity.sql: loads each case as one personal cloud game and compares the server policy
// with the client's final score. Usage: node gen_parity.mjs <work dir holding cases.json>
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
const dir = process.argv[2]
const cases = JSON.parse(readFileSync(`${dir}/cases.json`, 'utf8'))
const q = v => v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`
const j = v => v === null || v === undefined ? 'null' : `${q(JSON.stringify(v))}::jsonb`
let sql = `\\set ON_ERROR_STOP 1\ncreate temporary table parity (name text, status text, expected_tracked int, expected_opponent int, refuse boolean, ended boolean, tracked int, opponent int, error text);\n`
const user = randomUUID()
sql += `insert into auth.users (id, email) values ('${user}', 'parity@example.test');\n`
sql += `update public.profiles set display_name = 'Parity' where id = '${user}';\n`
for (const c of cases) {
  const game = randomUUID()
  sql += `insert into public.games (id, opponent_name, created_by, cloud_scope, sport_id, tracked_team_name, status, client_local_game_id) values ('${game}', 'Rivals', '${user}', 'personal', 'hockey', 'Blades', 'in_progress', '${randomUUID()}');\n`
  sql += `insert into public.game_event_setup_snapshots (game_id, sport_id, setup_snapshot, updated_by) values ('${game}', 'hockey', ${j(c.setup)}, '${user}');\n`
  for (const e of c.events) {
    sql += `insert into public.game_events (id, game_id, recorded_by, sport_id, event_type, schema_version, stream_sequence, revision, period_id, period_order, elapsed_ms, occurred_at, team_side, location, actors, payload, event_created_at, event_updated_at, deleted_at) values (${q(e.id)}, '${game}', '${user}', ${q(e.sportId)}, ${q(e.eventType)}, ${e.schemaVersion}, ${e.sequence}, ${e.revision}, ${q(e.period.id)}, ${e.period.order}, ${e.elapsedMs ?? 'null'}, ${q(e.occurredAt)}, ${q(e.teamSide)}, ${j(e.location)}, ${j(e.actors)}, ${j(e.payload)}, ${q(e.createdAt)}, ${q(e.updatedAt)}, ${q(e.deletedAt)});\n`
  }
  sql += `do $$ declare t int; o int; begin
  begin
    select tracked_score, opponent_score into t, o from public.validate_hockey_finalization_policy('${game}', '${user}');
    insert into parity values (${q(c.name)}, ${q(c.status)}, ${c.expected.tracked}, ${c.expected.opponent}, ${c.refuse}, public.is_hockey_primary_stream_ended('${game}', '${user}'), t, o, null);
  exception when others then
    insert into parity values (${q(c.name)}, ${q(c.status)}, ${c.expected.tracked}, ${c.expected.opponent}, ${c.refuse}, public.is_hockey_primary_stream_ended('${game}', '${user}'), null, null, sqlerrm);
  end;
end $$;\n`
}
sql += `select name, status, refuse, ended, expected_tracked || '-' || expected_opponent as client, coalesce(tracked || '-' || opponent, '-') as server, coalesce(error, '') as error,
  case when refuse then (error is not null and not ended) else (error is null and ended and tracked = expected_tracked and opponent = expected_opponent) end as pass
from parity;\n`
sql += `do $$ begin if exists (select 1 from parity where case when refuse then (error is null or ended) else (error is not null or not ended or tracked is distinct from expected_tracked or opponent is distinct from expected_opponent) end) then raise exception 'parity failed'; end if; end $$;\n`
writeFileSync(`${dir}/parity.sql`, sql)
