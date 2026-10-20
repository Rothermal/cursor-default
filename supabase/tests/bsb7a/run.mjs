// Disposable, real multi-connection PostgreSQL integration checks. No Supabase connection.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fixture, q, j, as, ids } from './gen.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const env = process.env
const config = env.DATABASE_URL ? Object.fromEntries((url => [
  ['host', url.hostname], ['port', Number(url.port || 5432)], ['user', decodeURIComponent(url.username)],
  ['password', decodeURIComponent(url.password)], ['database', url.pathname.slice(1) || 'postgres'],
])(new URL(env.DATABASE_URL))) : {
  host: env.PGHOST || '127.0.0.1', port: Number(env.PGPORT || 55437),
  user: env.PGUSER || 'postgres', password: env.PGPASSWORD, database: env.PGDATABASE || 'postgres',
}
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(config.host)) throw new Error('Refusing non-loopback PostgreSQL')
const { default: pg } = await import(pathToFileURL(resolve(env.PG_MODULE || `${repo}/qa.local/sql-probe/node_modules/pg/lib/index.js`)).href)
const cases = JSON.parse(readFileSync(env.BSB7A_CASES || `${repo}/qa.local/bsb7a-cases.json`, 'utf8'))
const name = `bsb7a_${ids().replaceAll('-', '').slice(0, 16)}`
const output = resolve(env.BSB7A_OUT || `${repo}/qa.local/${name}`)
mkdirSync(output, { recursive: true })
const sqlLog = resolve(output, 'fixtures.sql')
writeFileSync(sqlLog, '-- Generated real-command fixture SQL for this disposable run.\n')
const connections = []
let admin
let checks = 0
let refusals = 0
let races = 0
const root = new pg.Client(config)
await root.connect()
const connection = async user => {
  const client = new pg.Client({ ...config, database: name })
  await client.connect()
  connections.push(client)
  await client.query("set statement_timeout = '15s'; set lock_timeout = '10s'")
  if (user !== undefined) await client.query(as(user))
  return client
}
const check = async (label, body) => { await body(); checks++; console.log(`ok ${checks}: ${label}`) }
const refuse = async (body, expected) => {
  await assert.rejects(body, error => {
    if (expected) assert.match(error.message, expected)
    return true
  })
  refusals++
}
const rpc = async (client, fn, args = []) => (await client.query(
  `select public.${fn}(${args.map((_, index) => `$${index + 1}`).join(',')}) as result`, args.map(value => Array.isArray(value) ? JSON.stringify(value) : value)
)).rows[0].result
const queryAs = async (user, sql, args = []) => {
  const client = await connection(user)
  try { return await client.query(sql, args) } finally { await client.end(); connections.splice(connections.indexOf(client), 1) }
}
const callAs = async (user, fn, args = []) => (await queryAs(user,
  `select public.${fn}(${args.map((_, index) => `$${index + 1}`).join(',')}) as result`, args.map(value => Array.isArray(value) ? JSON.stringify(value) : value))).rows[0].result
const map = game => callAs(game.owner_id, 'get_baseball_personal_participant_links', [game.game_id])
const linkArgs = (game, review, participant, target, operation = ids(), reason = 'Reviewed player identity') =>
  [game.game_id, participant, target, review.mapFingerprint, review.activePublicationId, reason, operation]
const finalArgs = game => [game.game_id, game.owner_id, game.revisions, game.fingerprint, game.snapshot]
const finalize = (game, reviewed = null, client = null) => client
  ? rpc(client, reviewed === null ? 'finalize_baseball_event_game' : 'finalize_baseball_event_game_reviewed',
    [...finalArgs(game), ...(reviewed === null ? [] : [reviewed])])
  : callAs(game.owner_id, reviewed === null ? 'finalize_baseball_event_game' : 'finalize_baseball_event_game_reviewed',
    [...finalArgs(game), ...(reviewed === null ? [] : [reviewed])])
const merge = async (duplicate, survivor, client = null) => {
  // Existing merge authorization requires both players on teams the caller manages.
  // Personal links deliberately do NOT change that established permission contract.
  await admin.query('insert into public.team_players(team_id,player_id) values($1,$2),($1,$3) on conflict do nothing', [team, duplicate, survivor])
  const resolutions = { game_stats: [], stat_corrections: [],
    team_players: [{ team_id: team, is_active: true, jersey_number: null, position: null }] }
  return client ? rpc(client, 'merge_players_execute', [duplicate, survivor, resolutions])
    : callAs(owner, 'merge_players_execute', [duplicate, survivor, resolutions])
}
const player = async (creator = owner, placeholder = false) => {
  const id = ids()
  await admin.query('insert into public.players(id,first_name,last_name,created_by,is_team_placeholder) values ($1,$2,$3,$4,$5)',
    [id, 'Test', 'Player', creator, placeholder])
  return id
}
const game = async (label, creator = owner, options = {}) => {
  const generated = fixture(cases, label, creator, options)
  appendFileSync(sqlLog, generated.sql)
  await admin.query(generated.sql)
  return (await admin.query('select * from bsb7a_test.fixtures where name=$1', [label])).rows[0]
}
const participant = (game, index = 0) => game.snapshot.sportGameState.setup.participants[index].id
const state = async game => (await admin.query(`select g.status, g.home_team_score, g.opponent_score,
  (select count(*)::int from public.game_event_canonical_publications p where p.game_id=g.id and p.invalidated_at is null) active,
  (select count(*)::int from public.baseball_personal_link_receipts r where r.game_id=g.id) receipts,
  (select count(*)::int from public.access_audit_events a where a.game_id=g.id) audits,
  (select count(*)::int from public.game_event_primary_recorders r where r.game_id=g.id and r.locked_at is not null) locks
  from public.games g where g.id=$1`, [game.game_id])).rows[0]
const pin = async publication => (await admin.query('select * from public.baseball_personal_publication_pins where publication_id=$1', [publication])).rows[0]
const page = (user, target, team = null, cursor = null, limit = 20) => callAs(user, 'get_baseball_player_aggregate_publications',
  [target, team, null, cursor?.finalizedAt ?? null, cursor?.publicationId ?? null, limit])
const pending = promise => promise.then(value => ({ value }), error => ({ error }))
const blocked = async (waiter, blocker) => {
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    const { rows } = await admin.query('select $1::int = any(pg_blocking_pids($2::int)) as blocked', [blocker.processID, waiter.processID])
    if (rows[0].blocked) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Expected real PostgreSQL blocking was not observed')
}
const settleRefused = async (promise, pattern) => {
  const result = await promise
  assert.ok(result.error, 'Expected a refused racing command')
  assert.match(result.error.message, pattern)
  refusals++
}
const close = async (...clients) => {
  for (const client of clients) {
    await client.query('rollback')
    await client.end()
    connections.splice(connections.indexOf(client), 1)
  }
}
const [owner, guardian, foreign, viewer, scorer, suspended, season, team] = Array.from({ length: 8 }, ids)
const results = { database: name, server: null, checks: 0, refusals: 0, concurrency: 0, passed: false }

try {
  await root.query(`create database "${name}" template "${env.BSB7A_BUILD_BASE === '1' ? 'template0' : (env.BSB7A_TEMPLATE || 'bsb7a_base').replaceAll('"', '""')}"`)
  admin = await connection()
  results.server = (await admin.query('show server_version')).rows[0].server_version
  if (env.BSB7A_BUILD_BASE === '1') {
    await admin.query(readFileSync(`${repo}/supabase/tests/bsb6a/bootstrap.sql`, 'utf8'))
    for (const file of readdirSync(`${repo}/supabase/migrations`).filter(file => /^\d{3}_.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= 78).sort()) {
      await admin.query(readFileSync(`${repo}/supabase/migrations/${file}`, 'utf8'))
    }
  }
  assert.equal((await admin.query("select to_regclass('public.baseball_personal_publication_pins') as existing")).rows[0].existing, null,
    'Template must contain exactly the pre-079 schema')
  await admin.query(`create schema bsb7a_test; create table bsb7a_test.fixtures(
    name text primary key, game_id uuid, snapshot jsonb, revisions jsonb, fingerprint text, owner_id uuid);
    grant usage on schema bsb7a_test to authenticated; grant select, insert on bsb7a_test.fixtures to authenticated;`)
  for (const [index, user] of [owner, guardian, foreign, viewer, scorer, suspended].entries()) {
    await admin.query('insert into auth.users(id,email) values ($1,$2)', [user, `bsb7a-${index}@example.test`])
  }
  await admin.query("update public.account_access set status='suspended' where user_id=$1", [suspended])
  await admin.query("insert into public.seasons(id,owner_id,name,sport) values ($1,$2,'Season','baseball')", [season, owner])
  await admin.query("insert into public.teams(id,owner_id,name,season_id) values ($1,$2,'Aces',$3)", [team, owner, season])
  await admin.query("insert into public.team_members(team_id,user_id,role,accepted_at) values ($1,$2,'viewer',now()),($1,$3,'scorer',now())", [team, viewer, scorer])
  const oldFunctions = (await admin.query(`select proname, pg_get_functiondef(oid) as definition from pg_proc
    where pronamespace='public'::regnamespace and (proname like '%baseball%' or proname='merge_players_execute'
      or proname in ('get_soccer_scope_aggregate_publications','get_basketball_scope_aggregate_publications','get_hockey_scope_aggregate_publications'))`)).rows
  const oldRelease = await callAs(owner, 'get_baseball_release_capabilities')
  const historical = await game('historic-null')
  const historicalPub1 = await finalize(historical)
  await callAs(owner, 'reopen_baseball_event_game', [historical.game_id, 'Historical review'])
  const historicalPub2 = await finalize(historical)
  const unexpected = await game('historic-unexpected')
  const unexpectedTarget = await player()
  await admin.query('update public.game_participants set source_player_id=$1 where game_id=$2 and client_participant_id=$3',
    [unexpectedTarget, unexpected.game_id, participant(unexpected)])
  const unexpectedPub = await finalize(unexpected)
  await admin.query(readFileSync(`${repo}/supabase/migrations/079_baseball_aggregate_identity_foundation.sql`, 'utf8'))

  await check('079 applies to actual 001-078; old functions, renamed merge body and contract 2 stay exact', async () => {
    for (const old of oldFunctions) {
      const currentName = old.proname === 'merge_players_execute' ? '_merge_players_execute_before_baseball_identity' : old.proname
      const current = (await admin.query('select pg_get_functiondef(oid) definition from pg_proc where pronamespace=\'public\'::regnamespace and proname=$1', [currentName])).rows[0]
      assert.equal(current.definition.replaceAll(currentName, old.proname), old.definition)
    }
    assert.deepEqual(await callAs(owner, 'get_baseball_release_capabilities'), oldRelease)
    assert.equal(oldRelease.contractVersion, 2)
    assert.equal(oldRelease.migration, 78)
  })
  await check('historical active and invalidated publications bootstrap frozen complete null maps; unexpected source gets no pin', async () => {
    for (const publication of [historicalPub1, historicalPub2]) {
      const pinned = await pin(publication.publication_id)
      assert.equal(pinned.schema_version, 1)
      assert.deepEqual(Object.keys(pinned.participant_source_map).sort(), historical.snapshot.sportGameState.setup.participants.map(p => p.id).sort())
      assert.ok(Object.values(pinned.participant_source_map).every(value => value === null))
    }
    assert.equal(await pin(unexpectedPub.publication_id), undefined)
    const item = (await page(owner, unexpectedTarget)).items.find(item => item.publicationId === unexpectedPub.publication_id)
    assert.equal(item.identityStatus, 'invalid')
    assert.equal(item.identityDiagnostic, 'missing_pin')
    assert.equal(item.participantSourceMap, null)
  })

  const fresh = await game('links')
  const target = await player()
  const target2 = await player()
  const unauthorized = await player(foreign)
  const placeholder = await player(owner, true)
  const initial = await map(fresh)
  const operation = ids()
  const request = linkArgs(fresh, initial, participant(fresh), target, operation)
  let firstLink
  await check('creator link is CAS-checked, explicit, null-preserving and atomically receipted', async () => {
    const before = fresh.snapshot
    firstLink = await callAs(owner, 'link_baseball_personal_participant', request)
    assert.equal(firstLink.participantSourceMap[participant(fresh)], target)
    assert.equal(firstLink.reopen, null)
    assert.equal(Object.values(firstLink.participantSourceMap).filter(value => value === null).length, Object.keys(initial.participantSourceMap).length - 1)
    assert.equal((await state(fresh)).receipts, 1)
    const setup = (await admin.query('select setup_snapshot from public.game_event_setup_snapshots where game_id=$1', [fresh.game_id])).rows[0].setup_snapshot
    assert.deepEqual(setup, before.sportGameState.setup)
  })
  await check('same operation retries exactly; operation-id payload reuse, stale CAS, replacement and duplicate target refuse', async () => {
    assert.deepEqual(await callAs(owner, 'link_baseball_personal_participant', request), firstLink)
    await refuse(() => callAs(owner, 'link_baseball_personal_participant', request.map((value, index) => index === 2 ? target2 : value)), /operation id was reused/)
    await refuse(() => callAs(owner, 'link_baseball_personal_participant', linkArgs(fresh, initial, participant(fresh, 1), target2)), /map changed/)
    const current = await map(fresh)
    await refuse(() => callAs(owner, 'link_baseball_personal_participant', linkArgs(fresh, current, participant(fresh), target2)), /Replacing/)
    await refuse(() => callAs(owner, 'link_baseball_personal_participant', linkArgs(fresh, current, participant(fresh, 1), target)), /already linked/)
    assert.equal((await state(fresh)).receipts, 1)
  })
  await check('foreign creator, team admin/viewer/scorer, opponent/nonsetup, placeholder and unauthorized target cannot link', async () => {
    for (const user of [foreign, viewer, scorer]) await refuse(() => callAs(user, 'link_baseball_personal_participant', request), /creator access/)
    const current = await map(fresh)
    for (const invalid of [unauthorized, placeholder]) await refuse(() => callAs(owner, 'link_baseball_personal_participant', linkArgs(fresh, current, participant(fresh, 1), invalid)), /Authorized personal player/)
    await refuse(() => callAs(owner, 'link_baseball_personal_participant', linkArgs(fresh, current, 'opponent-1', target2)), /Tracked Baseball participant/)
    await refuse(() => callAs(foreign, 'get_baseball_personal_participant_links', [fresh.game_id]), /creator access/)
    // Team ownership grants no personal player authority, even on a visible roster.
    await admin.query('insert into public.team_players(team_id,player_id) values($1,$2)', [team, unauthorized])
    await refuse(() => callAs(owner, 'link_baseball_personal_participant', linkArgs(fresh, current, participant(fresh, 1), unauthorized)), /Authorized personal player/)
  })
  const guardedTarget = await player(foreign)
  const guardianGame = await game('guardian-game', guardian)
  await admin.query("insert into public.player_guardians(player_id,user_id,relationship) values($1,$2,'parent')", [guardedTarget, guardian])
  const guardianRequest = linkArgs(guardianGame, await map(guardianGame), participant(guardianGame), guardedTarget)
  await check('current guardian authorization works, but cannot read another creator game; retry rechecks revocation', async () => {
    await callAs(guardian, 'link_baseball_personal_participant', guardianRequest)
    assert.equal((await page(guardian, target)).items.length, 0)
    await refuse(() => callAs(guardian, 'get_baseball_personal_participant_links', [fresh.game_id]), /creator access/)
    await admin.query('delete from public.player_guardians where player_id=$1 and user_id=$2', [guardedTarget, guardian])
    await refuse(() => callAs(guardian, 'link_baseball_personal_participant', guardianRequest), /Authorized personal player/)
  })
  for (const previouslyFinal of [false, true]) {
    await check(`${previouslyFinal ? 'final/reopened' : 'unfinalized'} guardian revocation preserves review and both finalizers, not link or aggregate authority`, async () => {
      for (const reviewed of [false, true]) {
        const g = await game(`revoked-${previouslyFinal}-${reviewed}`)
        const revokedTarget = await player(foreign)
        await admin.query('insert into public.team_players(team_id,player_id) values($1,$2)', [team, revokedTarget])
        await callAs(owner, 'claim_player_guardianship', [revokedTarget, team])
        const request = linkArgs(g, await map(g), participant(g), revokedTarget)
        const linked = await callAs(owner, 'link_baseball_personal_participant', request)
        const earlier = previouslyFinal ? await finalize(g, reviewed ? linked.mapFingerprint : null) : null
        const earlierPin = earlier ? await pin(earlier.publication_id) : null
        await callAs(foreign, 'remove_player_guardian', [revokedTarget, owner, null])
        if (previouslyFinal) await callAs(owner, 'reopen_baseball_event_game', [g.game_id, 'Ordinary correction after guardian removal'])
        const review = await map(g)
        assert.deepEqual(review.participantSourceMap, linked.participantSourceMap)
        assert.equal(review.mapFingerprint, linked.mapFingerprint)
        assert.equal(review.activePublicationId, null)
        await refuse(() => callAs(owner, 'link_baseball_personal_participant', request), /Authorized personal player/)
        await refuse(() => callAs(owner, 'link_baseball_personal_participant', linkArgs(g, review, participant(g), revokedTarget)), /Authorized personal player/)
        await refuse(() => callAs(owner, 'link_baseball_personal_participant', linkArgs(g, review, participant(g, 1), revokedTarget)), /Authorized personal player/)
        const publication = await finalize(g, reviewed ? review.mapFingerprint : null)
        const pinned = await pin(publication.publication_id)
        assert.deepEqual(pinned.participant_source_map, linked.participantSourceMap)
        assert.equal(pinned.map_fingerprint, linked.mapFingerprint)
        assert.equal((await state(g)).status, 'final')
        assert.deepEqual(await finalize(g), publication)
        assert.deepEqual(await finalize(g, review.mapFingerprint), publication)
        assert.deepEqual(await pin(publication.publication_id), pinned)
        if (earlier) assert.deepEqual(await pin(earlier.publication_id), earlierPin)
        const invalid = (await page(owner, target)).items.find(item => item.publicationId === publication.publication_id)
        assert.equal(invalid.identityStatus, 'invalid')
        assert.equal(invalid.identityDiagnostic, 'invalid_pin_or_source')
        assert.equal(invalid.participantSourceMap, null)
        assert.equal(invalid.participantMapFingerprint, linked.mapFingerprint)
        assert.ok(!(await page(owner, revokedTarget)).items.some(item => item.game.id === g.game_id))
        await callAs(owner, 'claim_player_guardianship', [revokedTarget, team])
        const valid = (await page(owner, revokedTarget)).items.find(item => item.publicationId === publication.publication_id)
        assert.equal(valid.identityStatus, 'valid')
        assert.equal(valid.participantSourceMap[participant(g)], revokedTarget)
        assert.equal(valid.participantMapFingerprint, linked.mapFingerprint)
        assert.deepEqual(await pin(publication.publication_id), pinned)
        const beforeRetry = await state(g)
        assert.deepEqual(await callAs(owner, 'link_baseball_personal_participant', request), linked)
        assert.deepEqual(await state(g), beforeRetry)
      }
    })
  }
  await check('real merge to an unauthorized survivor preserves raw review/publication while pinned aggregate reads fail closed', async () => {
    const g = await game('legacy-creator-only-merge')
    const duplicate = await player()
    const survivor = await player(foreign)
    // SEC-4 permits removal of the creator's guardian row; creator authority remains.
    await callAs(owner, 'remove_player_guardian', [duplicate, owner, null])
    const linked = await callAs(owner, 'link_baseball_personal_participant', linkArgs(g, await map(g), participant(g), duplicate))
    const original = await finalize(g, linked.mapFingerprint)
    const originalPin = await pin(original.publication_id)
    await merge(duplicate, survivor)
    assert.equal((await admin.query('select count(*)::int count from public.player_guardians where player_id=$1 and user_id=$2', [survivor, owner])).rows[0].count, 0)
    const review = await map(g)
    assert.equal(review.participantSourceMap[participant(g)], survivor)
    await refuse(() => callAs(owner, 'link_baseball_personal_participant', linkArgs(g, review, participant(g), survivor)), /Authorized personal player/)
    const publications = [original]
    for (const reviewed of [false, true]) {
      await callAs(owner, 'reopen_baseball_event_game', [g.game_id, 'Ordinary correction after player merge'])
      const publication = await finalize(g, reviewed ? review.mapFingerprint : null)
      publications.push(publication)
      assert.equal((await pin(publication.publication_id)).participant_source_map[participant(g)], survivor)
      const invalid = (await page(owner, target)).items.find(item => item.publicationId === publication.publication_id)
      assert.equal(invalid.identityStatus, 'invalid')
      assert.equal(invalid.participantSourceMap, null)
      assert.ok(!(await page(owner, survivor)).items.some(item => item.game.id === g.game_id))
    }
    assert.deepEqual(await pin(original.publication_id), originalPin)
    await callAs(owner, 'claim_player_guardianship', [survivor, team])
    for (const publication of publications) {
      const identity = (await admin.query('select public._baseball_personal_publication_identity($1) result', [publication.publication_id])).rows[0].result
      assert.equal(identity.status, 'valid')
      assert.equal(identity.participantSourceMap[participant(g)], survivor)
    }
    assert.deepEqual(await pin(original.publication_id), originalPin)
  })
  await check('active account and authenticated UID are required, including receipt retries', async () => {
    for (const user of [null, suspended]) {
      await refuse(() => callAs(user, 'get_baseball_aggregate_capabilities'), /Authentication required|APP_ACCESS_UNAVAILABLE/)
      await refuse(() => callAs(user, 'get_baseball_personal_link_capabilities'), /Authentication required|APP_ACCESS_UNAVAILABLE/)
      await refuse(() => callAs(user, 'link_baseball_personal_participant', request), /Authentication required|APP_ACCESS_UNAVAILABLE/)
    }
    await admin.query("update public.account_access set status='suspended' where user_id=$1", [owner])
    await refuse(() => callAs(owner, 'link_baseball_personal_participant', request), /APP_ACCESS_UNAVAILABLE/)
    await admin.query("update public.account_access set status='active' where user_id=$1", [owner])
  })
  await check('private tables/helpers/renamed merge core deny direct anon/authenticated access with RLS enabled', async () => {
    for (const table of ['baseball_personal_publication_pins', 'baseball_personal_link_receipts']) {
      assert.equal((await admin.query('select relrowsecurity from pg_class where oid=$1::regclass', [`public.${table}`])).rows[0].relrowsecurity, true)
      await refuse(() => queryAs(owner, `select * from public.${table}`), /permission denied/)
      await refuse(() => queryAs(owner, `delete from public.${table}`), /permission denied/)
    }
    for (const [fn, args] of [['_baseball_personal_raw_map', [fresh.game_id, fresh.snapshot.sportGameState.setup]],
      ['_baseball_personal_publication_identity', [historicalPub2.publication_id]],
      ['_merge_players_execute_before_baseball_identity', [target, target2, {}]]]) {
      await refuse(() => callAs(owner, fn, args), /permission denied/)
    }
    const anon = await connection()
    await anon.query('set role anon')
    await refuse(() => rpc(anon, 'get_baseball_aggregate_capabilities'), /permission denied/)
    await close(anon)
  })
  await check('separate exact capabilities fail closed for disabled/missing hooks and independently missing RPCs', async () => {
    assert.deepEqual(await callAs(owner, 'get_baseball_aggregate_capabilities'),
      { contractVersion: 1, sportId: 'baseball', aggregateContractVersion: 1, migration: 79 })
    assert.deepEqual(await callAs(owner, 'get_baseball_personal_link_capabilities'),
      { contractVersion: 1, sportId: 'baseball', personalLinkContractVersion: 1, publicationIdentityVersion: 1, reviewedFinalizationVersion: 1, migration: 79 })
    await admin.query('alter table public.game_event_canonical_publications disable trigger baseball_personal_pin_publication')
    assert.deepEqual(await callAs(owner, 'get_baseball_aggregate_capabilities'), { contractVersion: 0 })
    assert.deepEqual(await callAs(owner, 'get_baseball_personal_link_capabilities'), { contractVersion: 0 })
    assert.deepEqual(await callAs(owner, 'get_baseball_release_capabilities'), oldRelease)
    await admin.query('alter table public.game_event_canonical_publications enable trigger baseball_personal_pin_publication')
    await admin.query('begin; drop trigger baseball_personal_pin_publication on public.game_event_canonical_publications')
    await admin.query(as(owner))
    assert.deepEqual(await rpc(admin, 'get_baseball_aggregate_capabilities'), { contractVersion: 0 })
    assert.deepEqual(await rpc(admin, 'get_baseball_personal_link_capabilities'), { contractVersion: 0 })
    await admin.query('rollback; reset role')
    await admin.query('begin; alter function public.link_baseball_personal_participant(uuid,text,uuid,text,uuid,text,uuid) rename to link_temporarily_missing')
    await admin.query(as(owner))
    assert.deepEqual(await rpc(admin, 'get_baseball_personal_link_capabilities'), { contractVersion: 0 })
    assert.equal((await rpc(admin, 'get_baseball_aggregate_capabilities')).contractVersion, 1)
    await admin.query('rollback; reset role')
    await admin.query('begin; alter function public.get_baseball_player_aggregate_publications(uuid,uuid,uuid,timestamptz,uuid,integer) rename to page_temporarily_missing')
    await admin.query(as(owner))
    assert.deepEqual(await rpc(admin, 'get_baseball_aggregate_capabilities'), { contractVersion: 0 })
    assert.equal((await rpc(admin, 'get_baseball_personal_link_capabilities')).contractVersion, 1)
    await admin.query('rollback; reset role')
  })

  let publication
  const reviewedMap = await map(fresh)
  await check('old finalizer creates a complete frozen pin and stable retries never re-pin', async () => {
    publication = await finalize(fresh)
    const firstPin = await pin(publication.publication_id)
    assert.deepEqual(firstPin.participant_source_map, reviewedMap.participantSourceMap)
    assert.equal(firstPin.map_fingerprint, reviewedMap.mapFingerprint)
    assert.deepEqual(await finalize(fresh), publication)
    assert.deepEqual(await pin(publication.publication_id), firstPin)
    assert.equal((await page(owner, target)).items.find(item => item.publicationId === publication.publication_id).identityStatus, 'valid')
  })
  const finalReview = await map(fresh)
  const finalLinkRequest = linkArgs(fresh, finalReview, participant(fresh, 1), target2)
  await check('final linking requires exact publication and reason and rolls back injected receipt failure completely', async () => {
    await refuse(() => callAs(owner, 'link_baseball_personal_participant', finalLinkRequest.map((v, i) => i === 4 ? ids() : v)), /publication changed/)
    await refuse(() => callAs(owner, 'link_baseball_personal_participant', finalLinkRequest.map((v, i) => i === 5 ? 'x' : v)), /reopen reason/)
    const before = await state(fresh)
    const oldPin = await pin(publication.publication_id)
    await admin.query(`create function bsb7a_test.fail_receipt() returns trigger language plpgsql as $$ begin
      raise exception 'Injected receipt failure'; end $$;
      create trigger bsb7a_fail_receipt before insert on public.baseball_personal_link_receipts
      for each row execute function bsb7a_test.fail_receipt();`)
    await refuse(() => callAs(owner, 'link_baseball_personal_participant', finalLinkRequest), /Injected receipt failure/)
    await admin.query('drop trigger bsb7a_fail_receipt on public.baseball_personal_link_receipts')
    assert.deepEqual(await state(fresh), before)
    assert.deepEqual(await pin(publication.publication_id), oldPin)
    assert.deepEqual(await map(fresh), finalReview)
    assert.equal((await admin.query('select invalidated_at from public.game_event_canonical_publications where id=$1', [publication.publication_id])).rows[0].invalidated_at, null)
  })
  let finalLink
  await check('successful final Reopen-link is atomic, excludes aggregates until explicit republication and retains old pin', async () => {
    finalLink = await callAs(owner, 'link_baseball_personal_participant', finalLinkRequest)
    assert.equal(finalLink.reopen.publication_id, publication.publication_id)
    assert.equal((await state(fresh)).status, 'in_progress')
    assert.equal((await state(fresh)).active, 0)
    assert.ok(!(await page(owner, target)).items.some(item => item.game.id === fresh.game_id))
    assert.equal((await pin(publication.publication_id)).participant_source_map[participant(fresh, 1)], null)
    await refuse(() => finalize(fresh, reviewedMap.mapFingerprint), /map changed/)
    const republished = await finalize(fresh, finalLink.mapFingerprint)
    assert.notEqual(republished.publication_id, publication.publication_id)
    assert.equal((await pin(republished.publication_id)).participant_source_map[participant(fresh, 1)], target2)
    assert.deepEqual(await finalize(fresh, finalLink.mapFingerprint), republished)
  })
  await check('old link operation replay after republication returns receipt without reopening or writing again', async () => {
    const before = await state(fresh)
    assert.deepEqual(await callAs(owner, 'link_baseball_personal_participant', finalLinkRequest), finalLink)
    assert.deepEqual(await state(fresh), before)
  })
  await check('personal player membership AND returned map use pins, never operational rows or UUID-shaped local ids', async () => {
    const unlinkedPlayerShape = await player()
    await admin.query('begin')
    await admin.query('update public.game_participants set source_player_id=$1 where game_id=$2 and client_participant_id=$3',
      [unlinkedPlayerShape, fresh.game_id, participant(fresh)])
    await admin.query(as(owner))
    const fromOldTarget = await rpc(admin, 'get_baseball_player_aggregate_publications', [target, null, null, null, null, 20])
    assert.equal(fromOldTarget.items.find(item => item.game.id === fresh.game_id).participantSourceMap[participant(fresh)], target)
    const fromLiveTarget = await rpc(admin, 'get_baseball_player_aggregate_publications', [unlinkedPlayerShape, null, null, null, null, 20])
    assert.ok(!fromLiveTarget.items.some(item => item.game.id === fresh.game_id))
    await admin.query('rollback; reset role')
  })
  await check('corrupt and missing pins produce invalid diagnostics rather than live-map fallback or partial scores', async () => {
    const active = (await map(fresh)).activePublicationId
    for (const mutation of ['delete from public.baseball_personal_publication_pins where publication_id=$1',
      "update public.baseball_personal_publication_pins set participant_source_map='{}',map_fingerprint=md5('{}') where publication_id=$1"]) {
      await admin.query('begin')
      await admin.query(mutation, [active])
      await admin.query(as(owner))
      const item = (await rpc(admin, 'get_baseball_player_aggregate_publications', [target, null, null, null, null, 20])).items.find(item => item.game.id === fresh.game_id)
      assert.equal(item.identityStatus, 'invalid')
      assert.equal(item.participantSourceMap, null)
      await admin.query('rollback; reset role')
    }
  })

  const teamSources = await Promise.all(historical.snapshot.sportGameState.setup.participants.map(() => player()))
  for (const source of teamSources) await admin.query('insert into public.team_players(team_id,player_id) values($1,$2)', [team, source])
  const teamGame = await game('team', owner, { team, season, sources: teamSources })
  const teamPub = await finalize(teamGame)
  await check('accepted team viewer/scorer reads preserved; personal link/reviewed-finalizer never authorize team games', async () => {
    assert.equal(await pin(teamPub.publication_id), undefined)
    for (const user of [owner, viewer, scorer]) {
      const response = await callAs(user, 'get_baseball_scope_aggregate_publications', ['team', team, null, null, 20])
      assert.ok(response.items.some(item => item.publicationId === teamPub.publication_id))
      assert.ok((await page(user, teamSources[0], team)).items.some(item => item.publicationId === teamPub.publication_id))
    }
    assert.equal((await callAs(foreign, 'get_baseball_scope_aggregate_publications', ['team', team, null, null, 20])).items.length, 0)
    await refuse(() => callAs(owner, 'get_baseball_personal_participant_links', [teamGame.game_id]), /creator access/)
    await refuse(() => callAs(owner, 'link_baseball_personal_participant', linkArgs(teamGame, initial, participant(teamGame), target)), /creator access/)
    await refuse(() => finalize(teamGame, initial.mapFingerprint), /creator access/)
  })
  await check('paired tied-timestamp keysets, range/default limits and team/season/tournament scopes remain bounded', async () => {
    const tournament = ids()
    await admin.query("insert into public.tournaments(id,name,team_id) values($1,'Cup',$2)", [tournament, team])
    // Seed tournament metadata as fixture owner; attachment writes belong to BSB-7B.
    await callAs(owner, 'reopen_baseball_event_game', [teamGame.game_id, 'Attach reviewed tournament'])
    await admin.query('update public.games set tournament_id=$1 where id=$2', [tournament, teamGame.game_id])
    await finalize(teamGame)
    const another = await game('team-two', owner, { team, season, sources: teamSources })
    await finalize(another)
    await admin.query("update public.game_event_canonical_publications set finalized_at='2026-10-20T00:00:00Z' where game_id=any($1::uuid[]) and invalidated_at is null", [[teamGame.game_id, another.game_id]])
    const first = await callAs(viewer, 'get_baseball_scope_aggregate_publications', ['team', team, null, null, 1])
    assert.equal(first.items.length, 1)
    assert.ok(first.nextCursor)
    const second = await callAs(viewer, 'get_baseball_scope_aggregate_publications', ['team', team, first.nextCursor.finalizedAt, first.nextCursor.publicationId, 1])
    assert.equal(second.items.length, 1)
    assert.notEqual(first.items[0].publicationId, second.items[0].publicationId)
    assert.equal(second.nextCursor, null)
    assert.equal((await callAs(viewer, 'get_baseball_scope_aggregate_publications', ['season', season])).items.length, 2)
    assert.equal((await callAs(viewer, 'get_baseball_scope_aggregate_publications', ['tournament', tournament])).items.length, 1)
    for (const limit of [0, 51]) await refuse(() => callAs(viewer, 'get_baseball_scope_aggregate_publications', ['team', team, null, null, limit]), /page size/)
    await refuse(() => callAs(viewer, 'get_baseball_scope_aggregate_publications', ['team', team, '2026-10-20', null, 20]), /cursor/)
    const response = await callAs(viewer, 'get_baseball_scope_aggregate_publications', ['team', team])
    assert.equal(response.items.length, 2)
  })
  await check('only completed/run-rule/time-limit publications aggregate; forfeit/abandoned still finalize under old contract', async () => {
    for (const outcome of ['completed', 'run_rule', 'time_limit', 'forfeit', 'abandoned']) {
      const outcomeGame = await game(`outcome-${outcome}`, owner, { team, season, sources: teamSources, outcome })
      const published = await finalize(outcomeGame)
      const included = (await callAs(viewer, 'get_baseball_scope_aggregate_publications', ['team', team, null, null, 50])).items.some(item => item.publicationId === published.publication_id)
      assert.equal(included, ['completed', 'run_rule', 'time_limit'].includes(outcome))
    }
    const base = historical.snapshot
    for (const [events, expected] of [
      [[{ eventType: 'baseball.game_ended', sequence: 1, id: 'a', payload: { outcome: 'completed' } }], true],
      [[{ eventType: 'baseball.game_ended', sequence: 1, id: 'a', payload: { outcome: 'suspended' } }], false],
      [[{ eventType: 'baseball.game_ended', sequence: 1, id: 'a', payload: { outcome: 'completed' } }, { eventType: 'baseball.game_reopened', sequence: 2, id: 'b' }], false],
    ]) assert.equal((await admin.query('select public._baseball_canonical_snapshot_completed($1) result', [{ ...base, eventStream: { version: 1, events } }])).rows[0].result, expected)
  })
  await check('Soccer/Basketball/Hockey pager authorization and response shape stay equal to 075', async () => {
    const oldPager = readFileSync(`${repo}/supabase/migrations/075_hockey_aggregate_sources.sql`, 'utf8')
    const start = oldPager.indexOf('create or replace function public._event_aggregate_publication_page(')
    const body = oldPager.slice(start, oldPager.indexOf('\n$$;', start) + 4)
    const currentBody = (await admin.query("select pg_get_functiondef('public._event_aggregate_publication_page(text,text,uuid,uuid,uuid,uuid,timestamptz,uuid,integer)'::regprocedure) definition")).rows[0].definition
    // Populate valid-shaped sibling publications in this disposable database, then compare
    // old/new bodies over the same rows and roles. These are server paging fixtures only.
    for (const sport of ['soccer', 'basketball', 'hockey']) {
      const siblingSeason = ids(); const siblingTeam = ids(); const siblingGame = ids(); const siblingPublication = ids()
      await admin.query('insert into public.seasons(id,owner_id,name,sport) values($1,$2,$3,$4)', [siblingSeason, owner, sport, sport])
      await admin.query('insert into public.teams(id,owner_id,name,season_id) values($1,$2,$3,$4)', [siblingTeam, owner, sport, siblingSeason])
      await admin.query("insert into public.team_members(team_id,user_id,role,accepted_at) values($1,$2,'viewer',now())", [siblingTeam, viewer])
      await admin.query("insert into public.games(id,team_id,season_id,opponent_name,game_date,status,created_by,cloud_scope,sport_id) values($1,$2,$3,'Visitors',current_date,'in_progress',$4,'team',$5)", [siblingGame, siblingTeam, siblingSeason, owner, sport])
      const snapshot = { canonicalSchemaVersion: 1, sportId: sport, eventStream: { version: 1, events: [
        { id: ids(), eventType: `${sport}.match_ended`, sequence: 1, period: { id: 'p1', order: 1 }, elapsedMs: 0,
          payload: { reason: sport === 'hockey' ? null : 'completed' } },
      ] } }
      await admin.query("insert into public.game_event_setup_snapshots(game_id,sport_id,setup_snapshot,updated_by) values($1,$2,'{\"version\":1}',$3)", [siblingGame, sport, owner])
      await admin.query(`insert into public.game_event_stream_checkpoints(game_id,recorded_by,stream_version,event_count,
        max_sequence,event_revisions,stream_fingerprint) values($1,$2,1,1,1,'[]','sibling')`, [siblingGame, owner])
      await admin.query(`insert into public.game_event_canonical_publications(id,game_id,publication_number,sport_id,primary_recorded_by,stream_version,
        event_count,max_sequence,event_revisions,stream_fingerprint,canonical_snapshot,snapshot_fingerprint,finalized_by)
        values($1,$2,1,$3,$4,1,1,1,'[]','sibling',$5,md5($5::jsonb::text),$4)`, [siblingPublication, siblingGame, sport, owner, snapshot])
      await admin.query("update public.games set status='final' where id=$1", [siblingGame])
      for (const user of [owner, viewer, foreign]) {
        const args = ['team', siblingTeam, null, null, 20]
        const after = await callAs(user, `get_${sport}_scope_aggregate_publications`, args)
        await admin.query(body)
        const before = await callAs(user, `get_${sport}_scope_aggregate_publications`, args)
        await admin.query(currentBody)
        assert.deepEqual(after, before)
        assert.equal(after.items.length, user === foreign ? 0 : 1)
        if (after.items[0]) assert.ok(!('identityStatus' in after.items[0]))
      }
    }
  })

  const mergeGame = await game('merge-lineage')
  const a = await player(); const b = await player(); const c = await player(); const d = await player()
  await callAs(owner, 'link_baseball_personal_participant', linkArgs(mergeGame, await map(mergeGame), participant(mergeGame), a))
  await callAs(owner, 'link_baseball_personal_participant', linkArgs(mergeGame, await map(mergeGame), participant(mergeGame, 1), b))
  const mergeReview = await map(mergeGame)
  const mergePub = await finalize(mergeGame, mergeReview.mapFingerprint)
  const originalMergePin = await pin(mergePub.publication_id)
  await check('one-hop and chained audited merges resolve immutable pin UUIDs without rewriting pins', async () => {
    await merge(a, c)
    let item = (await page(owner, c)).items.find(item => item.game.id === mergeGame.game_id)
    assert.equal(item.participantSourceMap[participant(mergeGame)], c)
    assert.equal(item.identityStatus, 'valid')
    await merge(c, d)
    item = (await page(owner, d)).items.find(item => item.game.id === mergeGame.game_id)
    assert.equal(item.participantSourceMap[participant(mergeGame)], d)
    assert.deepEqual(await pin(mergePub.publication_id), originalMergePin)
    assert.deepEqual(await finalize(mergeGame, mergeReview.mapFingerprint), mergePub)
    const currentFingerprint = (await map(mergeGame)).mapFingerprint
    await refuse(() => finalize(mergeGame, currentFingerprint), /map changed/)
  })
  await check('legitimate convergent merges retain both participant keys and do not brick raw-map review or republication', async () => {
    await merge(b, d)
    const item = (await page(owner, d)).items.find(item => item.game.id === mergeGame.game_id)
    assert.equal(item.identityStatus, 'valid')
    assert.equal(item.participantSourceMap[participant(mergeGame)], d)
    assert.equal(item.participantSourceMap[participant(mergeGame, 1)], d)
    const current = await map(mergeGame)
    assert.equal(current.participantSourceMap[participant(mergeGame)], d)
    assert.equal(current.participantSourceMap[participant(mergeGame, 1)], d)
    const noOp = await callAs(owner, 'link_baseball_personal_participant', linkArgs(mergeGame, current, participant(mergeGame), d))
    assert.equal(noOp.reopen, null)
    assert.equal((await state(mergeGame)).status, 'final')
    await callAs(owner, 'reopen_baseball_event_game', [mergeGame.game_id, 'Post-merge review'])
    const republished = await finalize(mergeGame, current.mapFingerprint)
    assert.equal((await pin(republished.publication_id)).participant_source_map[participant(mergeGame, 1)], d)
  })
  await check('ambiguous/cyclic/unknown/deleted and unauthorized survivor lineage fail closed, not anonymous', async () => {
    for (const mode of ['ambiguous', 'cycle', 'unknown', 'deleted', 'unauthorized']) {
      await admin.query('begin')
      if (mode === 'ambiguous') await admin.query('insert into public.player_merge_audit(duplicate_player_id,survivor_player_id,merged_by) values($1,$2,$3)', [a, b, owner])
      if (mode === 'cycle') await admin.query('insert into public.player_merge_audit(duplicate_player_id,survivor_player_id,merged_by) values($1,$2,$3)', [d, a, owner])
      if (mode === 'unknown') await admin.query('delete from public.player_merge_audit where duplicate_player_id=$1', [a])
      if (mode === 'deleted') await admin.query('delete from public.players where id=$1', [d])
      if (mode === 'unauthorized') {
        await admin.query('delete from public.player_guardians where player_id=$1 and user_id=$2', [d, owner])
        await admin.query('update public.players set created_by=$1 where id=$2', [foreign, d])
      }
      const identity = (await admin.query('select public._baseball_personal_publication_identity($1) result', [mergePub.publication_id])).rows[0].result
      assert.equal(identity.status, 'invalid', mode)
      assert.equal(identity.participantSourceMap, null, mode)
      await admin.query('rollback; reset role')
    }
  })

  await check('real race: link/link serializes on game; loser sees stale map and writes no receipt', async () => {
    const g = await game('race-link-link'); const p1 = await player(); const p2 = await player(); const review = await map(g)
    const one = await connection(owner); const two = await connection(owner)
    await one.query('begin')
    await rpc(one, 'link_baseball_personal_participant', linkArgs(g, review, participant(g), p1))
    const second = pending(rpc(two, 'link_baseball_personal_participant', linkArgs(g, review, participant(g, 1), p2)))
    await blocked(two, one); await one.query('commit')
    await settleRefused(second, /map changed/)
    assert.equal((await state(g)).receipts, 1)
    await close(one, two); races++
  })
  await check('real race: finalize/link waits for publication then rejects stale publication CAS', async () => {
    const g = await game('race-finalize-link'); const p = await player(); const review = await map(g)
    const one = await connection(owner); const two = await connection(owner)
    await one.query('begin'); const published = await finalize(g, review.mapFingerprint, one)
    const second = pending(rpc(two, 'link_baseball_personal_participant', linkArgs(g, review, participant(g), p)))
    await blocked(two, one); await one.query('commit')
    await settleRefused(second, /publication changed/)
    assert.equal((await state(g)).status, 'final')
    assert.equal((await state(g)).receipts, 0)
    assert.deepEqual((await pin(published.publication_id)).participant_source_map, review.participantSourceMap)
    await close(one, two); races++
  })
  await check('real race: link/reviewed-finalize waits then refuses stale map without publishing', async () => {
    const g = await game('race-link-finalize'); const p = await player(); const review = await map(g)
    const one = await connection(owner); const two = await connection(owner)
    await one.query('begin'); await rpc(one, 'link_baseball_personal_participant', linkArgs(g, review, participant(g), p))
    const second = pending(finalize(g, review.mapFingerprint, two))
    await blocked(two, one); await one.query('commit'); await settleRefused(second, /map changed/)
    assert.equal((await state(g)).active, 0)
    await close(one, two); races++
  })
  await check('real race: reopen/final-link waits then refuses stale active-publication CAS', async () => {
    const g = await game('race-reopen-link'); const p = await player(); await finalize(g); const review = await map(g)
    const one = await connection(owner); const two = await connection(owner)
    await one.query('begin'); await rpc(one, 'reopen_baseball_event_game', [g.game_id, 'Concurrent review'])
    const second = pending(rpc(two, 'link_baseball_personal_participant', linkArgs(g, review, participant(g), p)))
    await blocked(two, one); await one.query('commit'); await settleRefused(second, /publication changed/)
    assert.equal((await state(g)).receipts, 0)
    await close(one, two); races++
  })
  await check('real race: merge/link blocks on target advisory and rechecks deleted target after merge', async () => {
    const g = await game('race-merge-link'); const duplicate = await player(); const survivor = await player(); const review = await map(g)
    const one = await connection(owner); const two = await connection(owner)
    await one.query('begin'); await merge(duplicate, survivor, one)
    const second = pending(rpc(two, 'link_baseball_personal_participant', linkArgs(g, review, participant(g), duplicate)))
    await blocked(two, one); await one.query('commit'); await settleRefused(second, /Authorized personal player/)
    assert.equal((await state(g)).receipts, 0)
    await close(one, two); races++
  })
  await check('real race: link/merge blocks in the opposite direction, then remounts the confirmed source safely', async () => {
    const g = await game('race-link-merge'); const duplicate = await player(); const survivor = await player(); const review = await map(g)
    const one = await connection(owner); const two = await connection(owner)
    await one.query('begin'); await rpc(one, 'link_baseball_personal_participant', linkArgs(g, review, participant(g), duplicate))
    const second = pending(merge(duplicate, survivor, two))
    await blocked(two, one); await one.query('commit'); assert.ok(!(await second).error)
    assert.equal((await map(g)).participantSourceMap[participant(g)], survivor)
    await close(one, two); races++
  })
  await check('real race: reviewed finalize/merge detects a changed inserted pin and rolls back all finalization state', async () => {
    const g = await game('race-finalize-merge'); const duplicate = await player(); const survivor = await player()
    await callAs(owner, 'link_baseball_personal_participant', linkArgs(g, await map(g), participant(g), duplicate))
    const review = await map(g); const before = await state(g)
    const gate = await connection(); const finalizer = await connection(owner); const merger = await connection(owner)
    await admin.query(`create function bsb7a_test.pause_publication() returns trigger language plpgsql as $$ begin
      if new.game_id = ${q(g.game_id)}::uuid then perform pg_advisory_xact_lock(789079); end if; return new; end $$;
      create trigger bsb7a_pause_publication before insert on public.game_event_canonical_publications
      for each row execute function bsb7a_test.pause_publication();`)
    await gate.query('begin; select pg_advisory_xact_lock(789079)')
    const publishing = pending(finalize(g, review.mapFingerprint, finalizer))
    await blocked(finalizer, gate)
    // This would deadlock if the pin hook acquired player locks after its game lock.
    await merge(duplicate, survivor, merger)
    await gate.query('commit')
    await settleRefused(publishing, /map changed during finalization/)
    assert.deepEqual(await state(g), before)
    assert.equal((await map(g)).participantSourceMap[participant(g)], survivor)
    await admin.query('drop trigger bsb7a_pause_publication on public.game_event_canonical_publications')
    await close(gate, finalizer, merger); races++
  })
  await check('real race: old finalizer/merge pins one consistent post-merge map without changing its old API', async () => {
    const g = await game('race-old-finalize-merge'); const duplicate = await player(); const survivor = await player()
    await callAs(owner, 'link_baseball_personal_participant', linkArgs(g, await map(g), participant(g), duplicate))
    const gate = await connection(); const finalizer = await connection(owner); const merger = await connection(owner)
    await admin.query(`create or replace function bsb7a_test.pause_publication() returns trigger language plpgsql as $$ begin
      if new.game_id = ${q(g.game_id)}::uuid then perform pg_advisory_xact_lock(789079); end if; return new; end $$;
      create trigger bsb7a_pause_publication before insert on public.game_event_canonical_publications
      for each row execute function bsb7a_test.pause_publication();`)
    await gate.query('begin; select pg_advisory_xact_lock(789079)')
    const publishing = pending(finalize(g, null, finalizer)); await blocked(finalizer, gate)
    await merge(duplicate, survivor, merger); await gate.query('commit')
    const result = await publishing; assert.ok(!result.error)
    const pinned = await pin(result.value.publication_id)
    assert.equal(pinned.participant_source_map[participant(g)], survivor)
    assert.deepEqual(await finalize(g), result.value)
    assert.deepEqual(await pin(result.value.publication_id), pinned)
    await admin.query('drop trigger bsb7a_pause_publication on public.game_event_canonical_publications')
    await close(gate, finalizer, merger); races++
  })
  results.passed = true
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  results.checks = checks; results.refusals = refusals; results.concurrency = races
  writeFileSync(resolve(output, 'result.json'), `${JSON.stringify(results, null, 2)}\n`)
  for (const client of [...connections]) { try { await client.query('rollback'); await client.end() } catch { /* close remaining sessions */ } }
  // Only this run's random, freshly-created database is ever dropped.
  await root.query(`drop database if exists "${name}" with (force)`)
  await root.end()
  console.log(JSON.stringify(results))
}
