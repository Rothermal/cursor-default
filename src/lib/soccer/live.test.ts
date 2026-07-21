import { describe, expect, it } from 'vitest'
import type { GameState, SportConfig } from '../../types'
import { createInitialState, gameReducer } from '../gameReducer'
import { prepareSoccerKickoff } from './kickoff'
import {
  adjustSoccerClock,
  addSoccerMatchParticipant,
  deleteSoccerHistoryEvent,
  endSoccerMatch,
  endSoccerPeriod,
  inspectSoccerHistory,
  isSoccerHalftimeBreak,
  recordHistoricalSoccerOwnGoal,
  recordHistoricalSoccerShot,
  recordSoccerScoreAdjustment,
  recordSoccerRoleChange,
  recordSoccerDirectionChange,
  recordSoccerOwnGoal,
  recordSoccerShot,
  recordSoccerSubstitution,
  resolveSoccerCaptureSaveOperation,
  resolveSoccerParticipant,
  reopenSoccerMatch,
  restoreSoccerHistoryEvent,
  reviseSoccerOwnGoal,
  reviseSoccerScoreAdjustment,
  reviseSoccerShot,
  soccerAttackingDirectionAt,
  soccerClockDisplayValue,
  soccerPeriodTimings,
  startNextSoccerPeriod,
  toggleSoccerClock,
  updateSoccerHistoryEvent,
} from './live'
import { resolveSoccerMatchRules } from './rules'
import { createSoccerSportGameState, normalizeSportGameState, participantActiveMs } from './state'
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
  it('fails closed when correction type or historical timing is inconsistent', () => {
    expect(resolveSoccerCaptureSaveOperation('live', 'soccer.shot', null, false))
      .toEqual({ ok: true, operation: 'record_live' })
    expect(resolveSoccerCaptureSaveOperation('historical', 'soccer.shot', null, true))
      .toEqual({ ok: true, operation: 'record_historical' })
    expect(resolveSoccerCaptureSaveOperation('edit', 'soccer.own_goal', 'soccer.own_goal', true))
      .toEqual({ ok: true, operation: 'revise' })
    expect(resolveSoccerCaptureSaveOperation('edit', 'soccer.own_goal', 'soccer.shot', true))
      .toMatchObject({ ok: false })
    expect(resolveSoccerCaptureSaveOperation('historical', 'soccer.shot', null, false))
      .toMatchObject({ ok: false })
  })

  it('records a located tracked shot through stable participant actors', () => {
    const result = recordSoccerShot(kickedOffState(), {
      teamSide: 'tracked',
      outcome: 'goal',
      situation: 'open_play',
      location: { x: 0.84, y: 0.42, attackingDirection: 'left_to_right' },
      shooter: { kind: 'participant', participantId: 'match-defender' },
      primaryCreator: { kind: 'participant', participantId: 'match-keeper' },
    }, {
      recorderUserId,
      nowMs: kickoffAt + 10_000,
      eventIds: [uuid(4)],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.homeTeamScore).toBe(1)
    expect(result.state.players.find(player => player.id === 'defender')?.stats).toMatchObject({
      soc_goal: 1,
      soc_shot: 1,
      soc_sot: 1,
    })
    const events = result.state.eventStream?.events ?? []
    expect(events[events.length - 1]).toMatchObject({
      eventType: 'soccer.shot',
      teamSide: 'tracked',
      location: { x: 0.84, y: 0.42, attackingDirection: 'left_to_right' },
      actors: [
        { role: 'shooter', kind: 'player', participantId: 'match-defender', playerId: 'defender' },
        { role: 'creator_primary', kind: 'player', participantId: 'match-keeper', playerId: 'keeper' },
      ],
    })
  })

  it('records opponent saves and tracked own goals against the on-field goalkeeper', () => {
    const saved = recordSoccerShot(kickedOffState(), {
      teamSide: 'opponent',
      outcome: 'saved',
      situation: 'penalty',
      location: null,
      shooter: { kind: 'unknown', label: 'Opponent 9' },
      goalkeeper: { kind: 'participant', participantId: 'match-keeper' },
    }, {
      recorderUserId,
      nowMs: kickoffAt + 10_000,
      eventIds: [uuid(4)],
    })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    const ownGoal = recordSoccerOwnGoal(saved.state, {
      teamSide: 'opponent',
      location: { x: 0.08, y: 0.5, attackingDirection: 'right_to_left' },
      ownGoalBy: { kind: 'participant', participantId: 'match-defender' },
      goalkeeper: { kind: 'participant', participantId: 'match-keeper' },
    }, {
      recorderUserId,
      nowMs: kickoffAt + 20_000,
      eventIds: [uuid(5)],
    })
    expect(ownGoal.ok).toBe(true)
    if (!ownGoal.ok) return
    expect(ownGoal.state.opponentScore).toBe(1)
    expect(ownGoal.state.players.find(player => player.id === 'keeper')?.stats).toMatchObject({
      soc_gk_save: 1,
      soc_gk_ga: 1,
      soc_gk_sot_faced: 1,
      soc_gk_pen_faced: 1,
      soc_gk_pen_save: 1,
    })
  })

  it('persists capture preferences through reducer updates and normalization', () => {
    const state = gameReducer(kickedOffState(), {
      type: 'SET_SOCCER_CAPTURE_PREFERENCES',
      preferences: {
        teamSide: 'opponent',
        selectedParticipantId: 'match-defender',
        selectionInitialized: true,
      },
    })

    expect(state.sportGameState?.capturePreferences).toEqual({
      teamSide: 'opponent',
      selectedParticipantId: 'match-defender',
      selectionInitialized: true,
      captureMode: 'shot',
    })
    expect(normalizeSportGameState(structuredClone(state.sportGameState))?.capturePreferences).toEqual({
      teamSide: 'opponent',
      selectedParticipantId: 'match-defender',
      selectionInitialized: true,
      captureMode: 'shot',
    })
  })

  it('adds and revises a historical shot within recorded period bounds', () => {
    const ended = endSoccerPeriod(kickedOffState(), {
      recorderUserId,
      nowMs: kickoffAt + 60_000,
      eventIds: [uuid(4), uuid(5)],
    })
    expect(ended.ok).toBe(true)
    if (!ended.ok) return
    expect(soccerPeriodTimings(ended.state, kickoffAt + 90_000)).toEqual([{
      period: { id: 'regulation-1', order: 1 },
      label: 'First Half',
      startElapsedMs: 0,
      endElapsedMs: 60_000,
    }])

    const added = recordHistoricalSoccerShot(ended.state, {
      teamSide: 'tracked',
      outcome: 'goal',
      situation: 'open_play',
      location: null,
      shooter: { kind: 'participant', participantId: 'match-defender' },
    }, {
      period: { id: 'regulation-1', order: 1 },
      elapsedMs: 30_000,
    }, {
      recorderUserId,
      nowMs: kickoffAt + 90_000,
      eventIds: [uuid(6)],
    })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(added.state.homeTeamScore).toBe(1)

    const shot = inspectSoccerHistory(added.state).activeEvents.find(event => event.id === uuid(6))
    if (!shot) throw new Error('historical shot missing')
    const revised = reviseSoccerShot(added.state, shot.id, {
      teamSide: 'opponent',
      outcome: 'saved',
      situation: 'open_play',
      location: null,
      shooter: { kind: 'unknown', label: 'Opponent 10' },
      goalkeeper: { kind: 'participant', participantId: 'match-keeper' },
    }, {
      period: { id: 'regulation-1', order: 1 },
      elapsedMs: 40_000,
    }, '2026-07-18T12:02:00.000Z')
    expect(revised.ok).toBe(true)
    if (!revised.ok) return
    expect(revised.inspection.complete).toBe(true)
    expect(revised.state.homeTeamScore).toBe(0)
    expect(revised.state.players.find(player => player.id === 'keeper')?.stats.soc_gk_save).toBe(1)
  })

  it('records signed historical score adjustments and rejects out-of-bounds time', () => {
    const ended = endSoccerPeriod(kickedOffState(), {
      recorderUserId,
      nowMs: kickoffAt + 60_000,
      eventIds: [uuid(4), uuid(5)],
    })
    expect(ended.ok).toBe(true)
    if (!ended.ok) return
    const moment = { period: { id: 'regulation-1', order: 1 }, elapsedMs: 45_000 }
    const adjusted = recordSoccerScoreAdjustment(ended.state, {
      teamSide: 'tracked',
      delta: 1,
      reason: 'Official scoring correction',
    }, moment, {
      recorderUserId,
      nowMs: kickoffAt + 90_000,
      eventIds: [uuid(6)],
    })
    expect(adjusted.ok).toBe(true)
    if (!adjusted.ok) return
    expect(adjusted.state.homeTeamScore).toBe(1)

    const adjustment = inspectSoccerHistory(adjusted.state).activeEvents.find(event => event.id === uuid(6))
    if (!adjustment) throw new Error('score adjustment missing')
    const revised = reviseSoccerScoreAdjustment(adjusted.state, adjustment.id, {
      teamSide: 'tracked',
      delta: 1,
      reason: 'Updated official correction',
    }, moment, '2026-07-18T12:03:00.000Z')
    expect(revised.ok).toBe(true)
    if (!revised.ok) return
    expect(revised.inspection.activeEvents.find(event => event.id === adjustment.id)).toMatchObject({
      revision: 2,
      payload: { delta: 1, reason: 'Updated official correction' },
    })

    const rejected = recordHistoricalSoccerShot(revised.state, {
      teamSide: 'tracked',
      outcome: 'off_target',
      situation: 'open_play',
      location: null,
      shooter: { kind: 'team', label: 'Aces' },
    }, {
      period: { id: 'regulation-1', order: 1 },
      elapsedMs: 61_000,
    }, { recorderUserId, nowMs: kickoffAt + 90_000, eventIds: [uuid(7)] })
    expect(rejected).toMatchObject({ ok: false, message: 'The selected time is outside the recorded period bounds.' })
  })

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
    const halftimeProjection = ended.state.sportGameState?.projection
    if (!halftimeProjection) throw new Error('soccer projection missing')
    expect(isSoccerHalftimeBreak(halftimeProjection)).toBe(true)

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
    expect(soccerAttackingDirectionAt(started.state, {
      period: { id: 'regulation-2', order: 2 },
      elapsedMs: 65_000,
    })).toBe('right_to_left')

    const secondBreak = endSoccerPeriod(started.state, {
      recorderUserId,
      nowMs: kickoffAt + 125_000,
      eventIds: [uuid(8), uuid(9)],
    })
    expect(secondBreak.ok).toBe(true)
    if (!secondBreak.ok) return
    const secondBreakProjection = secondBreak.state.sportGameState?.projection
    if (!secondBreakProjection) throw new Error('soccer projection missing')
    expect(isSoccerHalftimeBreak(secondBreakProjection)).toBe(false)
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
      { recorderUserId, nowMs: kickoffAt + 60_000, eventIds: [uuid(4)] }
    )
    expect(adjusted.ok).toBe(true)
    if (!adjusted.ok) return
    const display = soccerClockDisplayValue(adjusted.state, kickoffAt + 70_000)
    expect(display).toMatchObject({
      primary: '00:55',
      canonicalElapsedMs: 55_000,
      periodElapsedMs: 55_000,
    })
    expect(adjusted.state.eventStream?.events).toHaveLength(4)
    const projection = adjusted.state.sportGameState?.projection
    const keeper = projection?.participants['match-keeper']
    if (!projection || !keeper) throw new Error('projected goalkeeper missing')
    expect(participantActiveMs(keeper, projection, kickoffAt + 70_000)).toBe(55_000)
  })

  it('ends an in-progress match with an atomic pause and explicitly reopens it', () => {
    const ended = endSoccerMatch(
      kickedOffState(),
      'suspended',
      { recorderUserId, nowMs: kickoffAt + 90_000, eventIds: [uuid(4), uuid(5)] }
    )
    expect(ended.ok).toBe(true)
    if (!ended.ok) return
    expect(ended.state.sportGameState?.projection.status).toBe('suspended')
    expect(ended.state.sportGameState?.projection.clock.running).toBe(false)

    const reopened = reopenSoccerMatch(
      ended.state,
      'Resume play',
      { recorderUserId, nowMs: kickoffAt + 100_000, eventIds: [uuid(6)] }
    )
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.state.sportGameState?.projection.status).toBe('in_progress')
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

  it('adds, revises, deletes, and restores a historical own goal', () => {
    const ended = endSoccerPeriod(kickedOffState(), {
      recorderUserId,
      nowMs: kickoffAt + 60_000,
      eventIds: [uuid(4), uuid(5)],
    })
    expect(ended.ok).toBe(true)
    if (!ended.ok) return

    const added = recordHistoricalSoccerOwnGoal(ended.state, {
      teamSide: 'opponent',
      location: { x: 0.12, y: 0.48, attackingDirection: 'right_to_left' },
      ownGoalBy: { kind: 'participant', participantId: 'match-defender' },
      goalkeeper: { kind: 'participant', participantId: 'match-keeper' },
    }, {
      period: { id: 'regulation-1', order: 1 },
      elapsedMs: 25_000,
    }, {
      recorderUserId,
      nowMs: kickoffAt + 90_000,
      eventIds: [uuid(6)],
    })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(added.state.opponentScore).toBe(1)

    const ownGoal = inspectSoccerHistory(added.state).activeEvents.find(event => event.id === uuid(6))
    if (!ownGoal) throw new Error('historical own goal missing')
    const revised = reviseSoccerOwnGoal(added.state, ownGoal.id, {
      teamSide: 'tracked',
      location: { x: 0.88, y: 0.5, attackingDirection: 'left_to_right' },
      ownGoalBy: { kind: 'unknown', label: 'Opponent 4' },
    }, {
      period: { id: 'regulation-1', order: 1 },
      elapsedMs: 35_000,
    }, '2026-07-18T12:02:00.000Z')
    expect(revised.ok).toBe(true)
    if (!revised.ok) return
    expect(revised.state.homeTeamScore).toBe(1)
    expect(revised.state.opponentScore).toBe(0)

    const deleted = deleteSoccerHistoryEvent(revised.state, ownGoal.id, '2026-07-18T12:03:00.000Z')
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    expect(deleted.state.homeTeamScore).toBe(0)
    expect(inspectSoccerHistory(deleted.state).deletedEvents.some(event => event.id === ownGoal.id)).toBe(true)

    const restored = restoreSoccerHistoryEvent(deleted.state, ownGoal.id, '2026-07-18T12:04:00.000Z')
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.state.homeTeamScore).toBe(1)
    expect(inspectSoccerHistory(restored.state).activeEvents.some(event => event.id === ownGoal.id)).toBe(true)
  })

  it('records direction changes and late participant resolve through live actions', () => {
    const flipped = recordSoccerDirectionChange(kickedOffState(), 'right_to_left', {
      recorderUserId,
      nowMs: kickoffAt + 5_000,
      eventIds: [uuid(4)],
    })
    expect(flipped.ok).toBe(true)
    if (!flipped.ok) return
    expect(flipped.state.sportGameState?.projection.attackingDirection).toBe('right_to_left')
    expect(soccerAttackingDirectionAt(flipped.state, {
      period: { id: 'regulation-1', order: 1 },
      elapsedMs: 5_000,
    })).toBe('right_to_left')

    const anonymous = {
      id: 'match-late',
      kind: 'anonymous' as const,
      playerId: null,
      displayName: 'Trialist',
      number: '99',
      initialStatus: 'bench' as const,
      initialRole: { group: 'forward' as const, label: null },
    }
    const added = addSoccerMatchParticipant(flipped.state, anonymous, 'bench', {
      recorderUserId,
      nowMs: kickoffAt + 6_000,
      eventIds: [uuid(5)],
    })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(added.state.sportGameState?.projection.participants['match-late']?.displayName).toBe('Trialist')
    expect(added.state.sportGameState?.projection.participants['match-late']?.playerId).toBeNull()

    const withRosterPlayer: GameState = {
      ...added.state,
      players: [
        ...added.state.players,
        { id: 'late-player', name: 'Late Player', number: '17', stats: {} },
      ],
    }
    const resolved = resolveSoccerParticipant(
      withRosterPlayer,
      'match-late',
      'late-player',
      'Late Player',
      '17',
      {
        recorderUserId,
        nowMs: kickoffAt + 7_000,
        eventIds: [uuid(6)],
      }
    )
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.state.sportGameState?.projection.participants['match-late']).toMatchObject({
      playerId: 'late-player',
      displayName: 'Late Player',
      number: '17',
    })
  })

  it('rejects capture actors that are missing or unlabeled', () => {
    const missing = recordSoccerShot(kickedOffState(), {
      teamSide: 'tracked',
      outcome: 'goal',
      situation: 'open_play',
      location: null,
      shooter: { kind: 'participant', participantId: 'missing-player' },
    }, {
      recorderUserId,
      nowMs: kickoffAt + 10_000,
      eventIds: [uuid(4)],
    })
    expect(missing).toMatchObject({ ok: false, message: 'A selected match participant is unavailable.' })

    const blank = recordSoccerOwnGoal(kickedOffState(), {
      teamSide: 'opponent',
      location: null,
      ownGoalBy: { kind: 'unknown', label: '   ' },
    }, {
      recorderUserId,
      nowMs: kickoffAt + 10_000,
      eventIds: [uuid(4)],
    })
    expect(blank).toMatchObject({ ok: false, message: 'Actor labels cannot be empty.' })

    const paused = endSoccerPeriod(kickedOffState(), {
      recorderUserId,
      nowMs: kickoffAt + 60_000,
      eventIds: [uuid(4), uuid(5)],
    })
    expect(paused.ok).toBe(true)
    if (!paused.ok) return
    const outsidePeriod = recordSoccerShot(paused.state, {
      teamSide: 'tracked',
      outcome: 'goal',
      situation: 'open_play',
      location: null,
      shooter: { kind: 'participant', participantId: 'match-defender' },
    }, {
      recorderUserId,
      nowMs: kickoffAt + 90_000,
      eventIds: [uuid(6)],
    })
    expect(outsidePeriod).toMatchObject({
      ok: false,
      message: 'Shots can only be recorded during an active period.',
    })
  })
})

function uuid(index: number): string {
  return `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}
