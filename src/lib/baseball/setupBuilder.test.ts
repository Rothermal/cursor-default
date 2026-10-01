import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import { createInitialState, gameReducer } from '../gameReducer'
import { exportParkedGames, importParkedGames, listParkedGameRecords, parkActiveGame, saveActiveGameState } from '../gameParking'
import { buildGameSyncFingerprint, cloudSyncRouteForState } from '../gameSyncFingerprint'
import { baseballSportState, startBaseballGame } from './commands'
import { createBaseballMatchRules } from './profiles'
import { defaultBaseballTeamSettings, type BaseballTeamSettingsV1 } from './settings'
import {
  applyBaseballLineupDefaults,
  buildBaseballMatchSetup,
  createBaseballEventGameState,
  createBaseballSetupDraft,
  missingBaseballDefaultPlayers,
  planBaseballTeamPrefill,
  setBaseballDraftFielder,
  setBaseballDraftHand,
  setBaseballDraftRules,
  setBaseballPlayerSelected,
  type BaseballSetupDraft,
  type BaseballSetupRosterPlayer,
  type BaseballTeamSettingsSnapshot,
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

describe('Baseball setup handedness (BSB-4A)', () => {
  it('freezes optional hands into the setup and leaves unknown hands null', () => {
    let draft = setBaseballDraftHand(readyDraft(), id(1), { bats: 'L' })
    draft = setBaseballDraftHand(draft, id(1), { throws: 'L' })
    draft = setBaseballDraftHand(draft, id(2), { bats: 'S' })
    draft = {
      ...draft,
      opponentSlots: draft.opponentSlots.map((slot, index) => (index === 0 ? { ...slot, bats: 'R' as const } : slot)),
      opponentPitcher: { ...draft.opponentPitcher, throws: 'L' },
    }
    const built = buildBaseballMatchSetup(draft, roster, counter())
    if (!built.ok) throw new Error(built.message)
    const byPlayer = new Map(built.setup.participants.map(participant => [participant.playerId, participant]))
    expect(byPlayer.get(id(1))).toMatchObject({ bats: 'L', throws: 'L' })
    expect(byPlayer.get(id(2))).toMatchObject({ bats: 'S', throws: null })
    expect(byPlayer.get(id(3))).toMatchObject({ bats: null, throws: null })
    expect(built.setup.opponentSlots[0].bats).toBe('R')
    expect(built.setup.opponentSlots[1].bats).toBeNull()
    expect(built.setup.opponentPitcher.throws).toBe('L')
  })

  it('clears a hand when the same choice is tapped again', () => {
    const draft = setBaseballDraftHand(setBaseballDraftHand(readyDraft(), id(1), { bats: 'L' }), id(1), { bats: null })
    expect(draft.hands?.[id(1)]).toEqual({ bats: null, throws: null })
  })
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

describe('Baseball team prefill timing', () => {
  const TEAM = 'c0000000-0000-4000-8000-000000000001'
  const revision = (innings: number, battingOrder: string[]): BaseballTeamSettingsV1 => ({
    ...defaultBaseballTeamSettings(),
    ruleOverrides: { scheduledInnings: innings },
    lineupDefaults: { version: 1, battingOrder, defense: {} },
  })
  const cachedRevision1 = revision(5, [id(1), id(2)])
  const cloudRevision2 = revision(6, [id(3), id(4)])

  /** Mirrors the setup page effect: a snapshot either initializes the draft once or does nothing. */
  function run(steps: Array<{ rosterReady: boolean; settings: BaseballTeamSettingsSnapshot; edit?: (draft: BaseballSetupDraft) => BaseballSetupDraft }>) {
    let draft: BaseballSetupDraft | null = null
    let initializedTeamId: string | null = null
    for (const step of steps) {
      const prefill = planBaseballTeamPrefill({
        teamId: TEAM,
        initializedTeamId,
        rosterReady: step.rosterReady,
        roster,
        settings: step.settings,
        sourceSeasonId: null,
        trackedSide: 'home',
        opponentName: '',
      })
      if (prefill) {
        draft = prefill.draft
        initializedTeamId = TEAM
      }
      if (draft && step.edit) draft = step.edit(draft)
    }
    return draft
  }

  it('waits for the first cloud read, so a cache shown during it cannot win', () => {
    const draft = run([
      { rosterReady: false, settings: { settledTeamId: null, status: 'cached', settings: cachedRevision1 } },
      // Roster resolves first while the cloud read is still in flight.
      { rosterReady: true, settings: { settledTeamId: null, status: 'cached', settings: cachedRevision1 } },
      // Cloud revision 2 resolves later.
      { rosterReady: true, settings: { settledTeamId: TEAM, status: 'synced', settings: cloudRevision2 } },
    ])
    expect(draft?.rules.scheduledInnings).toBe(6)
    expect(draft?.battingOrder).toEqual([id(3), id(4)])
  })

  it('uses the device cache when the first cloud read fails and says so', () => {
    const settings = { settledTeamId: TEAM, status: 'cached', settings: cachedRevision1 }
    const prefill = planBaseballTeamPrefill({
      teamId: TEAM, initializedTeamId: null, rosterReady: true, roster, settings,
      sourceSeasonId: null, trackedSide: 'home', opponentName: '',
    })
    expect(prefill?.draft.rules.scheduledInnings).toBe(5)
    expect(prefill?.draft.battingOrder).toEqual([id(1), id(2)])
    expect(prefill?.note).toContain("this device's saved copy")
  })

  it('falls back to standard rules and an empty lineup when nothing usable loads', () => {
    const prefill = planBaseballTeamPrefill({
      teamId: TEAM, initializedTeamId: null, rosterReady: true, roster,
      settings: { settledTeamId: TEAM, status: 'error', settings: cloudRevision2 },
      sourceSeasonId: null, trackedSide: 'home', opponentName: '',
    })
    expect(prefill?.draft.battingOrder).toEqual([])
    expect(prefill?.draft.rules.profileId).toBe('nfhs_baseball')
  })

  it('never replaces an initialized or edited draft on later refreshes', () => {
    const draft = run([
      { rosterReady: true, settings: { settledTeamId: TEAM, status: 'cached', settings: cachedRevision1 } },
      {
        rosterReady: true,
        settings: { settledTeamId: TEAM, status: 'cached', settings: cachedRevision1 },
        edit: current => ({ ...current, battingOrder: [id(9)] }),
      },
      // A focus/online refresh later brings revision 2.
      { rosterReady: true, settings: { settledTeamId: TEAM, status: 'synced', settings: cloudRevision2 } },
    ])
    expect(draft?.battingOrder).toEqual([id(9)])
    expect(draft?.rules.scheduledInnings).toBe(5)
  })

  it('marks a team settled only when its latest read finishes, and resets on scope change', () => {
    const hook = readFileSync(resolve(process.cwd(), 'src/hooks/useSportTeamSettings.ts'), 'utf8')
    expect(hook).toContain('if (requestId === requestRef.current) setSettledTeamId(teamId)')
    const scopeEffect = hook.slice(hook.indexOf('requestRef.current += 1'))
    expect(scopeEffect.indexOf('setSettledTeamId(null)')).toBeLessThan(scopeEffect.indexOf('void refresh()'))
  })
})
