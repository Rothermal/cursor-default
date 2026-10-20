// Real BSB-6 command fixtures -> SQL bind/upload/checkpoint calls, with fresh identities per game.
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const q = value => value === null || value === undefined ? 'null' : `'${String(value).replaceAll("'", "''")}'`
export const j = value => `${q(JSON.stringify(value))}::jsonb`
export const as = user => `reset role; select set_config('request.jwt.claim.sub', ${q(user ?? '')}, false); set role authenticated;`
export const ids = () => randomUUID()

export function fixture(cases, name, owner, { team = null, season = null, sources = [], outcome = null } = {}) {
  const source = cases.find(item => item.name === 'walk-off double in the bottom of the seventh')
  if (!source) throw new Error('The real-command walk-off fixture is missing')
  const setup = structuredClone(source.setup)
  setup.sourceTeamId = team
  setup.sourceSeasonId = season
  const remap = new Map(source.events.map(event => [event.id, ids()]))
  const rewrite = value => {
    if (typeof value === 'string') return remap.get(value) ?? value
    if (Array.isArray(value)) return value.map(rewrite)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)]))
    return value
  }
  const events = source.events.map(event => ({ ...rewrite(event), recorderUserId: owner }))
  if (outcome) events.filter(event => event.eventType === 'baseball.game_ended').at(-1).payload.outcome = outcome
  const participants = setup.participants.map((participant, index) => ({
    client_participant_id: participant.id, client_player_id: participant.playerId,
    source_player_id: sources[index] ?? null, kind: participant.playerId ? 'player' : 'anonymous',
    display_name: participant.displayName, jersey_number: participant.number, snapshot: {},
  }))
  const revisions = events.map(event => ({ id: event.id, revision: event.revision }))
  const fingerprint = `fixture-${ids()}`
  const local = `bsb7a-${ids()}`
  const snapshot = { canonicalSchemaVersion: 1, version: 2, sportId: 'baseball', gameId: null,
    primaryRecorderId: owner, eventStream: { version: 1, events }, sportGameState: { sportId: 'baseball', setup } }
  const sql = `${as(owner)}
insert into bsb7a_test.fixtures(name, game_id, snapshot, revisions, fingerprint, owner_id)
select ${q(name)}, binding.game_id,
  jsonb_set(${j(snapshot)}, '{gameId}', to_jsonb(binding.game_id::text)), ${j(revisions)}, ${q(fingerprint)}, ${q(owner)}::uuid
from (select (public.bind_baseball_event_game_v5(null, ${q(local)}, ${q(team)}::uuid, ${q(season)}::uuid,
  'Aces', 'Visitors', null, '2026-10-15', ${j(participants)}, ${j(setup)}, false)->>'game_id')::uuid as game_id) binding;
do $$
declare f bsb7a_test.fixtures%rowtype; e jsonb; acts jsonb; result text;
begin
  select * into f from bsb7a_test.fixtures where name = ${q(name)};
  for e in select value from jsonb_array_elements(f.snapshot#>'{eventStream,events}') order by (value->>'sequence')::bigint loop
    select coalesce(jsonb_agg(case when actor.value->>'kind' = 'player'
      then jsonb_set(actor.value, '{playerId}', to_jsonb(participant.id::text)) else actor.value end order by actor.ordinality), '[]'::jsonb)
    into acts from jsonb_array_elements(e->'actors') with ordinality actor(value, ordinality)
    left join public.game_participants participant on participant.game_id = f.game_id and participant.client_player_id = actor.value->>'playerId';
    result := public.upsert_game_event_revisioned((e->>'id')::uuid, f.game_id, 'baseball', e->>'eventType',
      (e->>'schemaVersion')::integer, (e->>'sequence')::bigint, (e->>'revision')::integer,
      e#>>'{period,id}', (e#>>'{period,order}')::integer, nullif(e->>'elapsedMs','')::bigint,
      (e->>'occurredAt')::timestamptz, e->>'teamSide', nullif(e->'location','null'::jsonb), acts, e->'payload',
      (e->>'createdAt')::timestamptz, (e->>'updatedAt')::timestamptz, nullif(e->>'deletedAt','')::timestamptz);
    if result <> 'applied' then raise exception 'Fixture upload failed: %', result; end if;
  end loop;
  perform public.confirm_game_event_stream_checkpoint(f.game_id, 1, f.revisions,
    jsonb_array_length(f.revisions), (select max((value->>'sequence')::bigint)
      from jsonb_array_elements(f.snapshot#>'{eventStream,events}')), f.fingerprint);
end $$;
reset role;
`
  return { name, owner, setup, events, sql }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [casesPath, outputPath] = process.argv.slice(2)
  if (!casesPath || !outputPath) throw new Error('Usage: node gen.mjs <BSB6A cases.json> <fixtures.sql>')
  const owner = ids()
  const cases = JSON.parse(readFileSync(casesPath, 'utf8'))
  writeFileSync(outputPath, fixture(cases, 'personal', owner).sql)
  console.log(`Generated SQL for owner ${owner}; run through run.mjs for bootstrap and assertions`)
}
