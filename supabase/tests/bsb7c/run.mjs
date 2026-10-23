// Real PostgreSQL roles, CAS races and rollback in a fresh loopback-only database.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const config = { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 55437),
  user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD, database: process.env.PGDATABASE || 'postgres' }
if (!['localhost', '127.0.0.1', '::1'].includes(config.host)) throw Error('Refusing non-loopback PostgreSQL')
const { default: pg } = await import(pathToFileURL(resolve(process.env.PG_MODULE || `${repo}/qa.local/sql-probe/node_modules/pg/lib/index.js`)).href)
const name = `bsb7c_${randomUUID().replaceAll('-', '')}`
assert.match(name, /^bsb7c_[0-9a-f]{32}$/)
const cases = JSON.parse(readFileSync(process.env.BSB7C_CASES || `${repo}/qa.local/bsb7c-cases.json`, 'utf8'))
const root = new pg.Client(config), connections = []
await root.connect()
let created = false, checks = 0, refusals = 0, races = 0
const check = async (label, run) => { await run(); console.log(`ok ${++checks}: ${label}`) }
const refuse = async (run, pattern = /permission|Authentication|Active app|SPORT_SETTINGS_INVALID/i) => {
  await assert.rejects(run, pattern); refusals++
}
const connection = async (id, role = 'authenticated') => {
  const client = new pg.Client({ ...config, database: name }); await client.connect(); connections.push(client)
  client.testUserId = id ?? null
  await client.query("set statement_timeout = '10s'; set lock_timeout = '5s'")
  if (role) {
    assert.ok(['authenticated', 'anon'].includes(role))
    await client.query(`set role ${role}`)
    await client.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ''])
  }
  return client
}
const rpc = async (client, fn, args = fn === 'get_baseball_personal_settings' ? [client.testUserId] : []) => (await client.query(`select public.${fn}(${args.map((_, index) => `$${index + 1}`).join(',')}) result`, args)).rows[0].result
const save = (client, revision, settings, expectedUser = client.testUserId) => rpc(client, 'save_baseball_user_settings_revisioned', [expectedUser, revision, settings])
const value = { settingsSchemaVersion: 1, baseProfile: { profileId: 'mlb', profileVersion: 1 }, ruleOverrides: {} }
const ids = Array.from({ length: 4 }, randomUUID)
let admin
const blocked = async (waiter, blocker) => {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    if ((await admin.query('select $1::int = any(pg_blocking_pids($2::int)) blocked', [blocker.processID, waiter.processID])).rows[0].blocked) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw Error('Expected PostgreSQL lock blocking was not observed')
}
try {
  const template = process.env.BSB7C_BUILD_BASE === '1' ? 'template0' : process.env.BSB7C_TEMPLATE || 'bsb7a_base'
  assert.match(template, /^[a-z][a-z0-9_]{0,62}$/)
  await root.query(`create database "${name}" template "${template}"`); created = true
  admin = await connection(null, null)
  if (process.env.BSB7C_BUILD_BASE === '1') {
    await admin.query(readFileSync(`${repo}/supabase/tests/bsb6a/bootstrap.sql`, 'utf8'))
    for (const file of readdirSync(`${repo}/supabase/migrations`).filter(file => /^\d{3}_.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= 78).sort()) {
      await admin.query(readFileSync(`${repo}/supabase/migrations/${file}`, 'utf8'))
    }
  }
  await admin.query(readFileSync(`${repo}/supabase/migrations/079_baseball_aggregate_identity_foundation.sql`, 'utf8'))
  assert.equal((await admin.query("select to_regprocedure('public.get_baseball_personal_settings(uuid)') existing")).rows[0].existing, null)
  for (const [index, id] of ids.entries()) await admin.query('insert into auth.users(id,email) values($1,$2)', [id, `bsb7c-${index}@example.test`])
  await admin.query("update public.account_access set status='suspended' where user_id=$1", [ids[3]])
  const original = (await admin.query("select oid::regprocedure::text signature, pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace")).rows
  const policies = (await admin.query("select * from pg_policies where tablename in ('user_sport_settings','team_sport_settings') order by policyname")).rows
  await admin.query(readFileSync(`${repo}/supabase/migrations/080_baseball_personal_settings.sql`, 'utf8'))
  const a = await connection(ids[0]), b = await connection(ids[1]), fresh = await connection(ids[2])
  const anonymous = await connection(null, 'anon'), noSession = await connection(null), suspended = await connection(ids[3])
  await check('read/capability are account-active and missing is mutation-free', async () => {
    assert.deepEqual(await rpc(a, 'get_baseball_personal_settings'), { status: 'missing' })
    assert.deepEqual(await rpc(a, 'get_baseball_personal_settings_capabilities'), { contractVersion: 1, sportId: 'baseball', personalSettingsVersion: 1, migration: 80 })
    assert.equal((await admin.query("select count(*)::int count from public.user_sport_settings where sport_id='baseball'")).rows[0].count, 0)
    for (const client of [anonymous, noSession, suspended]) for (const fn of ['get_baseball_personal_settings', 'get_baseball_personal_settings_capabilities']) await refuse(() => rpc(client, fn))
    for (const client of [anonymous, noSession, suspended]) await refuse(() => save(client, null, value))
  })
  await check('SQL accepts exactly the client wire payloads across all seven profiles', async () => {
    for (const entry of cases) {
      const serialized = JSON.stringify(entry.value)
      if (entry.accepted) await rpc(admin, '_validate_baseball_personal_settings', [serialized])
      else await refuse(() => rpc(admin, '_validate_baseball_personal_settings', [serialized]), /SPORT_SETTINGS_INVALID/)
    }
    await refuse(() => rpc(admin, '_validate_baseball_personal_settings', [null]), /SPORT_SETTINGS_INVALID/)
  })
  await check('CAS insert/update and stale/missing-row conflicts preserve data', async () => {
    assert.deepEqual(await save(a, 1, value), { status: 'conflict', record: null })
    const first = await save(a, null, value); assert.equal(first.status, 'applied'); assert.equal(first.record.revision, 1)
    assert.equal((await save(a, null, value)).status, 'conflict')
    const changed = { ...value, ruleOverrides: { scheduledInnings: 6 } }
    const second = await save(a, 1, changed); assert.equal(second.record.revision, 2)
    const stale = await save(a, 1, value); assert.equal(stale.status, 'conflict'); assert.deepEqual(stale.record.settings, changed)
    await refuse(() => save(a, 0, value)); await refuse(() => save(a, -1, value))
    await refuse(() => save(a, 2, { ...value, lineupDefaults: {} }))
    assert.equal((await rpc(a, 'get_baseball_personal_settings')).record.revision, 2)
    assert.deepEqual(await rpc(b, 'get_baseball_personal_settings'), { status: 'missing' })
  })
  await check('RLS, direct writes and private cores cannot cross account boundaries', async () => {
    assert.equal((await b.query('select * from public.user_sport_settings where user_id=$1', [ids[0]])).rowCount, 0)
    for (const expectedUser of [ids[0], null]) {
      await refuse(() => rpc(b, 'get_baseball_personal_settings', [expectedUser]), /settings account changed/)
      await refuse(() => save(b, null, value, expectedUser), /settings account changed/)
    }
    for (const sql of ["delete from public.user_sport_settings", "update public.user_sport_settings set revision=99", `insert into public.user_sport_settings(user_id,sport_id,schema_version,settings) values('${ids[1]}','baseball',1,'{}')`]) await refuse(() => b.query(sql))
    await refuse(() => rpc(a, '_validate_baseball_personal_settings', [value]))
    await refuse(() => rpc(a, '_save_sport_settings_revisioned_core', ['user', ids[1], null, 'baseball', 1, null, value, null]))
    const saved = await save(b, null, value); assert.equal(saved.record.revision, 1)
    assert.equal((await rpc(a, 'get_baseball_personal_settings')).record.revision, 2)
  })
  await check('all existing function bodies, row policies and release contracts are unchanged', async () => {
    for (const fn of original) assert.equal((await admin.query('select pg_get_functiondef($1::regprocedure) definition', [fn.signature])).rows[0].definition, fn.definition, fn.signature)
    assert.deepEqual((await admin.query("select * from pg_policies where tablename in ('user_sport_settings','team_sport_settings') order by policyname")).rows, policies)
    assert.equal((await rpc(a, 'get_baseball_release_capabilities')).contractVersion, 2)
    assert.equal((await rpc(a, 'get_baseball_aggregate_capabilities')).migration, 79)
    assert.equal((await rpc(a, 'get_baseball_personal_link_capabilities')).migration, 79)
  })
  await check('transaction rollback cannot leave a revision or settings change', async () => {
    const before = await rpc(a, 'get_baseball_personal_settings')
    await a.query('begin'); await save(a, 2, value); await a.query('rollback')
    assert.deepEqual(await rpc(a, 'get_baseball_personal_settings'), before)
  })
  await check('two concurrent initial inserts apply once and return a conflict once', async () => {
    const other = await connection(ids[2])
    await fresh.query('begin')
    const first = await save(fresh, null, value)
    const pending = save(other, null, { ...value, ruleOverrides: { scheduledInnings: 3 } }).then(value => ({ value }), error => ({ error }))
    await blocked(other, fresh); await fresh.query('commit')
    const second = await pending; if (second.error) throw second.error
    assert.equal(first.status, 'applied'); assert.equal(second.value.status, 'conflict')
    assert.deepEqual(first.record, second.value.record)
    races++
  })
  await check('two concurrent same-revision updates cannot overwrite each other', async () => {
    const other = await connection(ids[0])
    await a.query('begin')
    const first = await save(a, 2, value)
    const pending = save(other, 2, { ...value, ruleOverrides: { scheduledInnings: 3 } }).then(value => ({ value }), error => ({ error }))
    await blocked(other, a); await a.query('commit')
    const second = await pending; if (second.error) throw second.error
    assert.equal(first.status, 'applied'); assert.equal(second.value.status, 'conflict')
    assert.equal(first.record.revision, 3); assert.deepEqual(first.record, second.value.record)
    races++
  })
  console.log(JSON.stringify({ passed: true, postgres: (await admin.query('show server_version')).rows[0].server_version, checks, refusals, parityCases: cases.length, races }))
} finally {
  for (const client of connections) { await client.query('rollback').catch(() => {}); await client.end().catch(() => {}) }
  if (created) await root.query(`drop database "${name}"`)
  await root.end()
}
