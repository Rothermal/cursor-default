import { describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import { createInitialState } from '../gameReducer'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import { prepareBasketballGameStart } from './commands'
import {
  canOfferBasketballEventCloudEnable,
  enableBasketballEventCloud,
  type EnableBasketballEventCloudDependencies,
} from './enableCloudSync'
import { getBasketballRulesProfile, upgradeBasketballRulesDraftToV3 } from './profiles'
import type { BasketballMatchParticipant } from './types'

const basketball = sports.find(sport => sport.id === 'basketball')!
const readyCapabilities = {
  status: 'ready' as const,
  capabilities: {
    contractVersion: 2 as const,
    migration: 62 as const,
    eventTransportVersion: 4 as const,
    recoveryVersion: 1 as const,
    recorderResolutionVersion: 1 as const,
    canonicalFinalizationVersion: 1 as const,
    summaryAuthorityVersion: 1 as const,
    aggregateSourceVersion: 1 as const,
    settingsContractVersion: 1 as const,
  },
}

function localOnlyState(sourceTeam = false, anchored = false): GameState {
  const base = createInitialState()
  const trackedPlayers = Array.from({ length: 5 }, (_, index) => ({
    id: `player-${index + 1}`,
    name: `Player ${index + 1}`,
    number: String(index + 1),
    stats: {},
  }))
  const participantIds = trackedPlayers.map((_, index) =>
    `70000000-0000-4000-8000-${String(index + 101).padStart(12, '0')}`
  )
  const initial: GameState = {
    ...base,
    gameDataAuthority: 'sport_events',
    sport: basketball,
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-25',
    },
    players: [
      { id: TEAM_PLAYER_HOME_ID, name: 'Aces Team', number: '', stats: {}, isTeamPlayer: true },
      { id: TEAM_PLAYER_OPP_ID, name: 'Bears Team', number: '', stats: {}, isTeamPlayer: true },
      ...trackedPlayers,
    ],
  }
  const participants: BasketballMatchParticipant[] = trackedPlayers.map((player, index) => ({
    id: participantIds[index],
    playerId: player.id,
    displayName: player.name,
    number: player.number,
    teamSide: 'tracked',
    initialStatus: 'starter',
    position: null,
    captain: index === 0,
  }))
  const v2Rules = getBasketballRulesProfile('nfhs', 1)!.rules
  const started = prepareBasketballGameStart(initial, {
    recorderUserId: 'user-1',
    occurredAt: '2026-08-25T12:00:00.000Z',
    eventId: '70000000-0000-4000-8000-000000000001',
    participantIds: anchored ? undefined : participantIds,
    reviewedSetup: anchored
      ? {
          rulesSnapshot: upgradeBasketballRulesDraftToV3(v2Rules, 'nfhs'),
          rulesSource: {
            profileId: 'nfhs',
            profileVersion: 1,
            personalRevision: null,
            teamRevision: null,
            hasExplicitMatchOverrides: false,
          },
          sourceTeamId: null,
          sourceSeasonId: null,
          courtOrientation: 'standard',
          version3Setup: {
            participants,
            openingLineups: {
              tracked: { participantIds, shortHandedReason: null },
              opponent: null,
            },
          },
        }
      : undefined,
  })
  if (!started.ok || started.state.sportGameState?.sportId !== 'basketball') {
    throw new Error(started.ok ? 'missing Basketball state' : started.message)
  }
  const state = structuredClone(started.state)
  if (sourceTeam && state.sportGameState?.sportId === 'basketball') {
    state.sportGameState.setup.sourceTeamId = 'team-1'
    state.sportGameState.setup.sourceSeasonId = 'season-1'
  }
  state.cloudSync = {
    ...state.cloudSync,
    eventCloudPolicy: 'local_only',
    seasonId: null,
    teamId: null,
    gameId: null,
    playerIdMap: {},
  }
  return state
}

function dependencies(
  overrides: Partial<EnableBasketballEventCloudDependencies> = {}
): EnableBasketballEventCloudDependencies {
  return {
    loadAppAccess: vi.fn(async () => ({
      access: { status: 'active' as const, appRole: 'user' as const, updatedAt: null },
      error: null,
    })),
    loadCapabilities: vi.fn(async () => readyCapabilities),
    loadTeamRole: vi.fn(async () => 'scorer' as const),
    sync: vi.fn(async input => {
      await input.validateBinding?.('cloud-game-1')
      return {
        seasonId: input.state.sportGameState?.sportId === 'basketball'
          ? input.state.sportGameState.setup.sourceSeasonId
          : null,
        teamId: input.state.sportGameState?.sportId === 'basketball'
          ? input.state.sportGameState.setup.sourceTeamId
          : null,
        gameId: 'cloud-game-1',
        gameStatus: 'in_progress',
        playerIdMap: { 'player-1': 'cloud-player-1' },
        syncedAt: '2026-08-25T12:01:00.000Z',
        syncedState: input.state,
      }
    }),
    ...overrides,
  }
}

describe('Basketball local-only cloud enable', () => {
  it('offers the command only for an exact signed-in recorder owner', () => {
    const state = localOnlyState()
    expect(canOfferBasketballEventCloudEnable(state, 'user-1')).toBe(true)
    expect(canOfferBasketballEventCloudEnable(state, 'user-2')).toBe(false)
    expect(canOfferBasketballEventCloudEnable(state, null)).toBe(false)
  })

  it('hides the command for a missing stream, cloud binding, or non-local-only policy', () => {
    const missingStream = localOnlyState()
    missingStream.eventStream = null
    expect(canOfferBasketballEventCloudEnable(missingStream, 'user-1')).toBe(false)

    const bound = localOnlyState()
    bound.cloudSync.gameId = 'cloud-game-1'
    expect(canOfferBasketballEventCloudEnable(bound, 'user-1')).toBe(false)

    const automatic = localOnlyState()
    automatic.cloudSync.eventCloudPolicy = 'automatic'
    expect(canOfferBasketballEventCloudEnable(automatic, 'user-1')).toBe(false)

    const malformed = localOnlyState()
    Object.assign(malformed.cloudSync, { eventCloudPolicy: 'unexpected' })
    expect(canOfferBasketballEventCloudEnable(malformed, 'user-1')).toBe(false)
  })

  it('blocks anchored games at both offer and command layers until BKE-6D', async () => {
    const state = localOnlyState(false, true)
    const deps = dependencies()

    expect(canOfferBasketballEventCloudEnable(state, 'user-1')).toBe(false)
    await expect(enableBasketballEventCloud({
      state,
      userId: 'user-1',
      localGameId: 'local-1',
    }, deps)).rejects.toThrow('BKE-6D')
    expect(deps.loadAppAccess).not.toHaveBeenCalled()
    expect(deps.loadCapabilities).not.toHaveBeenCalled()
    expect(deps.sync).not.toHaveBeenCalled()
  })

  it('fresh-checks access and capability before returning a confirmed automatic binding', async () => {
    const deps = dependencies()
    const assertCurrent = vi.fn()
    const validateBinding = vi.fn()
    const original = localOnlyState()
    const result = await enableBasketballEventCloud({
      state: original,
      userId: 'user-1',
      localGameId: 'local-1',
      assertCurrent,
      validateBinding,
    }, deps)

    expect(deps.loadAppAccess).toHaveBeenCalledOnce()
    expect(deps.loadCapabilities).toHaveBeenCalledWith('user-1')
    expect(deps.loadTeamRole).not.toHaveBeenCalled()
    expect(assertCurrent).toHaveBeenCalledOnce()
    expect(validateBinding).toHaveBeenCalledWith('cloud-game-1')
    expect(deps.sync).toHaveBeenCalledWith(expect.objectContaining({
      state: expect.objectContaining({
        cloudSync: expect.objectContaining({ eventCloudPolicy: 'automatic' }),
      }),
    }))
    expect(result).toMatchObject({
      cloudGameId: 'cloud-game-1',
      state: {
        cloudSync: {
          eventCloudPolicy: 'automatic',
          gameId: 'cloud-game-1',
          status: 'synced',
          lastSyncedGameFingerprint: expect.any(String),
        },
      },
    })
    expect(original.cloudSync).toMatchObject({
      eventCloudPolicy: 'local_only',
      gameId: null,
    })
  })

  it('requires a fresh tracking role for a team-sourced game', async () => {
    const deps = dependencies()
    await enableBasketballEventCloud({
      state: localOnlyState(true),
      userId: 'user-1',
      localGameId: 'local-1',
    }, deps)
    expect(deps.loadTeamRole).toHaveBeenCalledWith('team-1')
  })

  it('fails before transport when current team access is read-only', async () => {
    const deps = dependencies({ loadTeamRole: vi.fn(async () => 'viewer' as const) })
    await expect(enableBasketballEventCloud({
      state: localOnlyState(true),
      userId: 'user-1',
      localGameId: 'local-1',
    }, deps)).rejects.toThrow('current team role')
    expect(deps.loadCapabilities).not.toHaveBeenCalled()
    expect(deps.sync).not.toHaveBeenCalled()
  })

  it('fails before transport when app access is no longer active', async () => {
    const deps = dependencies({
      loadAppAccess: vi.fn(async () => ({
        access: { status: 'suspended' as const, appRole: 'user' as const, updatedAt: null },
        error: null,
      })),
    })
    await expect(enableBasketballEventCloud({
      state: localOnlyState(),
      userId: 'user-1',
      localGameId: 'local-1',
    }, deps)).rejects.toThrow('account is not active')
    expect(deps.sync).not.toHaveBeenCalled()
  })

  it('fails before transport when the fresh release contract is unavailable', async () => {
    const deps = dependencies({
      loadCapabilities: vi.fn(async () => ({
        status: 'offline' as const,
        error: 'Basketball event cloud support could not be checked while offline.',
      })),
    })
    await expect(enableBasketballEventCloud({
      state: localOnlyState(),
      userId: 'user-1',
      localGameId: 'local-1',
    }, deps)).rejects.toThrow('could not be checked while offline')
    expect(deps.sync).not.toHaveBeenCalled()
  })

  it('rejects mixed recorder ownership and unexpected local binding evidence', async () => {
    const mixed = localOnlyState()
    const first = mixed.eventStream!.events[0] as Record<string, unknown>
    first.recorderUserId = 'user-2'
    const deps = dependencies()
    await expect(enableBasketballEventCloud({
      state: mixed,
      userId: 'user-1',
      localGameId: 'local-1',
    }, deps)).rejects.toThrow('owner of this Basketball recorder stream')

    const bound = localOnlyState()
    bound.cloudSync.gameId = 'unexpected-game'
    await expect(enableBasketballEventCloud({
      state: bound,
      userId: 'user-1',
      localGameId: 'local-1',
    }, deps)).rejects.toThrow('unexpected cloud binding metadata')
    expect(deps.sync).not.toHaveBeenCalled()
  })

  it('rechecks the local snapshot after asynchronous preflight', async () => {
    const deps = dependencies()
    await expect(enableBasketballEventCloud({
      state: localOnlyState(),
      userId: 'user-1',
      localGameId: 'local-1',
      assertCurrent: () => { throw new Error('game changed') },
    }, deps)).rejects.toThrow('game changed')
    expect(deps.sync).not.toHaveBeenCalled()
  })

  it('leaves the caller state untouched when upload or checkpoint fails', async () => {
    const original = localOnlyState()
    const before = structuredClone(original)
    const deps = dependencies({
      sync: vi.fn(async () => { throw new Error('Basketball event checkpoint failed') }),
    })

    await expect(enableBasketballEventCloud({
      state: original,
      userId: 'user-1',
      localGameId: 'local-1',
    }, deps)).rejects.toThrow('checkpoint failed')
    expect(original).toEqual(before)
    expect(original.cloudSync).toMatchObject({
      eventCloudPolicy: 'local_only',
      gameId: null,
    })
  })
})
