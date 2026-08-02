import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import { buildGameSyncFingerprint, isAggregateCloudSyncEligible } from '../gameSyncFingerprint'
import { createInitialState } from '../gameReducer'
import { GameEventProjectorRegistry, rebuildGameEventProjection } from '../gameEvents/projection'
import { GameEventRegistry } from '../gameEvents/registry'
import { gameEventProjectors } from '../gameEvents/runtime'
import type { GameEventPeriod } from '../gameEvents/types'
import { normalizeSportGameState, sportSupportsEventGameState } from '../sportGameState/state'
import {
  basketballLifecycleEventDefinitions,
  createBasketballLifecycleEvent,
  type BasketballLifecyclePayloadByType,
} from './events'
import { basketballLifecycleProjector } from './projector'
import {
  createBasketballMatchRules,
  DEFAULT_BASKETBALL_RULES_SOURCE,
  resolveBasketballPeriodSegment,
  validateBasketballMatchRules,
} from './rules'
import {
  createBasketballSportGameState,
  normalizeBasketballSportGameState,
  validateBasketballMatchSetup,
} from './state'
import type {
  BasketballLifecycleEvent,
  BasketballMatchParticipant,
  BasketballMatchSetup,
  BasketballSportGameState,
} from './types'

const registry = new GameEventRegistry(basketballLifecycleEventDefinitions)
const projectors = new GameEventProjectorRegistry([basketballLifecycleProjector])
const occurredAt = '2026-08-01T12:00:00.000Z'

function participant(
  id: string,
  playerId: string | null,
  teamSide: 'tracked' | 'opponent',
  initialStatus: 'starter' | 'bench' | 'dnp' = 'bench'
): BasketballMatchParticipant {
  return {
    id,
    playerId,
    displayName: id,
    number: null,
    teamSide,
    initialStatus,
    position: null,
    captain: false,
  }
}

function setup(): BasketballMatchSetup {
  return {
    version: 1,
    trackedTeamDesignation: 'home',
    sourceTeamId: 'team-1',
    sourceSeasonId: 'season-1',
    rulesSource: structuredClone(DEFAULT_BASKETBALL_RULES_SOURCE),
    rulesSnapshot: createBasketballMatchRules(),
    participants: [
      participant('tracked-1', 'player-1', 'tracked', 'starter'),
      participant('opponent-1', null, 'opponent', 'bench'),
    ],
  }
}

function state(): GameState {
  return {
    ...createInitialState(),
    sport: sports.find(sport => sport.id === 'basketball')!,
    gameInfo: {
      teamName: 'Tracked',
      opponentName: 'Opponent',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-01',
    },
    players: [{ id: 'player-1', name: 'tracked-1', number: '1', stats: {} }],
    sportGameState: createBasketballSportGameState(setup()),
  }
}

function event<TType extends keyof BasketballLifecyclePayloadByType>(
  sequence: number,
  eventType: TType,
  payload: BasketballLifecyclePayloadByType[TType],
  period: GameEventPeriod = { id: 'regulation-1', order: 1 }
): Extract<BasketballLifecycleEvent, { eventType: TType }> {
  return createBasketballLifecycleEvent({
    id: `60000000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`,
    eventType,
    payload,
    recorderUserId: 'recorder-1',
    sequence,
    period,
    occurredAt: new Date(Date.parse(occurredAt) + sequence * 1_000).toISOString(),
  })
}

function periodEvent(
  sequence: number,
  eventType: 'basketball.period_started' | 'basketball.period_ended',
  periodId: string,
  order: number
): BasketballLifecycleEvent {
  return event(sequence, eventType, { periodId, captureCommandId: null }, { id: periodId, order })
}

function project(events: BasketballLifecycleEvent[]) {
  return rebuildGameEventProjection(
    { ...state(), eventStream: { version: 1, events } },
    registry,
    projectors
  )
}

function basketballState(value: GameState['sportGameState']): BasketballSportGameState {
  if (value?.sportId !== 'basketball') throw new Error('Expected Basketball state.')
  return value
}

describe('BKE-1B1 Basketball foundation', () => {
  it('creates stable regulation segments and dynamic overtime identities', () => {
    const rules = createBasketballMatchRules()

    expect(rules.regulationSegments.map(segment => segment.id)).toEqual([
      'regulation-1',
      'regulation-2',
    ])
    expect(resolveBasketballPeriodSegment(rules, 'overtime-2')).toMatchObject({
      id: 'overtime-2',
      label: 'OT 2',
      kind: 'overtime',
      order: 4,
    })
    expect(resolveBasketballPeriodSegment(rules, 'overtime-0')).toBeNull()
  })

  it('rejects inconsistent compatibility fields and duplicate participant ids', () => {
    const rules = createBasketballMatchRules()
    rules.periodLabels[0] = 'Changed'
    expect(validateBasketballMatchRules(rules)).toContain('compatibility fields')

    const duplicate = setup()
    duplicate.participants.push(structuredClone(duplicate.participants[0]))
    expect(validateBasketballMatchSetup(duplicate)).toContain('must be unique')

    const duplicatePlayer = setup()
    duplicatePlayer.participants[1].playerId = 'player-1'
    expect(validateBasketballMatchSetup(duplicatePlayer)).toContain('player ids must be unique')
  })

  it('normalizes immutable setup while discarding persisted projection truth', () => {
    const original = createBasketballSportGameState(setup())
    original.projection.status = 'ended'
    original.projection.score.tracked = 99
    original.capturePreferences.teamSide = 'opponent'
    original.capturePreferences.shotValueOverride = 3
    const raw = structuredClone(original) as unknown as Record<string, unknown>
    const preferences = raw.capturePreferences as Record<string, unknown>
    preferences.courtOrientation = 'invalid'

    const normalized = normalizeBasketballSportGameState(raw)

    expect(normalized?.setup).toEqual(setup())
    expect(normalized?.projection).toMatchObject({
      status: 'not_started',
      score: { tracked: 0, opponent: 0 },
    })
    expect(normalized?.capturePreferences).toMatchObject({
      teamSide: 'opponent',
      shotValueOverride: 3,
      courtOrientation: 'standard',
    })
  })

  it('recognizes Basketball setup through the neutral state registry', () => {
    const sportState = createBasketballSportGameState(setup())
    expect(normalizeSportGameState(structuredClone(sportState))).toEqual(sportState)
    expect(sportSupportsEventGameState('basketball')).toBe(true)
  })

  it('keeps lifecycle definitions strict and neutral events unregistered', () => {
    const started = periodEvent(0, 'basketball.period_started', 'regulation-1', 1)
    expect(registry.inspect(started).ok).toBe(true)
    expect(registry.inspect({ ...started, teamSide: 'neutral' }).ok).toBe(false)
    expect(registry.inspect({ ...started, actors: [{ role: 'team', kind: 'team', label: 'A' }] }).ok)
      .toBe(false)
    expect(registry.inspect({ ...started, payload: { periodId: '', captureCommandId: null } }).ok)
      .toBe(false)
  })

  it('rebuilds periods, late participants, identity resolution, and completion', () => {
    const late = participant('opponent-late', null, 'opponent', 'bench')
    const result = project([
      periodEvent(0, 'basketball.period_started', 'regulation-1', 1),
      event(1, 'basketball.match_roster_added', {
        participant: late,
        destination: 'bench',
        captureCommandId: null,
      }),
      event(2, 'basketball.participant_resolved', {
        participantId: late.id,
        playerId: 'opponent-player',
        displayName: 'Resolved Opponent',
        number: '12',
        captureCommandId: null,
      }),
      periodEvent(3, 'basketball.period_ended', 'regulation-1', 1),
      periodEvent(4, 'basketball.period_started', 'regulation-2', 2),
      event(5, 'basketball.match_ended', {
        reason: 'completed',
        captureCommandId: null,
      }, { id: 'regulation-2', order: 2 }),
    ])
    const projection = basketballState(result.state.sportGameState).projection

    expect(result.inspection.complete).toBe(true)
    expect(projection).toMatchObject({
      status: 'ended',
      currentPeriodId: 'regulation-2',
      startedPeriodIds: ['regulation-1', 'regulation-2'],
      completedPeriodIds: ['regulation-1'],
      endReason: 'completed',
      result: 'draw',
    })
    expect(projection.participants[late.id]).toMatchObject({
      playerId: 'opponent-player',
      displayName: 'Resolved Opponent',
      number: '12',
      teamSide: 'opponent',
      lateAdded: true,
    })
    expect(basketballState(result.state.sportGameState).setup.participants).toHaveLength(2)
  })

  it('appends overtime only after regulation completes in order', () => {
    const result = project([
      periodEvent(0, 'basketball.period_started', 'regulation-1', 1),
      periodEvent(1, 'basketball.period_ended', 'regulation-1', 1),
      periodEvent(2, 'basketball.period_started', 'regulation-2', 2),
      periodEvent(3, 'basketball.period_ended', 'regulation-2', 2),
      periodEvent(4, 'basketball.period_started', 'overtime-1', 3),
    ])

    expect(result.inspection.complete).toBe(true)
    expect(basketballState(result.state.sportGameState).projection.periods[2]).toMatchObject({
      id: 'overtime-1',
      kind: 'overtime',
      order: 3,
    })
  })

  it('reopens suspended and ended histories without mutating their events', () => {
    const suspended = event(1, 'basketball.match_ended', {
      reason: 'suspended',
      captureCommandId: null,
    })
    const reopened = event(2, 'basketball.match_reopened', {
      reason: 'Officials resumed play',
      captureCommandId: null,
    })
    const result = project([
      periodEvent(0, 'basketball.period_started', 'regulation-1', 1),
      suspended,
      reopened,
    ])

    expect(result.inspection.complete).toBe(true)
    expect(basketballState(result.state.sportGameState).projection).toMatchObject({
      status: 'in_progress',
      endedAt: null,
      endReason: null,
      result: 'unresolved',
    })
    expect(result.state.eventStream?.events).toEqual([
      periodEvent(0, 'basketball.period_started', 'regulation-1', 1),
      suspended,
      reopened,
    ])
  })

  it('projects an abandoned match as an explicit terminal result', () => {
    const result = project([
      periodEvent(0, 'basketball.period_started', 'regulation-1', 1),
      event(1, 'basketball.match_ended', {
        reason: 'abandoned',
        captureCommandId: null,
      }),
    ])

    expect(result.inspection.complete).toBe(true)
    expect(basketballState(result.state.sportGameState).projection).toMatchObject({
      status: 'ended',
      endReason: 'abandoned',
      result: 'abandoned',
    })
  })

  it('fails closed for out-of-order periods and duplicate recorder sequences', () => {
    const outOfOrder = project([
      periodEvent(0, 'basketball.period_started', 'regulation-2', 2),
    ])
    expect(outOfOrder.inspection.complete).toBe(false)
    expect(outOfOrder.inspection.diagnostics[0]?.message).toContain('order 1')

    const duplicate = periodEvent(0, 'basketball.period_ended', 'regulation-1', 1)
    duplicate.id = '60000000-0000-4000-8000-000000000099'
    const duplicateResult = project([
      periodEvent(0, 'basketball.period_started', 'regulation-1', 1),
      duplicate,
    ])
    expect(duplicateResult.inspection.complete).toBe(false)
    expect(duplicateResult.inspection.diagnostics[0]?.message).toContain('duplicated')
  })

  it('rejects lifecycle actions attributed to a previous period', () => {
    const result = project([
      periodEvent(0, 'basketball.period_started', 'regulation-1', 1),
      periodEvent(1, 'basketball.period_ended', 'regulation-1', 1),
      periodEvent(2, 'basketball.period_started', 'regulation-2', 2),
      event(3, 'basketball.match_ended', {
        reason: 'completed',
        captureCommandId: null,
      }, { id: 'regulation-1', order: 1 }),
    ])

    expect(result.inspection.complete).toBe(false)
    expect(result.inspection.diagnostics[0]?.message).toContain('current period')
  })

  it('fingerprints setup but excludes projection and capture preferences', () => {
    const base = state()
    const changedRuntime = structuredClone(base)
    const runtimeState = basketballState(changedRuntime.sportGameState)
    runtimeState.projection.status = 'ended'
    runtimeState.capturePreferences.teamSide = 'opponent'

    expect(buildGameSyncFingerprint(changedRuntime)).toBe(buildGameSyncFingerprint(base))

    const changedSetup = structuredClone(base)
    basketballState(changedSetup.sportGameState).setup.trackedTeamDesignation = 'away'
    expect(buildGameSyncFingerprint(changedSetup)).not.toBe(buildGameSyncFingerprint(base))
  })

  it('blocks legacy aggregate sync for recognized Basketball event setup', () => {
    expect(isAggregateCloudSyncEligible({ ...state(), sportGameState: null })).toBe(true)
    expect(isAggregateCloudSyncEligible(state())).toBe(false)
  })

  it('leaves the production Basketball event projector unregistered until BKE-1B3', () => {
    expect(gameEventProjectors.get('basketball')).toBeUndefined()
  })
})
