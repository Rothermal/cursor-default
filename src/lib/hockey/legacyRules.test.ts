import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState } from '../../types'
import { createInitialState, gameReducer } from '../gameReducer'
import {
  activateParkedGame,
  exportParkedGames,
  importParkedGames,
  listParkedGameRecords,
  parkActiveGame,
  saveActiveGameState,
} from '../gameParking'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'
import { recordHockeyShot } from './captureCommands'
import { finishDecidedHockeyGame, hockeySportState } from './live'
import { createHockeyMatchRules } from './profiles'
import { hockeyOvertimeSuddenDeath, normalizeHockeyMatchRules, validateHockeyMatchRules } from './rules'
import { resolveHockeySettingsHierarchy } from './settings'
import { ctx, expectOk, projection } from './testFixtures'

/**
 * Literal HKY-1 games, written before `overtime.suddenDeath` existed. They are checked-in
 * JSON rather than built with the profile constructor, so a profile change cannot
 * silently regenerate them (HKY-2 compatibility contract).
 */
function fixture(name: 'hky1-nhl-overtime' | 'hky1-high-school'): GameState {
  return JSON.parse(readFileSync(`src/lib/hockey/fixtures/${name}.json`, 'utf8')) as GameState
}

function rawOvertime(state: GameState): Record<string, unknown> {
  const setup = (state.sportGameState as unknown as { setup: { rulesSnapshot: { overtime: Record<string, unknown> } } }).setup
  return setup.rulesSnapshot.overtime
}

function reload(state: GameState): GameState {
  return gameReducer(createInitialState(), {
    type: 'HYDRATE_STATE',
    state: JSON.parse(JSON.stringify(state)) as GameState,
  })
}

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

const FOUR_KEYS = ['endsPolicy', 'lengthMs', 'repeat', 'skaters']

describe('pre-HKY-2 hockey rules', () => {
  it('are literal four-key snapshots', () => {
    for (const name of ['hky1-nhl-overtime', 'hky1-high-school'] as const) {
      expect(Object.keys(rawOvertime(fixture(name))).sort()).toEqual(FOUR_KEYS)
    }
  })

  it('read as sudden death without being rewritten', () => {
    const rules = hockeySportState(fixture('hky1-nhl-overtime'))!.setup.rulesSnapshot
    expect(validateHockeyMatchRules(rules)).toBeNull()
    expect(hockeyOvertimeSuddenDeath(rules)).toBe(true)
    expect(Object.keys(normalizeHockeyMatchRules(rules)!.overtime!).sort()).toEqual(FOUR_KEYS)
  })

  it('reject a sixth overtime key and a non-boolean suddenDeath, keeping unknown-key rejection', () => {
    const rules = hockeySportState(fixture('hky1-nhl-overtime'))!.setup.rulesSnapshot
    const overtime = rules.overtime!
    expect(validateHockeyMatchRules({ ...rules, overtime: { ...overtime, suddenDeath: true, extra: 1 } })).not.toBeNull()
    expect(validateHockeyMatchRules({ ...rules, overtime: { ...overtime, extra: 1 } })).not.toBeNull()
    expect(validateHockeyMatchRules({ ...rules, overtime: { ...overtime, suddenDeath: 'yes' } })).not.toBeNull()
    expect(validateHockeyMatchRules({ ...rules, overtime: { ...overtime, suddenDeath: false } })).toBeNull()
  })

  it.each(['hky1-nhl-overtime', 'hky1-high-school'] as const)(
    '%s hydrates with its exact snapshot and fingerprint',
    name => {
      const stored = fixture(name)
      const hydrated = reload(stored)
      expect(hockeySportState(hydrated)!.setup).toEqual(hockeySportState(stored)!.setup)
      expect(Object.keys(rawOvertime(hydrated)).sort()).toEqual(FOUR_KEYS)
      expect(buildGameSyncFingerprint(hydrated)).toBe(buildGameSyncFingerprint(stored))
      expect(projection(hydrated)).toMatchObject({
        status: projection(stored).status,
        activePeriodId: projection(stored).activePeriodId,
        clock: projection(stored).clock,
      })
    }
  )

  it.each(['hky1-nhl-overtime', 'hky1-high-school'] as const)('%s parks, resumes and imports unchanged', name => {
    const stored = reload(fixture(name))
    const before = buildGameSyncFingerprint(stored)
    saveActiveGameState(stored, 'user-1')
    parkActiveGame('user-1')
    const [record] = listParkedGameRecords('user-1')
    const resumed = reload(activateParkedGame(record.localGameId, 'user-1')!)
    expect(buildGameSyncFingerprint(resumed)).toBe(before)
    expect(Object.keys(rawOvertime(resumed)).sort()).toEqual(FOUR_KEYS)

    parkActiveGame('user-1')
    const exported = exportParkedGames('user-1')
    localStorage.clear()
    expect(importParkedGames(exported, 'user-1').imported).toBe(1)
    const imported = reload(listParkedGameRecords('user-1')[0].gameState)
    expect(buildGameSyncFingerprint(imported)).toBe(before)
    expect(Object.keys(rawOvertime(imported)).sort()).toEqual(FOUR_KEYS)
  })

  it('decides an HKY-1 overtime game on a goal, as sudden death', () => {
    let state = reload(fixture('hky1-nhl-overtime'))
    expect(projection(state).activePeriodId).toBe('overtime-1')
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' } }, ctx(131)))
    expect(projection(state).decidedInPeriodId).toBe('overtime-1')
    state = expectOk(finishDecidedHockeyGame(state, ctx(132)))
    expect(projection(state)).toMatchObject({ status: 'ended', score: { tracked: 1, opponent: 0 } })
    expect(Object.keys(rawOvertime(state)).sort()).toEqual(FOUR_KEYS)
  })
})

describe('new hockey rules writes', () => {
  it('always carry suddenDeath', () => {
    for (const profile of ['nhl_regular', 'nhl_playoffs', 'high_school_us', 'ncaa'] as const) {
      expect(createHockeyMatchRules(profile).overtime).toMatchObject({ suddenDeath: true })
    }
  })

  it('resolve a stored four-key overtime override to five keys', () => {
    const legacyOvertime = { lengthMs: 300_000, skaters: 3, repeat: false, endsPolicy: 'continue_alternation' }
    const resolved = resolveHockeySettingsHierarchy({
      authority: 'personal',
      personalSettings: {
        settingsSchemaVersion: 1,
        baseProfile: { profileId: 'usa_hockey_youth', profileVersion: 1 },
        ruleOverrides: { overtime: legacyOvertime },
      },
    })
    expect(resolved.ok && resolved.value.rules.overtime).toEqual({ ...legacyOvertime, suddenDeath: true })
    const off = resolveHockeySettingsHierarchy({
      authority: 'personal',
      matchOverrides: { overtime: { ...legacyOvertime, suddenDeath: false } },
    })
    expect(off.ok && off.value.rules.overtime).toMatchObject({ suddenDeath: false })
  })
})
