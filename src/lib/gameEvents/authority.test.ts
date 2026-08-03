import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import { createInitialState } from '../gameReducer'
import {
  authoritativeGameDataDiagnostics,
  normalizeGameDataAuthority,
  SPORT_EVENTS_AUTHORITY,
} from './authority'

const basketball = sports.find(sport => sport.id === 'basketball')!

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...createInitialState(),
    sport: basketball,
    ...overrides,
  }
}

describe('game data authority diagnostics', () => {
  it('normalizes only the sport_events authority stamp', () => {
    expect(normalizeGameDataAuthority(SPORT_EVENTS_AUTHORITY)).toBe(SPORT_EVENTS_AUTHORITY)
    expect(normalizeGameDataAuthority('aggregates')).toBeNull()
    expect(normalizeGameDataAuthority(null)).toBeNull()
  })

  it('returns no diagnostics when authority is not stamped', () => {
    expect(authoritativeGameDataDiagnostics(baseState({
      gameDataAuthority: null,
      eventStream: null,
      sportGameState: null,
    }), true)).toEqual([])
  })

  it('quarantines missing stream and mismatched sport setup independently', () => {
    const missingStream = authoritativeGameDataDiagnostics(baseState({
      gameDataAuthority: SPORT_EVENTS_AUTHORITY,
      eventStream: null,
      sportGameState: {
        sportId: 'basketball',
        schemaVersion: 1,
        setup: {} as never,
        projection: {} as never,
        capturePreferences: {} as never,
      },
    }), true)
    expect(missingStream).toEqual([
      expect.objectContaining({
        code: 'missing_authoritative_data',
        message: expect.stringContaining('event stream'),
      }),
    ])

    const mismatchedSport = authoritativeGameDataDiagnostics(baseState({
      gameDataAuthority: SPORT_EVENTS_AUTHORITY,
      eventStream: {
        version: 1,
        events: [],
      },
      sportGameState: {
        sportId: 'soccer',
        schemaVersion: 1,
        setup: {} as never,
        projection: {} as never,
        capturePreferences: {} as never,
      },
    }), true)
    expect(mismatchedSport).toEqual([
      expect.objectContaining({
        code: 'missing_authoritative_data',
        message: expect.stringContaining('sport setup'),
      }),
    ])
  })

  it('skips sport-setup quarantine when sport state is not required', () => {
    const diagnostics = authoritativeGameDataDiagnostics(baseState({
      gameDataAuthority: SPORT_EVENTS_AUTHORITY,
      eventStream: {
        version: 1,
        events: [],
      },
      sportGameState: null,
    }), false)

    expect(diagnostics).toEqual([])
  })
})
