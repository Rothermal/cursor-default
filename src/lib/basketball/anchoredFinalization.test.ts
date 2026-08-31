import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import { createInitialState } from '../gameReducer'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import {
  BASKETBALL_ANCHORED_FINALIZATION_BLOCKER_ORDER,
  evaluateBasketballAnchoredFinalization,
  type BasketballAnchoredFinalizationBlockerCode,
} from './anchoredFinalization'
import { makeAnchoredCanonicalAggregateSource } from './aggregateTestFixtures'
import {
  basketballCanonicalAuthorityState,
  type BasketballCanonicalPublication,
} from './finalization'

const basketball = sports.find(sport => sport.id === 'basketball')!

describe('Basketball anchored finalization readiness', () => {
  it('does not apply to clockless authority', () => {
    expect(evaluateBasketballAnchoredFinalization(createInitialState())).toEqual({
      applicable: false,
      blockers: [],
    })
  })

  it('accepts complete, abandoned, and completed-overtime histories', () => {
    expect(codes(authorityState())).toEqual([])
    expect(codes(authorityState('abandoned'))).toEqual([])

    const overtime = authorityState()
    const projection = basketballProjection(overtime)
    projection.startedPeriodIds.push('overtime-1')
    projection.completedPeriodIds.push('overtime-1')
    expect(codes(overtime)).toEqual([])
  })

  it('reports every projection blocker independently', () => {
    expect(codes(withProjection(state => {
      state.status = 'in_progress'
      state.endReason = null
    }))).toEqual(['terminal_outcome_required'])

    expect(codes(withProjection(state => {
      state.completedPeriodIds = []
    }))).toEqual(['periods_incomplete'])

    expect(codes(withProjection(state => {
      if (!state.clock) throw new Error('Anchored fixture clock is unavailable.')
      state.clock.running = true
      state.clock.anchorElapsedMs = state.clock.elapsedMs
      state.clock.anchorOccurredAt = '2026-08-27T15:00:00.000Z'
      state.clock.lastRunningElapsedMs = state.clock.elapsedMs
    }))).toEqual(['clock_not_paused', 'clock_anchor_unsafe'])

    expect(codes(withProjection(state => {
      const tracked = state.lineup?.sides.tracked
      if (!tracked) throw new Error('Anchored fixture lineup is unavailable.')
      tracked.incompletePeriodIds = ['regulation-1']
    }))).toEqual(['tracked_lineup_incomplete'])

    expect(codes(withProjection(state => {
      const tracked = state.lineup?.sides.tracked
      if (!tracked) throw new Error('Anchored fixture lineup is unavailable.')
      tracked.replacementRequiredParticipantIds = ['participant-1']
    }))).toEqual(['replacement_required'])

    expect(codes(withProjection(state => {
      const tracked = state.lineup?.sides.tracked
      if (!tracked) throw new Error('Anchored fixture lineup is unavailable.')
      tracked.boundaryConfirmationRequired = true
    }))).toEqual(['boundary_review_required'])

    expect(codes(withProjection(state => {
      if (!state.lineup) throw new Error('Anchored fixture lineup is unavailable.')
      state.lineup.enforcedOverridesComplete = false
    }))).toEqual(['equal_play_override_incomplete'])

    expect(codes(withProjection(state => {
      state.score.opponent = state.score.tracked
    }))).toEqual(['completed_game_tied'])
  })

  it('detects a stale persisted clock row independently of paused clock state', () => {
    const state = authorityState()
    const clockStart = state.eventStream?.events.find(event => (
      isGameEventEnvelope(event) && event.eventType === 'basketball.clock_started'
    ))
    if (!clockStart || !isGameEventEnvelope(clockStart)) {
      throw new Error('Anchored fixture clock start is unavailable.')
    }
    clockStart.payload = {
      ...clockStart.payload,
      anchorElapsedMs: Number(clockStart.payload.anchorElapsedMs) + 1,
    }

    expect(codes(state)).toEqual(['clock_anchor_unsafe'])
    expect(codes(state, false)).toEqual(['clock_anchor_unsafe'])
  })

  it('reports corrupt projection sources instead of falling through to cached state', () => {
    const state = authorityState()
    if (!state.eventStream) throw new Error('Anchored fixture stream is unavailable.')
    state.eventStream.events[0] = { invalid: true } as never

    expect(codes(state, false)).toEqual(['source_invalid'])
  })

  it('keeps combined blockers in the shared client/server order', () => {
    const state = withProjection(projection => {
      projection.status = 'in_progress'
      projection.endReason = 'completed'
      projection.completedPeriodIds = []
      projection.score.opponent = projection.score.tracked
      if (!projection.clock || !projection.lineup?.sides.tracked) {
        throw new Error('Anchored fixture authority is unavailable.')
      }
      projection.clock.running = true
      projection.clock.anchorElapsedMs = projection.clock.elapsedMs
      projection.clock.anchorOccurredAt = '2026-08-27T15:00:00.000Z'
      projection.clock.lastRunningElapsedMs = projection.clock.elapsedMs
      projection.lineup.sides.tracked.incompletePeriodIds = ['regulation-1']
      projection.lineup.sides.tracked.replacementRequiredParticipantIds = ['participant-1']
      projection.lineup.sides.tracked.boundaryConfirmationRequired = true
      projection.lineup.enforcedOverridesComplete = false
    })

    expect(codes(state)).toEqual(
      BASKETBALL_ANCHORED_FINALIZATION_BLOCKER_ORDER.filter(code => code !== 'source_invalid')
    )
  })
})

function codes(
  state: GameState,
  projectionComplete = true
): BasketballAnchoredFinalizationBlockerCode[] {
  return evaluateBasketballAnchoredFinalization(state, { projectionComplete })
    .blockers.map(blocker => blocker.code)
}

function withProjection(
  mutate: (projection: ReturnType<typeof basketballProjection>) => void
): GameState {
  const state = authorityState()
  mutate(basketballProjection(state))
  return state
}

function basketballProjection(state: GameState) {
  if (state.sportGameState?.sportId !== 'basketball') {
    throw new Error('Anchored fixture projection is unavailable.')
  }
  return state.sportGameState.projection
}

function authorityState(endReason: 'completed' | 'abandoned' = 'completed'): GameState {
  const source = makeAnchoredCanonicalAggregateSource()
  const snapshot = structuredClone(source.canonicalSnapshot)
  if (endReason === 'abandoned') {
    const terminal = snapshot.eventStream.events[snapshot.eventStream.events.length - 1]
    if (!isGameEventEnvelope(terminal) || terminal.eventType !== 'basketball.match_ended') {
      throw new Error('Anchored fixture terminal event is unavailable.')
    }
    terminal.payload = { ...terminal.payload, reason: 'abandoned' }
  }
  const publication: BasketballCanonicalPublication = {
    publicationId: source.publicationId,
    publicationNumber: source.publicationNumber,
    primaryRecorderId: snapshot.primaryRecorderId,
    primaryDisplayName: 'Primary recorder',
    snapshot,
    snapshotFingerprint: source.snapshotFingerprint,
    finalizedBy: snapshot.primaryRecorderId,
    finalizedByDisplayName: 'Primary recorder',
    finalizedAt: source.finalizedAt,
  }
  const initial = createInitialState()
  const state = basketballCanonicalAuthorityState({
    ...initial,
    sport: basketball,
    cloudSync: {
      ...initial.cloudSync,
      gameId: snapshot.gameId,
      gameStatus: 'final',
    },
  }, publication)
  if (endReason === 'completed') {
    const projection = basketballProjection(state)
    if (state.sportGameState?.sportId !== 'basketball') {
      throw new Error('Anchored fixture setup is unavailable.')
    }
    projection.completedPeriodIds = [
      ...projection.startedPeriodIds,
      ...state.sportGameState.setup.rulesSnapshot.regulationSegments.map(period => period.id),
    ].filter((periodId, index, values) => values.indexOf(periodId) === index)
    projection.score.tracked = projection.score.opponent + 2
  }
  return state
}
