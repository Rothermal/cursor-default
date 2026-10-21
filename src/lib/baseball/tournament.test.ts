import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sports } from '../../config/sports'
import { resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from '../authIdentity'
import { createBaseballEventGameState } from './setupBuilder'
import { baseballSetup } from './testFixtures'
import { AGGREGATE_TEAM, AGGREGATE_USER, aggregateUuid } from './aggregateTestFixtures'
import { loadBaseballCloudShell, syncBaseballEventGameToCloud } from './cloudSync'
import { loadBaseballTeamTournaments, syncBaseballTournamentAssociation } from './tournament'

const h = vi.hoisted(() => ({ client: null as unknown, upload: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: (...args: unknown[]) => (h.client as { from: (...args: unknown[]) => unknown }).from(...args) } }))
vi.mock('./releaseCapabilities', () => ({ ensureBaseballReleaseCapabilities: vi.fn(async () => ({ status: 'ready' })) }))
vi.mock('../gameEvents/cloudTransport', async original => ({ ...await original<typeof import('../gameEvents/cloudTransport')>(),
  syncEventGameToCloud: async (input: { validateBinding: (id: string) => Promise<void> }) => { await input.validateBinding('bound'); h.upload(); return { gameId: 'bound' } },
}))
const tournamentId = aggregateUuid(701)
function state() {
  const setup = baseballSetup(); setup.sourceTeamId = AGGREGATE_TEAM; setup.sourceSeasonId = aggregateUuid(703)
  const result = createBaseballEventGameState({ sport: sports.find(row => row.id === 'baseball')!, setup, teamName: 'Falcons', date: '2026-10-21', cloudPolicy: 'automatic', tournament: { id: tournamentId, teamId: AGGREGATE_TEAM, name: 'Fall cup' } })
  if (!result.ok) throw Error(result.message)
  return result.state
}
function backend(options: { owner?: string; status?: string; existing?: string | null; zero?: boolean; failReadback?: boolean; tournamentTeam?: string; onRead?: () => void } = {}) {
  const initial = state(), setup = initial.sportGameState!.setup
  const game = { id: 'bound', team_id: AGGREGATE_TEAM, season_id: aggregateUuid(703), created_by: options.owner ?? AGGREGATE_USER, status: options.status ?? 'in_progress', sport_id: 'baseball', tournament_id: options.existing ?? null,
    tracked_team_name: 'Falcons', opponent_name: 'Visitors', tournament_name: 'Fall cup', game_date: '2026-10-21' }
  const updates: unknown[] = []
  const tables: Record<string, unknown[]> = { tournaments: [{ id: tournamentId, name: 'Fall cup', team_id: options.tournamentTeam ?? AGGREGATE_TEAM }], games: [game],
    game_event_setup_snapshots: [{ game_id: 'bound', sport_id: 'baseball', setup_snapshot: setup }],
    game_participants: 'participants' in setup ? setup.participants.map((p,i) => ({ game_id: 'bound', id: `row-${i}`, client_participant_id: p.id, client_player_id: p.playerId, display_name: p.displayName, jersey_number: p.number })) : [] }
  const client = { from: (table: string) => {
    const filters: Array<[string,unknown]> = []; let single = false, patch: Record<string,unknown> | null = null, start = 0, end = 199
    const q = { select: () => q, order: () => q, abortSignal: () => q, eq: (k: string,v: unknown) => { filters.push([k,v]); return q },
      neq: () => q, is: () => q, range: (a: number,b: number) => { start = a; end = b; return q },
      update: (value: Record<string,unknown>) => { patch = value; return q }, single: () => { single = true; return q }, maybeSingle: () => { single = true; return q },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        options.onRead?.()
        let data = (tables[table] ?? []).filter(row => filters.every(([k,v]) => (row as Record<string,unknown>)[k] === v))
        if (patch) { updates.push(patch); if (options.zero) data = []; else if (!options.failReadback) Object.assign(game,patch) }
        const output = data.slice(start,end + 1)
        return Promise.resolve({ data: single ? output[0] ?? null : output, error: null }).then(resolve,reject)
      } }
    return q
  } }
  return { client: client as unknown as SupabaseClient, game, updates }
}
beforeEach(() => { setCurrentAuthUserId(AGGREGATE_USER); h.upload.mockReset() })
afterEach(resetCurrentAuthUserIdForTests)
describe('BSB-7B explicit tournament association', () => {
  it('persists only additive gameInfo metadata and preserves immutable setup across save/reload', () => {
    const current = state(), reloaded = JSON.parse(JSON.stringify(current))
    expect(reloaded.gameInfo).toMatchObject({ tournamentId, tournamentName: 'Fall cup' })
    expect(reloaded.sportGameState.setup).not.toHaveProperty('tournamentId')
    expect(reloaded.eventStream).toEqual(current.eventStream)
  })
  it('rejects personal and cross-team setup attachment', () => {
    for (const setup of [baseballSetup(), { ...baseballSetup(), sourceTeamId: aggregateUuid(999) }]) {
      const result = createBaseballEventGameState({ sport: sports.find(row => row.id === 'baseball')!, setup, teamName: 'Team', date: '2026-10-21', tournament: { id: tournamentId, teamId: AGGREGATE_TEAM, name: 'Cup' } })
      expect(result.ok).toBe(false)
    }
  })
  it('reads authorized tournaments and conditionally saves/verifies creator metadata', async () => {
    const b = backend()
    expect(await loadBaseballTeamTournaments(AGGREGATE_TEAM, () => {}, undefined, b.client)).toHaveLength(1)
    await syncBaseballTournamentAssociation(state(), 'bound', AGGREGATE_USER, () => {}, b.client)
    expect(b.updates).toEqual([{ tournament_id: tournamentId, tournament_name: 'Fall cup' }])
    expect(b.game.tournament_id).toBe(tournamentId)
  })
  it.each([{ owner: 'viewer' }, { status: 'final' }, { existing: aggregateUuid(799) }, { tournamentTeam: aggregateUuid(999) }, { zero: true }, { failReadback: true }])('refuses unavailable/unauthorized/unconfirmed attachment %j', async options => {
    const b = backend(options)
    await expect(syncBaseballTournamentAssociation(state(), 'bound', AGGREGATE_USER, () => {}, b.client)).rejects.toThrow()
  })
  it('lets another recorder verify an equal attachment without issuing a write', async () => {
    const b = backend({ owner: 'other', existing: tournamentId })
    await syncBaseballTournamentAssociation(state(), 'bound', AGGREGATE_USER, () => {}, b.client)
    expect(b.updates).toHaveLength(0)
  })
  it('guards account epochs even with no caller callback protection', async () => {
    const b = backend({ onRead: () => { setCurrentAuthUserId('other'); setCurrentAuthUserId(AGGREGATE_USER) } })
    await expect(syncBaseballTournamentAssociation(state(), 'bound', AGGREGATE_USER, () => {}, b.client)).rejects.toThrow('account changed')
    expect(b.updates).toHaveLength(0)
  })
  it('stops after bind failure before upload/checkpoint, preserves selection, and retries with duplicate validation', async () => {
    const current = state(), before = structuredClone(current), duplicate = vi.fn()
    h.client = backend({ zero: true }).client
    await expect(syncBaseballEventGameToCloud({ state: current, userId: AGGREGATE_USER, localGameId: 'local', validateBinding: duplicate })).rejects.toThrow('not saved')
    expect(h.upload).not.toHaveBeenCalled(); expect(current).toEqual(before); expect(duplicate).toHaveBeenCalledOnce()
    h.client = backend().client
    await syncBaseballEventGameToCloud({ state: current, userId: AGGREGATE_USER, localGameId: 'local', validateBinding: duplicate })
    expect(h.upload).toHaveBeenCalledOnce(); expect(duplicate).toHaveBeenCalledTimes(2)
  })
  it('preserves tournament identity through the actual cloud shell reader', async () => {
    h.client = backend({ existing: tournamentId }).client
    const shell = await loadBaseballCloudShell('bound')
    expect(shell.state.gameInfo).toMatchObject({ tournamentId, tournamentName: 'Fall cup' })
  })
})
