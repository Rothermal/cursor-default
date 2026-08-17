import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import { prepareBasketballGameStart } from './commands'
import {
  BASKETBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION,
  createBasketballCanonicalSnapshot,
  EVENT_PLATFORM_CANONICAL_ENVELOPE_VERSION,
  parseBasketballCanonicalSnapshot,
} from './finalization'

const basketball = sports.find(sport => sport.id === 'basketball')!
const recorderId = 'recorder-1'

function player(id: string, name: string, number = ''): Player {
  return { id, name, number, stats: {} }
}

function setupState(): GameState {
  return {
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-16',
    },
    players: [
      { ...player(TEAM_PLAYER_HOME_ID, 'Aces Team'), isTeamPlayer: true },
      { ...player(TEAM_PLAYER_OPP_ID, 'Bears Team'), isTeamPlayer: true },
      player('player-1', 'Alex One', '4'),
      player('player-2', 'Blake Two', '12'),
    ],
    teamStatsConfig: {
      periodsPerGame: 4,
      periodLabels: ['Q1', 'Q2', 'Q3', 'Q4'],
      bonusThreshold: 5,
      doubleBonusThreshold: 5,
      hasOneAndOne: false,
      overtimeLabel: 'OT',
      overtimeFoulsReset: true,
      timeoutsPerPeriod: null,
      timeoutsPerOvertime: null,
    },
  }
}

function startedState(): GameState {
  const result = prepareBasketballGameStart(setupState(), {
    recorderUserId: recorderId,
    occurredAt: '2026-08-16T18:00:00.000Z',
    eventId: '92000000-0000-4000-8000-000000000001',
    participantIds: [
      '92000000-0000-4000-8000-000000000101',
      '92000000-0000-4000-8000-000000000102',
    ],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

describe('Basketball canonical snapshot contract', () => {
  it('creates a source-only versioned snapshot and round-trips it strictly', () => {
    const state = startedState()
    const snapshot = createBasketballCanonicalSnapshot('game-1', recorderId, state)

    expect(snapshot).toMatchObject({
      version: EVENT_PLATFORM_CANONICAL_ENVELOPE_VERSION,
      canonicalSchemaVersion: BASKETBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION,
      sportId: 'basketball',
      gameId: 'game-1',
      primaryRecorderId: recorderId,
      sportGameState: { sportId: 'basketball', version: 1 },
    })
    expect(snapshot.sportGameState).not.toHaveProperty('projection')
    expect(snapshot.sportGameState).not.toHaveProperty('capturePreferences')
    expect(parseBasketballCanonicalSnapshot(structuredClone(snapshot))).toEqual(snapshot)
  })

  it('does not retain mutable references to live event or setup state', () => {
    const state = startedState()
    const snapshot = createBasketballCanonicalSnapshot('game-1', recorderId, state)

    state.eventStream!.events.length = 0
    state.sportGameState!.setup.participants[0].displayName = 'Changed'

    expect(snapshot.eventStream.events).not.toHaveLength(0)
    expect(snapshot.sportGameState.setup.participants[0].displayName).not.toBe('Changed')
  })

  it('rejects unsupported versions, projection caches, and extra envelope fields', () => {
    const snapshot = createBasketballCanonicalSnapshot('game-1', recorderId, startedState())

    expect(() => parseBasketballCanonicalSnapshot({
      ...snapshot,
      canonicalSchemaVersion: 2,
    })).toThrow('invalid')
    expect(() => parseBasketballCanonicalSnapshot({
      ...snapshot,
      projection: {},
    })).toThrow('invalid')
    expect(() => parseBasketballCanonicalSnapshot({
      ...snapshot,
      eventStream: {
        ...snapshot.eventStream,
        projection: {},
      },
    })).toThrow('invalid')
    expect(() => parseBasketballCanonicalSnapshot({
      ...snapshot,
      sportGameState: {
        ...snapshot.sportGameState,
        projection: {},
      },
    })).toThrow('invalid')
  })

  it('rejects malformed, wrong-sport, and mixed-recorder event streams', () => {
    const snapshot = createBasketballCanonicalSnapshot('game-1', recorderId, startedState())
    const malformed = structuredClone(snapshot)
    malformed.eventStream.events[0] = { nope: true }
    expect(() => parseBasketballCanonicalSnapshot(malformed)).toThrow('invalid events')

    const wrongSport = structuredClone(snapshot)
    const wrongSportEvent = wrongSport.eventStream.events[0] as Record<string, unknown>
    wrongSportEvent.sportId = 'soccer'
    expect(() => parseBasketballCanonicalSnapshot(wrongSport)).toThrow('invalid events')

    const mixedRecorder = structuredClone(snapshot)
    const mixedEvent = mixedRecorder.eventStream.events[0] as Record<string, unknown>
    mixedEvent.recorderUserId = 'recorder-2'
    expect(() => parseBasketballCanonicalSnapshot(mixedRecorder)).toThrow(
      'do not belong to the primary recorder'
    )
  })

  it('rejects a source that is not a healthy event-backed Basketball game', () => {
    const aggregate = { ...startedState(), gameDataAuthority: null }
    expect(() => createBasketballCanonicalSnapshot('game-1', recorderId, aggregate))
      .toThrow('unavailable')

    const wrongRecorder = startedState()
    expect(() => createBasketballCanonicalSnapshot('game-1', 'recorder-2', wrongRecorder))
      .toThrow('do not belong to the primary recorder')
  })
})
