import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { gameEventRegistry } from '../gameEvents/runtime'
import { inspectGameEventStream } from '../gameEvents/stream'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import { captureBasketballCourtEvent, prepareBasketballGameStart, switchBasketballEnds } from './commands'
import { undoLatestBasketballCourtCapture } from './courtCorrections'
import {
  applyBasketballFoulFreeThrowChange,
  buildBasketballFoulFreeThrowEditDraft,
  buildBasketballHistoricalFoulFreeThrowDraft,
  previewBasketballFoulFreeThrowEdit,
} from './foulFreeThrowEditCommands'
import { captureBasketballFoul } from './foulFreeThrowCommands'
import { basketballPlaySpotText, isValidBasketballPlayLocation } from './playLocations'
import {
  applyBasketballRelatedEventEdit,
  buildBasketballRelatedEventEditDraft,
  previewBasketballRelatedEventEdit,
} from './relatedEventEditCommands'
import { basketballLocationFrameError } from './statProjection'
import { buildBasketballTimelineReview } from './timeline'
import type { BasketballAttackingDirection, BasketballMatchEvent } from './types'

const basketball = sports.find(sport => sport.id === 'basketball')!
const recorder = 'recorder-1'
const base = Date.parse('2026-01-10T14:00:00.000Z')
const at = (seconds: number) => new Date(base + seconds * 1000).toISOString()
const id = (value: number) => `78000000-0000-4000-8000-${String(value).padStart(12, '0')}`

function player(playerId: string, name: string, number = ''): Player {
  return { id: playerId, name, number, stats: {} }
}

function started(tipOffDirection?: BasketballAttackingDirection): GameState {
  const setup: GameState = {
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    gameInfo: { teamName: 'Aces', opponentName: 'Bears', tournamentName: '', tournamentId: null, date: '2026-10-12' },
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
  const result = prepareBasketballGameStart(setup, {
    recorderUserId: recorder,
    occurredAt: at(0),
    eventId: id(1),
    tipOffEventId: id(2),
    participantIds: [id(101), id(102)],
    tipOffDirection,
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function play(
  state: GameState,
  playerId: string,
  statId: 'oreb' | 'dreb' | 'stl' | 'blk' | 'ast' | 'to',
  point: { x: number; y: number } | undefined,
  seconds: number,
  eventId: string
): GameState {
  const result = captureBasketballCourtEvent(state, {
    recorderUserId: recorder,
    playerId,
    fullCourtPoint: point,
    event: { kind: 'stat', statId },
    occurredAt: at(seconds),
    eventIds: [eventId],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function foul(state: GameState, point: { x: number; y: number } | null, seconds: number, n: number): GameState {
  const result = captureBasketballFoul(state, {
    recorderUserId: recorder,
    teamSide: 'tracked',
    offender: { kind: 'player', playerId: 'player-1' },
    class: 'personal',
    context: 'common',
    fullCourtPoint: point,
    occurredAt: at(seconds),
    eventIds: [id(n), id(n + 1)],
    captureCommandId: id(n + 2),
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function event(state: GameState, eventId: string): BasketballMatchEvent {
  const found = state.eventStream?.events.find(candidate => isGameEventEnvelope(candidate) && candidate.id === eventId)
  if (!found) throw new Error(`Missing ${eventId}`)
  return found as unknown as BasketballMatchEvent
}

function flipped(state: GameState): GameState {
  if (state.sportGameState?.sportId !== 'basketball') throw new Error('Missing Basketball state')
  const current = state.sportGameState
  return {
    ...state,
    sportGameState: { ...current, capturePreferences: { ...current.capturePreferences, courtOrientation: 'flipped' } },
  }
}

describe('BKE-7C located plays', () => {
  it('keeps the spot of a court-tap rebound, steal, block and turnover with the acting side’s direction', () => {
    let state = started('left_to_right')
    state = play(state, 'player-1', 'dreb', { x: 0.1, y: 0.4 }, 10, id(201))
    state = play(state, 'player-2', 'stl', { x: 0.6, y: 0.5 }, 20, id(202))
    state = play(state, TEAM_PLAYER_OPP_ID, 'blk', { x: 0.9, y: 0.5 }, 30, id(203))
    state = play(state, 'player-1', 'to', { x: 0.4, y: 0.2 }, 40, id(204))

    expect(event(state, id(201))).toMatchObject({
      eventType: 'basketball.rebound',
      location: { x: 0.1, y: 0.4, attackingDirection: 'left_to_right' },
    })
    expect(event(state, id(202)).location?.attackingDirection).toBe('left_to_right')
    // The opponent attacks the other way.
    expect(event(state, id(203)).location).toEqual({ x: 0.9, y: 0.5, attackingDirection: 'right_to_left' })
    expect(event(state, id(204))).toMatchObject({
      eventType: 'basketball.turnover',
      location: { x: 0.4, y: 0.2, attackingDirection: 'left_to_right' },
    })
    expect(inspectGameEventStream(state.eventStream!, gameEventRegistry).complete).toBe(true)
  })

  it('follows Switch ends for the stamp', () => {
    let state = started('left_to_right')
    const result = switchBasketballEnds(state, { recorderUserId: recorder, occurredAt: at(5), eventId: id(3) })
    if (!result.ok) throw new Error(result.message)
    state = play(result.state, 'player-1', 'stl', { x: 0.5, y: 0.5 }, 10, id(201))
    expect(event(state, id(201)).location?.attackingDirection).toBe('right_to_left')
  })

  it('leaves assists, grid entries and half-court games unlocated', () => {
    let state = started('left_to_right')
    state = play(state, 'player-1', 'ast', { x: 0.8, y: 0.5 }, 10, id(201))
    state = play(state, 'player-1', 'stl', undefined, 20, id(202))
    expect(event(state, id(201)).location).toBeNull()
    expect(event(state, id(202)).location).toBeNull()

    let half = started()
    half = play(half, 'player-1', 'stl', { x: 0.8, y: 0.5 }, 10, id(203))
    half = foul(half, { x: 0.8, y: 0.5 }, 20, 300)
    expect(event(half, id(203)).location).toBeNull()
    expect(event(half, id(300)).location).toBeNull()
  })

  it('keeps the spot of a court-tap foul with the committing side’s direction', () => {
    let state = started('right_to_left')
    state = foul(state, { x: 0.2, y: 0.7 }, 10, 300)
    state = foul(state, null, 20, 310)
    expect(event(state, id(300))).toMatchObject({
      eventType: 'basketball.foul',
      location: { x: 0.2, y: 0.7, attackingDirection: 'right_to_left' },
    })
    expect(event(state, id(310)).location).toBeNull()
  })

  it('rejects half-court-frame plays and plays in the wrong frame', () => {
    expect(isValidBasketballPlayLocation({ x: 0.5, y: 0.5, attackingDirection: 'unknown' })).toBe(false)
    let state = started('left_to_right')
    state = play(state, 'player-1', 'stl', { x: 0.5, y: 0.5 }, 10, id(201))
    state = foul(state, { x: 0.3, y: 0.5 }, 20, 300)
    const stream = state.eventStream!
    for (const eventId of [id(201), id(300)]) {
      const broken = {
        ...stream,
        events: stream.events.map(candidate => isGameEventEnvelope(candidate) && candidate.id === eventId
          ? { ...candidate, location: { x: 0.5, y: 0.5, attackingDirection: 'unknown' as const } }
          : candidate),
      }
      const inspection = inspectGameEventStream(broken, gameEventRegistry)
      expect(inspection.activeEvents.some(candidate => candidate.id === eventId)).toBe(false)
    }

    const half = started()
    if (half.sportGameState?.sportId !== 'basketball') throw new Error('Missing Basketball state')
    expect(basketballLocationFrameError(half.sportGameState.projection, event(state, id(201))))
      .toBe('A full-court location needs a full-court game.')
  })

  it('undoes a located play like any court capture', () => {
    let state = started('left_to_right')
    state = play(state, 'player-1', 'to', { x: 0.4, y: 0.2 }, 10, id(201))
    const undone = undoLatestBasketballCourtCapture(state, at(20))
    if (!undone.ok) throw new Error(undone.message)
    expect(event(undone.state, id(201)).deletedAt).not.toBeNull()
  })

  it('moves or clears a play’s spot on edit and keeps its direction, even after a team change', () => {
    let state = started('left_to_right')
    state = play(state, 'player-1', 'stl', { x: 0.6, y: 0.5 }, 10, id(201))
    const draft = buildBasketballRelatedEventEditDraft(state, id(201))
    if (!draft.ok) throw new Error(draft.message)
    expect(draft.value.spot).toEqual({ point: { x: 0.6, y: 0.5 }, direction: 'left_to_right' })

    const moved = previewBasketballRelatedEventEdit(state, {
      ...draft.value,
      teamSide: 'opponent',
      actor: { kind: 'team' },
      spot: { ...draft.value.spot!, point: { x: 0.95, y: 0.5 } },
    }, recorder, at(20))
    if (!moved.ok) throw new Error(moved.message)
    expect(moved.value.consequenceLines).toContain('Court spot: 2.1 ft from the right basket.')
    const applied = applyBasketballRelatedEventEdit(state, moved.value)
    if (!applied.ok) throw new Error(applied.message)
    expect(event(applied.state, id(201))).toMatchObject({
      teamSide: 'opponent',
      location: { x: 0.95, y: 0.5, attackingDirection: 'left_to_right' },
    })

    const again = buildBasketballRelatedEventEditDraft(applied.state, id(201))
    if (!again.ok) throw new Error(again.message)
    const cleared = previewBasketballRelatedEventEdit(applied.state, {
      ...again.value,
      spot: { ...again.value.spot!, point: null },
    }, recorder, at(30))
    if (!cleared.ok) throw new Error(cleared.message)
    expect(cleared.value.consequenceLines).toContain('The court spot will be removed.')
    const removed = applyBasketballRelatedEventEdit(applied.state, cleared.value)
    if (!removed.ok) throw new Error(removed.message)
    expect(event(removed.state, id(201)).location).toBeNull()
    // With the spot gone there is nothing left to edit.
    const last = buildBasketballRelatedEventEditDraft(removed.state, id(201))
    expect(last.ok && last.value.spot).toBeNull()
  })

  it('moves or clears a foul’s spot on edit; a recorded-later foul has none', () => {
    let state = started('left_to_right')
    state = foul(state, { x: 0.3, y: 0.5 }, 10, 300)
    const draft = buildBasketballFoulFreeThrowEditDraft(state, id(300))
    if (!draft.ok) throw new Error(draft.message)
    expect(draft.value.spot).toEqual({ point: { x: 0.3, y: 0.5 }, direction: 'left_to_right' })

    const moved = previewBasketballFoulFreeThrowEdit(state, {
      ...draft.value,
      spot: { ...draft.value.spot!, point: { x: 0.1, y: 0.5 } },
    }, recorder, at(20))
    if (!moved.ok) throw new Error(moved.message)
    expect(moved.value.consequenceLines.some(line => line.startsWith('Court spot: '))).toBe(true)
    const applied = applyBasketballFoulFreeThrowChange(state, moved.value)
    if (!applied.ok) throw new Error(applied.message)
    expect(event(applied.state, id(300)).location).toEqual({ x: 0.1, y: 0.5, attackingDirection: 'left_to_right' })

    const again = buildBasketballFoulFreeThrowEditDraft(applied.state, id(300))
    if (!again.ok) throw new Error(again.message)
    const cleared = previewBasketballFoulFreeThrowEdit(applied.state, {
      ...again.value,
      spot: { ...again.value.spot!, point: null },
    }, recorder, at(30))
    if (!cleared.ok) throw new Error(cleared.message)
    const removed = applyBasketballFoulFreeThrowChange(applied.state, cleared.value)
    if (!removed.ok) throw new Error(removed.message)
    expect(event(removed.state, id(300)).location).toBeNull()

    const added = buildBasketballHistoricalFoulFreeThrowDraft(state, 'basketball.foul')
    expect(added.ok && added.value.spot).toBeNull()
  })

  it('shows the spot in the Timeline detail, from the nearer basket as the court is shown', () => {
    let state = started('left_to_right')
    state = play(state, 'player-1', 'stl', { x: 0.95, y: 0.5 }, 10, id(201))
    state = play(state, 'player-1', 'ast', undefined, 20, id(202))
    expect(buildBasketballTimelineReview(state).eventById.get(id(201))?.spotLabel)
      .toBe('2.1 ft from the right basket')
    expect(buildBasketballTimelineReview(flipped(state)).eventById.get(id(201))?.spotLabel)
      .toBe('2.1 ft from the left basket')
    expect(buildBasketballTimelineReview(state).eventById.get(id(202))?.spotLabel).toBeNull()
    expect(basketballPlaySpotText({ x: 0.05, y: 0.5, attackingDirection: 'left_to_right' }))
      .toBe('2.1 ft from the left basket')
  })
})
