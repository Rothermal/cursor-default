import { describe, expect, it } from 'vitest'
import type { GameState, SportConfig } from '../../types'
import { createInitialState } from '../gameReducer'
import { prepareSoccerKickoff } from './kickoff'
import {
  adjustSoccerClock,
  endSoccerMatch,
  endSoccerPeriod,
  inspectSoccerHistory,
  recordSoccerRoleChange,
  recordSoccerSubstitution,
  reopenSoccerMatch,
  soccerClockDisplayValue,
  startNextSoccerPeriod,
  toggleSoccerClock,
  updateSoccerHistoryEvent,
} from './live'
import { resolveSoccerMatchRules } from './rules'
import { createSoccerSportGameState } from './state'
import type { SoccerMatchSetup } from './types'

const soccer: SportConfig = {
  id: 'soccer',
  name: 'Soccer',
  icon: 'S',
  theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
  categories: [],
  scoreLabel: 'Goals',
}

const kickoffAt = Date.parse('2026-07-18T12:00:00.000Z')
const recorderUserId = 'user-1'

function setup(): SoccerMatchSetup {
  return {
    version: 1,
    trackedTeamDesignation: 'home',
    firstPeriodAttackingDirection: 'left_to_right',
    sourceTeamId: null,
    sourceSeasonId: null,
    rulesSnapshot: resolveSoccerMatchRules({
      gameOverrides: { maxOnFieldPlayers: 2 },
    }),
    participants: [
      {
        id: 'match-keeper',
        kind: 'player',
        playerId: 'keeper',
        displayName: 'Keeper',
        number: '1',
        initialStatus: 'starter',
        initialRole: { group: 'goalkeeper', label: null },
      },
      {
        id: 'match-defender',
        kind: 'player',
        playerId: 'defender',
        displayName: 'Defender',
        number: '4',
        initialStatus: 'starter',
        initialRole: { group: 'defender', label: null },
      },
      {
        id: 'match-forward',
        kind: 'player',
        playerId: 'forward',
        displayName: 'Forward',
        number: '9',
        initialStatus: 'bench',
        initialRole: { group: 'forward', label: null },
      },
    ],
  }
}

function kickedOffState(matchSetup = setup()): GameState {
  const state: GameState = {
    ...createInitialState(),
    sport: soccer,
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-07-18',
    },
    players: [
      { id: 'keeper', name: 'Keeper', number: '1', stats: {} },
      { id: 'defender', name: 'Defender', number: '4', stats: {} },
      { id: 'forward', name: 'Forward', number: '9', stats: {} },
    ],
    sportGameState: createSoccerSportGameState(matchSetup),
  }
  const result = prepareSoccerKickoff(state, matchSetup, {
    recorderUserId,
    occurredAt: new Date(kickoffAt).toISOString(),
    eventIds: [uuid(1), uuid(2), uuid(3)],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

describe('soccer live match actions', () => {
  it('pauses, ends a period atomically, and starts the next period with its clock', () => {
    const before = kickedOffState()
    const ended = endSoccerPeriod(before, {
      recorderUserId,
      nowMs: kickoffAt + 60_000,
      eventIds: [uuid(4), uuid(5)],
    })
    expect(ended.ok).toBe(true)
    if (!ended.ok) return
    expect(ended.state.eventStream?.events).toHaveLength(5)
    expect(ended.state.sportGameState?.projection).toMatchObject({
      status: 'period_break',
      currentPeriodId: null,
      completedPeriodIds: ['regulation-1'],
      clock: { running: false, elapsedMs: 60_000 },
    })

    const started = startNextSoccerPeriod(ended.state, {
      recorderUserId,
      nowMs: kickoffAt + 65_000,
      eventIds: [uuid(6), uuid(7)],
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(started.state.eventStream?.events).toHaveLength(7)
    expect(started.state.sportGameState?.projection).toMatchObject({
      status: 'in_progress',
      currentPeriodId: 'regulation-2',
      attackingDirection: 'right_to_left',
      clock: { running: true, elapsedMs: 60_000 },
    })
  })

  it('records a running-clock substitution at derived canonical time', () => {
    const result = recordSoccerSubstitution(
      kickedOffState(),
      [{
        playerOutParticipantId: 'match-defender',
        playerInParticipantId: 'match-forward',
        playerInRole: { group: 'forward', label: null },
      }],
      false,
      { recorderUserId, nowMs: kickoffAt + 75_000, eventIds: [uuid(4)] }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const projection = result.state.sportGameState?.projection
    expect(projection?.clock.elapsedMs).toBe(75_000)
    expect(projection?.participants['match-defender'].status).toBe('left')
    expect(projection?.participants['match-forward']).toMatchObject({
      status: 'on_field',
      appearances: 1,
      activeSinceElapsedMs: 75_000,
    })
    expect(projection?.substitutionCount).toBe(1)
    expect(projection?.substitutionWindowCount).toBe(1)
  })

  it('rejects a role change that would remove the only goalkeeper', () => {
    const before = kickedOffState()
    const result = recordSoccerRoleChange(
      before,
      'match-keeper',
      { group: 'defender', label: null },
      { recorderUserId, nowMs: kickoffAt + 30_000, eventIds: [uuid(4)] }
    )
    expect(result).toMatchObject({ ok: false })
    expect(result.state).toBe(before)
    expect(result.state.eventStream?.events).toHaveLength(3)
  })

  it('adjusts a running clock and renders count-up match time without writes', () => {
    const adjusted = adjustSoccerClock(
      kickedOffState(),
      45_000,
      { recorderUserId, nowMs: kickoffAt + 60_000, eventIds: [uuid(4), uuid(5), uuid(6)] }
    )
    expect(adjusted.ok).toBe(true)
    if (!adjusted.ok) return
    const display = soccerClockDisplayValue(adjusted.state, kickoffAt + 70_000)
    expect(display).toMatchObject({
      primary: '00:55',
      canonicalElapsedMs: 55_000,
      periodElapsedMs: 55_000,
    })
  })

  it('ends an in-progress match with an atomic pause and explicitly reopens it', () => {
    const ended = endSoccerMatch(
      kickedOffState(),
      'suspended',
      { recorderUserId, nowMs: kickoffAt + 90_000, eventIds: [uuid(4), uuid(5)] }
    )
    expect(ended.ok).toBe(true)
    if (!ended.ok) return
    expect(ended.state.sportGameState?.projection.status).toBe('ended')
    expect(ended.state.sportGameState?.projection.clock.running).toBe(false)

    const reopened = reopenSoccerMatch(
      ended.state,
      'Resume play',
      { recorderUserId, nowMs: kickoffAt + 100_000, eventIds: [uuid(6)] }
    )
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.state.sportGameState?.projection.status).toBe('period_break')
  })

  it('preserves an invalid historical correction and exposes projection diagnostics', () => {
    const state = kickedOffState()
    const event = inspectSoccerHistory(state).activeEvents.find(
      candidate => candidate.eventType === 'soccer.opening_lineup'
    )
    if (!event) throw new Error('opening lineup event missing')
    const corrected = updateSoccerHistoryEvent(
      state,
      event.id,
      { payload: { starters: [{ participantId: 'match-defender', role: { group: 'defender', label: null } }] } },
      '2026-07-18T12:05:00.000Z'
    )
    expect(corrected.ok).toBe(true)
    if (!corrected.ok) return
    expect(corrected.inspection.complete).toBe(false)
    expect(corrected.inspection.diagnostics[0]?.code).toBe('semantic_validation_failed')
    expect(corrected.state.eventStream?.events).toHaveLength(3)
  })

  it('toggles a running clock to stopped at the rendered time', () => {
    const result = toggleSoccerClock(kickedOffState(), {
      recorderUserId,
      nowMs: kickoffAt + 12_345,
      eventIds: [uuid(4)],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.sportGameState?.projection.clock).toMatchObject({
      running: false,
      elapsedMs: 12_345,
      anchorOccurredAt: null,
    })
  })

  it('shows per-period countdown overrun at a period break', () => {
    const matchSetup = setup()
    matchSetup.rulesSnapshot.clockDirection = 'count_down'
    matchSetup.rulesSnapshot.clockDisplay = 'per_period'
    const ended = endSoccerPeriod(kickedOffState(matchSetup), {
      recorderUserId,
      nowMs: kickoffAt + 46 * 60_000,
      eventIds: [uuid(4), uuid(5)],
    })
    expect(ended.ok).toBe(true)
    if (!ended.ok) return
    expect(soccerClockDisplayValue(ended.state, kickoffAt + 60 * 60_000)).toMatchObject({
      primary: '00:00',
      overrun: '+01:00',
      periodElapsedMs: 46 * 60_000,
    })
  })
})

function uuid(index: number): string {
  return `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}
