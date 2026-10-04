import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import {
  canOfferDeletedSourcePlayerRecovery,
  DELETED_SOURCE_PLAYER_BINDING_ERROR,
  deletedSourceRecoveryTeamId,
} from '../gameEvents/deletedSourceRecovery'
import { createHockeyEventGameState } from './setupBuilder'
import { at, hockeySetup } from './testFixtures'

const cloudMock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), upsert: vi.fn(), load: vi.fn() }))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => cloudMock.rpc(...args),
    from: (...args: unknown[]) => cloudMock.from(...args),
  },
}))

vi.mock('../gameEvents/cloud', () => ({
  upsertGameEventForRecorder: (...args: unknown[]) => cloudMock.upsert(...args),
  loadGameEventStreamForRecorder: (...args: unknown[]) => cloudMock.load(...args),
}))

const { syncHockeyEventGameToCloud } = await import('./cloudSync')

const hockey = sports.find(sport => sport.id === 'hockey')!

/** A team-backed Hockey cloud game that has never bound: the setup names the team, cloudSync does not. */
function unboundTeamGame(): GameState {
  const setup = { ...hockeySetup(), sourceTeamId: 'team-1', sourceSeasonId: 'season-1' }
  const created = createHockeyEventGameState({
    sport: hockey,
    setup,
    teamName: 'Home',
    opponentName: 'Rivals',
    date: '2026-10-04',
    context: { recorderUserId: 'user-1', occurredAt: at(0) },
    cloudPolicy: 'automatic',
  })
  if (!created.ok) throw new Error(created.message)
  return {
    ...created.state,
    cloudSync: {
      ...created.state.cloudSync,
      status: 'error',
      lastError: `Hockey game binding failed: ${DELETED_SOURCE_PLAYER_BINDING_ERROR}`,
    },
  }
}

beforeEach(() => {
  cloudMock.rpc.mockReset()
  cloudMock.from.mockReset()
  cloudMock.upsert.mockReset()
  cloudMock.load.mockReset()
  cloudMock.rpc.mockImplementation((name: string) => Promise.resolve(
    name === 'bind_hockey_event_game_v5'
      ? { data: { game_id: 'cloud-game-1', game_status: 'in_progress', participant_id_map: {} }, error: null }
      : { data: '2026-10-04T12:01:00.000Z', error: null }
  ))
  cloudMock.from.mockReturnValue({
    select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
    update: () => ({ eq: () => ({ is: () => Promise.resolve({ data: [], error: null }) }) }),
  })
  cloudMock.upsert.mockResolvedValue({ ok: true, status: 'applied' })
  cloudMock.load.mockResolvedValue({
    ok: true,
    eventStream: { version: 1, events: [] },
    inspection: { complete: true, activeEvents: [], deletedEvents: [], diagnostics: [] },
    quarantinedRows: [],
    error: null,
  })
})

describe('HKY-5B1 deleted source player recovery before the first bind', () => {
  it('resolves the approving team from the immutable setup until a binding exists', () => {
    const unbound = unboundTeamGame()
    expect(unbound.cloudSync.teamId).toBeNull()
    expect(deletedSourceRecoveryTeamId(unbound)).toBe('team-1')

    const bound = { ...unbound, cloudSync: { ...unbound.cloudSync, gameId: 'cloud-game-1', teamId: 'team-1' } }
    expect(deletedSourceRecoveryTeamId(bound)).toBe('team-1')

    const personal = createHockeyEventGameState({
      sport: hockey,
      setup: hockeySetup(),
      teamName: 'Home',
      opponentName: 'Rivals',
      date: '2026-10-04',
      context: { recorderUserId: 'user-1', occurredAt: at(0) },
      cloudPolicy: 'automatic',
    })
    if (!personal.ok) throw new Error(personal.message)
    expect(deletedSourceRecoveryTeamId(personal.state)).toBeNull()
  })

  it('offers Preserve history to the source team owner of an unbound game, and only to managers', () => {
    const unbound = unboundTeamGame()
    expect(canOfferDeletedSourcePlayerRecovery(unbound.cloudSync.lastError, 'owner')).toBe(true)
    expect(canOfferDeletedSourcePlayerRecovery(unbound.cloudSync.lastError, 'scorer')).toBe(false)
  })

  it('sends the one-attempt approval on the first bind, with no existing game', async () => {
    const approved = unboundTeamGame()
    approved.cloudSync = { ...approved.cloudSync, status: 'idle', lastError: null, allowDeletedSourcePlayerRecovery: true }

    await syncHockeyEventGameToCloud({ state: approved, userId: 'user-1', localGameId: 'local-1' })

    expect(cloudMock.rpc).toHaveBeenNthCalledWith(1, 'bind_hockey_event_game_v5', expect.objectContaining({
      p_existing_game_id: null,
      p_source_team_id: 'team-1',
      p_allow_deleted_source_players: true,
    }))
  })

  it('looks the role up by that team in the alert and the recovery callback', () => {
    const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
    expect(read('src/components/hockey/HockeyCloudSync.tsx')).toContain('useTeamRole(deletedSourceRecoveryTeamId(state))')
    expect(read('src/context/GameContext.tsx')).toContain('!deletedSourceRecoveryTeamId(current)')
  })
})
