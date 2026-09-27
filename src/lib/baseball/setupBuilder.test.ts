import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import { createInitialState, gameReducer } from '../gameReducer'
import { exportParkedGames, importParkedGames, listParkedGameRecords, parkActiveGame, saveActiveGameState } from '../gameParking'
import { buildGameSyncFingerprint, cloudSyncRouteForState } from '../gameSyncFingerprint'
import { baseballSportState, startBaseballGame } from './commands'
import { createBaseballMatchRules } from './profiles'
import {
  applyBaseballLineupDefaults,
  buildBaseballMatchSetup,
  createBaseballEventGameState,
  createBaseballSetupDraft,
  missingBaseballDefaultPlayers,
  setBaseballDraftFielder,
  setBaseballDraftRules,
  setBaseballPlayerSelected,
  type BaseballSetupDraft,
  type BaseballSetupRosterPlayer,
} from './setupBuilder'

const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const roster: BaseballSetupRosterPlayer[] = Array.from({ length: 11 }, (_, index) => ({
  playerId: id(index + 1),
  displayName: `Player ${index + 1}`,
  number: String(index + 1),
  position: index === 0 ? 'p' : null,
}))
const nineFielders = Object.fromEntries(roster.slice(0, 9).map((player, index) => [String(index + 1), player.playerId]))

function counter() {
  let next = 0
  return () => `b0000000-0000-4000-8000-${String(++next).padStart(12, '0')}`
}

function readyDraft(): BaseballSetupDraft {
  return createBaseballSetupDraft({
    rules: createBaseballMatchRules('nfhs_baseball', { battingOrderFormat: 'standard' }),
    roster,
    lineupDefaults: { version: 1, battingOrder: roster.slice(0, 9).map(player => player.playerId), defense: nineFielders },
    opponentName: 'Tigers',
  })
}

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string) { return this.store.get(key) ?? null }
  setItem(key: string, value: string) { this.store.set(key, value) }
  removeItem(key: string) { this.store.delete(key) }
  clear() { this.store.clear() }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('Baseball setup draft', () => {
  it('dresses the whole roster and copies team defaults once', () => {
    const draft = readyDraft()
    expect(draft.selectedPlayerIds).toHaveLength(11)
    expect(draft.battingOrder).toHaveLength(9)
    expect(draft.defense['1']).toBe(id(1))
    expect(draft.opponentSlots).toHaveLength(9)
  })

  it('ignores default players who are not on this roster and reports them', () => {
    const defaults = { version: 1 as const, battingOrder: [id(1), id(99)], defense: { '2': id(99), '1': id(1) } }
    const draft = applyBaseballLineupDefaults(createBaseballSetupDraft({ rules: readyDraft().rules, roster }), roster, defaults)
    expect(draft.battingOrder).toEqual([id(1)])
    expect(draft.defense).toEqual({ '1': id(1) })
    expect(missingBaseballDefaultPlayers(roster, defaults)).toEqual([id(99)])
  })

  it('removes an undressed player from the order and the field', () => {
    const draft = setBaseballPlayerSelected(readyDraft(), id(1), false)
    expect(draft.battingOrder).not.toContain(id(1))
    expect(Object.values(draft.defense)).not.toContain(id(1))
    expect(setBaseballPlayerSelected(draft, id(1), true).selectedPlayerIds).toContain(id(1))
  })

  it('moves a fielder instead of letting them play two positions', () => {
    const draft = setBaseballDraftFielder(readyDraft(), 9, id(1))
    expect(draft.defense['9']).toBe(id(1))
    expect(draft.defense['1']).toBeUndefined()
  })

  it('clears the short fielder when the rules drop to nine players', () => {
    const slowpitch = createBaseballMatchRules('softball_slowpitch')
    const ten = setBaseballDraftFielder(setBaseballDraftRules(readyDraft(), slowpitch), 10, id(10))
    expect(ten.defense['10']).toBe(id(10))
    expect(setBaseballDraftRules(ten, readyDraft().rules).defense['10']).toBeUndefined()
  })
})

describe('Baseball setup build', () => {
  it('builds a valid setup with new participant ids and a snapshotted roster', () => {
    const built = buildBaseballMatchSetup(readyDraft(), roster, counter())
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const { setup } = built
    expect(setup.participants).toHaveLength(11)
    expect(setup.participants[0]).toMatchObject({ playerId: id(1), position: 'P', number: '1' })
    expect(setup.trackedLineup.battingOrder[0]).toBe(setup.participants[0].id)
    expect(setup.opponentName).toBe('Tigers')
    expect(setup.opponentSlots.every(slot => slot.label === null)).toBe(true)
  })

  it('shows the engine message when the lineup is incomplete', () => {
    const draft = setBaseballDraftFielder(readyDraft(), 5, '')
    const built = buildBaseballMatchSetup(draft, roster, counter())
    expect(built).toEqual({ ok: false, message: 'Assign all 9 defensive positions.' })
  })

  it('trims opponent details and rejects an empty opponent order', () => {
    const draft = { ...readyDraft(), opponentSlots: [{ label: '  Lead-off  ', number: ' 7 ', position: 'cf' }] }
    const built = buildBaseballMatchSetup(draft, roster, counter())
    expect(built.ok && built.setup.opponentSlots[0]).toMatchObject({ label: 'Lead-off', number: '7', position: 'CF' })
    expect(buildBaseballMatchSetup({ ...draft, opponentSlots: [] }, roster, counter()).ok).toBe(false)
  })

  it('creates a local event game that starts, reloads, parks and imports unchanged', () => {
    const built = buildBaseballMatchSetup(readyDraft(), roster, counter())
    if (!built.ok) throw new Error(built.message)
    const baseball = sports.find(entry => entry.id === 'baseball')!
    const created = createBaseballEventGameState({ sport: baseball, setup: built.setup, teamName: 'Aces', date: '2026-09-27' })
    if (!created.ok) throw new Error(created.message)
    expect(created.state.gameDataAuthority).toBe('sport_events')
    expect(created.state.players.map(player => player.id)).toEqual(roster.map(player => player.playerId))
    const started = startBaseballGame(created.state, { recorderUserId: null, occurredAt: '2026-09-27T12:00:00.000Z' })
    if (!started.ok) throw new Error(started.message)

    const reload = (state: GameState) => gameReducer(createInitialState(), {
      type: 'HYDRATE_STATE',
      state: JSON.parse(JSON.stringify(state)) as GameState,
    })
    const reloaded = reload(started.state)
    expect(buildGameSyncFingerprint(reloaded)).toBe(buildGameSyncFingerprint(started.state))
    expect(baseballSportState(reloaded)?.setup).toEqual(built.setup)
    expect(baseballSportState(reloaded)?.projection.status).toBe('in_progress')
    expect(cloudSyncRouteForState(reloaded)).toBe('unsupported')

    saveActiveGameState(started.state, 'user-1')
    parkActiveGame('user-1')
    const exported = exportParkedGames('user-1')
    localStorage.clear()
    importParkedGames(exported, 'user-1')
    const [record] = listParkedGameRecords('user-1')
    expect(buildGameSyncFingerprint(reload(record.gameState))).toBe(buildGameSyncFingerprint(started.state))
  })
})
