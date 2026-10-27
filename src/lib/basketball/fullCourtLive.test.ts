import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  addBasketballLateParticipant,
  captureBasketballCourtEvent,
  endBasketballPeriod,
  prepareBasketballGameStart,
  startNextBasketballPeriod,
  switchBasketballEnds,
} from './commands'
import { basketballLiveCaptureUnits, undoLatestBasketballCourtCapture } from './courtCorrections'
import { basketballShownBasket, isBasketballBeyondHalfCourt } from './fullCourtGeometry'
import { basketballDefaultTipOffDirection } from './fullCourtPolicy'
import {
  basketballFullCourtShotLocations,
  basketballFullCourtShotRecords,
  basketballShownCourtEnds,
  basketballSideAttacking,
  isBasketballFullCourtGame,
} from './fullCourtView'
import {
  applyBasketballHistoricalShot,
  applyBasketballShotEdit,
  basketballShotLocationText,
  buildBasketballHistoricalShotDraft,
  buildBasketballShotEditDraft,
  previewBasketballHistoricalShot,
  previewBasketballShotEdit,
  reconcileBasketballShotCourtDraft,
} from './shotEditCommands'
import { buildBasketballTimelineReview } from './timeline'
import { previewBasketballTimelineRemoval, removeBasketballTimelineEvents } from './timelineCorrections'
import type { BasketballAttackingDirection, BasketballShotEvent } from './types'

const basketball = sports.find(sport => sport.id === 'basketball')!
const recorder = 'recorder-1'
const base = Date.parse('2026-01-10T14:00:00.000Z')
const at = (seconds: number) => new Date(base + seconds * 1000).toISOString()
const id = (value: number) => `77000000-0000-4000-8000-${String(value).padStart(12, '0')}`

function player(playerId: string, name: string, number = ''): Player {
  return { id: playerId, name, number, stats: {} }
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
      date: '2026-10-12',
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

function started(tipOffDirection?: BasketballAttackingDirection): GameState {
  const result = prepareBasketballGameStart(setupState(), {
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

function shoot(
  state: GameState,
  playerId: string,
  point: { x: number; y: number },
  seconds: number,
  eventId: string,
  shotType: '2pt' | '3pt' = '2pt'
): GameState {
  const result = captureBasketballCourtEvent(state, {
    recorderUserId: recorder,
    playerId,
    fullCourtPoint: point,
    event: { kind: 'shot', made: true, shotType },
    occurredAt: at(seconds),
    eventIds: [eventId],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function sport(state: GameState) {
  if (state.sportGameState?.sportId !== 'basketball') throw new Error('Missing Basketball state')
  return state.sportGameState
}

function shotEvent(state: GameState, eventId: string): BasketballShotEvent {
  const event = state.eventStream?.events.find(candidate =>
    isGameEventEnvelope(candidate) && candidate.id === eventId
  ) as { eventType?: string } | undefined
  if (!event || event.eventType !== 'basketball.shot') throw new Error('Missing shot')
  return event as BasketballShotEvent
}

function switched(state: GameState, seconds: number, eventId: string): GameState {
  const result = switchBasketballEnds(state, { recorderUserId: recorder, occurredAt: at(seconds), eventId })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

describe('BKE-7B live full court', () => {
  it.each([
    { side: 'tracked' as const, value: 2 as const },
    { side: 'tracked' as const, value: 3 as const },
    { side: 'opponent' as const, value: 2 as const },
    { side: 'opponent' as const, value: 3 as const },
  ])('counts one $value-point shot, not linked assists/rebounds, for $side', ({ side, value }) => {
    let state = started('left_to_right')
    const shooterId = side === 'tracked' ? 'player-1' : id(801)
    const assisterId = side === 'tracked' ? 'player-2' : id(802)
    if (side === 'opponent') {
      for (const [index, playerId] of [shooterId, assisterId].entries()) {
        const added = addBasketballLateParticipant(state, {
          recorderUserId: recorder, teamSide: side, displayName: `Opponent ${index + 1}`,
          playerId, occurredAt: at(index + 1),
        })
        if (!added.ok) throw new Error(added.message)
        state = added.state
      }
    }
    const point = value === 3 ? { x: 0.5, y: 0.5 }
      : { x: side === 'tracked' ? 0.95 : 0.05, y: 0.5 }
    const scored = captureBasketballCourtEvent(state, {
      recorderUserId: recorder, playerId: shooterId, fullCourtPoint: point,
      event: { kind: 'shot', made: true, shotType: value === 3 ? '3pt' : '2pt', assistPlayerId: assisterId },
      occurredAt: at(10), eventIds: [id(811), id(812)],
    })
    if (!scored.ok) throw new Error(scored.message)
    expect(sport(scored.state).projection.score[side]).toBe(value)
    expect(sport(scored.state).projection.sideStats[side][value === 3 ? '3pt' : '2pt']).toBe(1)
    expect(scored.state.players.find(player => player.id === assisterId)?.stats.ast).toBe(1)
    expect(scored.state.players.find(player => player.id === assisterId)?.stats[value === 3 ? '3pt' : '2pt']).toBe(0)
    expect(scored.state.shotChart).toHaveLength(1)
    expect(scored.state.eventStream!.events.slice(-2).map(event => (event as { eventType: string }).eventType))
      .toEqual(['basketball.shot', 'basketball.assist'])

    const missed = captureBasketballCourtEvent(scored.state, {
      recorderUserId: recorder, playerId: shooterId, fullCourtPoint: point,
      event: { kind: 'shot', made: false, shotType: value === 3 ? '3pt' : '2pt',
        rebound: { statId: 'oreb', playerId: assisterId } },
      occurredAt: at(11), eventIds: [id(813), id(814)],
    })
    if (!missed.ok) throw new Error(missed.message)
    expect(sport(missed.state).projection.score[side]).toBe(value)
    expect(sport(missed.state).projection.sideStats[side].oreb).toBe(1)
    const undoMiss = undoLatestBasketballCourtCapture(missed.state)
    if (!undoMiss.ok) throw new Error(undoMiss.message)
    expect(sport(undoMiss.state).projection.score[side]).toBe(value)
    const undoMake = undoLatestBasketballCourtCapture(undoMiss.state)
    if (!undoMake.ok) throw new Error(undoMake.message)
    expect(sport(undoMake.state).projection.score).toEqual({ tracked: 0, opponent: 0 })
  })

  it('starts full court with the tip-off in the same command, and half court without one', () => {
    const full = started('right_to_left')
    expect(full.eventStream?.events.map(event => (event as { eventType: string }).eventType)).toEqual([
      'basketball.period_started',
      'basketball.attacking_direction_set',
    ])
    expect(isBasketballFullCourtGame(full)).toBe(true)
    expect(sport(full).projection.court?.trackedAttackingDirection).toBe('right_to_left')

    const half = started()
    expect(half.eventStream?.events).toHaveLength(1)
    expect(isBasketballFullCourtGame(half)).toBe(false)
  })

  it('stamps a tap with the shooting side’s basket and measures its value from there', () => {
    let state = started('left_to_right')
    // Tracked attacks right: a layup at the right basket and a heave from its backcourt.
    state = shoot(state, 'player-1', { x: 0.95, y: 0.5 }, 10, id(201))
    state = shoot(state, 'player-1', { x: 0.3, y: 0.5 }, 20, id(202), '3pt')
    // The opponent attacks left.
    state = shoot(state, TEAM_PLAYER_OPP_ID, { x: 0.05, y: 0.5 }, 30, id(203))

    const layup = shotEvent(state, id(201))
    const heave = shotEvent(state, id(202))
    const opponent = shotEvent(state, id(203))
    expect(layup.location).toEqual({ x: 0.95, y: 0.5, attackingDirection: 'left_to_right' })
    expect(layup.payload).toMatchObject({ value: 2, valueSource: 'court' })
    expect(heave.payload).toMatchObject({ value: 3, valueSource: 'court' })
    expect(isBasketballBeyondHalfCourt(heave.location!)).toBe(true)
    expect(opponent.location?.attackingDirection).toBe('right_to_left')
    expect(sport(state).projection.score).toEqual({ tracked: 5, opponent: 2 })

    // The chart draws each shot where it was taken; the projection's chart stays rim-relative.
    const locations = basketballFullCourtShotLocations(state)
    const records = basketballFullCourtShotRecords(state.shotChart, locations)
    expect(records.find(record => record.id === id(201))?.x).toBeCloseTo(0.95 * 94)
    expect(records.find(record => record.id === id(203))?.x).toBeCloseTo(0.05 * 94)
    expect(state.shotChart.find(record => record.id === id(203))?.y)
      .toBeCloseTo(state.shotChart.find(record => record.id === id(201))!.y, 0)
  })

  it('picks the side attacking a basket and follows Switch ends and halftime', () => {
    let state = started('left_to_right')
    expect(basketballSideAttacking(state, 'left_to_right')).toBe('tracked')
    expect(basketballSideAttacking(state, 'right_to_left')).toBe('opponent')
    state = switched(state, 5, id(301))
    expect(basketballSideAttacking(state, 'left_to_right')).toBe('opponent')

    const ended = endBasketballPeriod(state, { recorderUserId: recorder, occurredAt: at(60), eventId: id(302) })
    if (!ended.ok) throw new Error(ended.message)
    const breakSwitch = switchBasketballEnds(ended.state, { recorderUserId: recorder, occurredAt: at(61) })
    expect(breakSwitch.ok).toBe(false)
    const q2 = startNextBasketballPeriod(ended.state, { recorderUserId: recorder, occurredAt: at(62), eventId: id(303) })
    if (!q2.ok) throw new Error(q2.message)
    expect(sport(q2.state).projection.court?.trackedAttackingDirection).toBe('right_to_left')

    expect(isBasketballFullCourtGame(started())).toBe(false)
    expect(switchBasketballEnds(started(), { recorderUserId: recorder }).ok).toBe(false)
  })

  it('undoes and removes Switch ends, but keeps the tip-off as a read-only boundary', () => {
    const tipped = started('left_to_right')
    const units = basketballLiveCaptureUnits(tipped)
    expect(units.find(unit => unit.eventIds.includes(id(2)))).toMatchObject({
      kind: 'boundary',
      undoable: false,
      what: 'Tip-off',
    })
    expect(undoLatestBasketballCourtCapture(tipped, at(1)).ok).toBe(false)
    expect(previewBasketballTimelineRemoval(tipped, id(2)).ok).toBe(false)
    expect(buildBasketballTimelineReview(tipped).eventById.get(id(2))?.boundary).toBe(true)

    const state = switched(tipped, 5, id(301))
    expect(basketballLiveCaptureUnits(state)[0]).toMatchObject({ what: 'Switched ends', undoable: true })
    const undone = undoLatestBasketballCourtCapture(state, at(6))
    if (!undone.ok) throw new Error(undone.message)
    expect(sport(undone.state).projection.court?.trackedAttackingDirection).toBe('left_to_right')

    const preview = previewBasketballTimelineRemoval(state, id(301))
    if (!preview.ok) throw new Error(preview.message)
    const removed = removeBasketballTimelineEvents(state, preview.value, at(7))
    if (!removed.ok) throw new Error(removed.message)
    expect(sport(removed.state).projection.court?.trackedAttackingDirection).toBe('left_to_right')
  })

  it('keeps an edited shot’s basket when it moves or changes side, and re-checks the value on a basket change', () => {
    const state = shoot(started('left_to_right'), 'player-1', { x: 0.95, y: 0.5 }, 10, id(201))
    const draftResult = buildBasketballShotEditDraft(state, id(201))
    if (!draftResult.ok) throw new Error(draftResult.message)
    expect(draftResult.value.court).toEqual({
      point: { x: 0.95, y: 0.5 },
      direction: 'left_to_right',
      directionSource: 'stored',
    })

    // Moved deep and given to the opponent: still the right basket, so a backcourt three.
    const moved = {
      ...draftResult.value,
      teamSide: 'opponent' as const,
      shooter: { kind: 'team' as const },
      value: 3 as const,
      court: reconcileBasketballShotCourtDraft(
        state,
        { ...draftResult.value.court!, point: { x: 0.2, y: 0.5 } },
        draftResult.value.periodId,
        'opponent'
      ),
    }
    expect(moved.court?.direction).toBe('left_to_right')
    const preview = previewBasketballShotEdit(state, moved, recorder, at(20))
    if (!preview.ok) throw new Error(preview.message)
    const applied = applyBasketballShotEdit(state, preview.value)
    if (!applied.ok) throw new Error(applied.message)
    expect(shotEvent(applied.state, id(201)).location).toEqual({
      x: 0.2,
      y: 0.5,
      attackingDirection: 'left_to_right',
    })
    expect(shotEvent(applied.state, id(201)).payload.valueSource).toBe('court')

    // Re-stamping at the left basket makes the same spot a two, so a three is now manual.
    const restamped = {
      ...moved,
      court: { point: { x: 0.2, y: 0.5 }, direction: 'right_to_left' as const, directionSource: 'recorder' as const },
    }
    const restampPreview = previewBasketballShotEdit(state, restamped, recorder, at(20))
    if (!restampPreview.ok) throw new Error(restampPreview.message)
    const restampApplied = applyBasketballShotEdit(state, restampPreview.value)
    if (!restampApplied.ok) throw new Error(restampApplied.message)
    expect(shotEvent(restampApplied.state, id(201)).payload.valueSource).toBe('manual_override')
  })

  it('preselects the basket for an added shot only when its period used one direction', () => {
    let state = started('left_to_right')
    const draftResult = buildBasketballHistoricalShotDraft(state)
    if (!draftResult.ok) throw new Error(draftResult.message)
    const placed = reconcileBasketballShotCourtDraft(
      state,
      { ...draftResult.value.court!, point: { x: 0.9, y: 0.5 } },
      draftResult.value.period.id,
      'tracked'
    )
    expect(placed).toEqual({ point: { x: 0.9, y: 0.5 }, direction: 'left_to_right', directionSource: 'period' })
    // A period default follows the side.
    expect(reconcileBasketballShotCourtDraft(state, placed, draftResult.value.period.id, 'opponent')?.direction)
      .toBe('right_to_left')

    state = switched(state, 30, id(301))
    const ambiguousDraft = buildBasketballHistoricalShotDraft(state)
    if (!ambiguousDraft.ok) throw new Error(ambiguousDraft.message)
    const ambiguous = {
      ...ambiguousDraft.value,
      court: reconcileBasketballShotCourtDraft(
        state,
        { ...ambiguousDraft.value.court!, point: { x: 0.9, y: 0.5 } },
        ambiguousDraft.value.period.id,
        'tracked'
      ),
    }
    expect(ambiguous.court?.direction).toBeNull()
    const blocked = previewBasketballHistoricalShot(state, ambiguous, recorder, at(40))
    expect(blocked).toMatchObject({ ok: false, message: 'Choose the basket this shot was taken at.' })

    const chosen = {
      ...ambiguous,
      court: { point: { x: 0.9, y: 0.5 }, direction: 'left_to_right' as const, directionSource: 'recorder' as const },
    }
    const preview = previewBasketballHistoricalShot(state, chosen, recorder, at(40))
    if (!preview.ok) throw new Error(preview.message)
    expect(preview.value.consequenceLines).toContain('Court location: Right basket, 6.8 ft.')
    const applied = applyBasketballHistoricalShot(state, preview.value)
    if (!applied.ok) throw new Error(applied.message)
    expect(shotEvent(applied.state, chosen.eventId).location?.attackingDirection).toBe('left_to_right')
  })

  it('describes full-court and half-court locations', () => {
    expect(basketballShotLocationText({ x: 0.3, y: 0.5, attackingDirection: 'left_to_right' }))
      .toBe('Right basket, 63.2 ft')
    expect(basketballShotLocationText({ x: 0.5, y: 0.2, attackingDirection: 'unknown' }))
      .toMatch(/ ft$/)
  })

  describe('left and right follow the shown court (review on #486)', () => {
    function shown(state: GameState, flipped: boolean): GameState {
      const current = sport(state)
      return {
        ...state,
        sportGameState: {
          ...current,
          capturePreferences: { ...current.capturePreferences, courtOrientation: flipped ? 'flipped' : 'standard' },
        },
      }
    }

    it.each([
      ['left_to_right', false, 'right', 'left'],
      ['left_to_right', true, 'left', 'right'],
      ['right_to_left', false, 'left', 'right'],
      ['right_to_left', true, 'right', 'left'],
    ] as const)('tip-off %s, flipped %s: Court ends shows %s / %s', (direction, flipped, tracked, opponent) => {
      const state = shown(started(direction), flipped)
      expect(basketballShownCourtEnds(state)).toEqual({ tracked, opponent })
      expect(basketballShownBasket(direction, flipped ? 'flipped' : 'standard')).toBe(tracked)
      // Flipping is display only: the stored direction is unchanged.
      expect(sport(state).projection.court?.trackedAttackingDirection).toBe(direction)
      const capitalized = tracked === 'right' ? 'Right' : 'Left'
      expect(buildBasketballTimelineReview(state).eventById.get(id(2))?.title)
        .toBe(`Tip-off: Aces at the ${tracked} basket`)
      expect(basketballShotLocationText(
        { x: direction === 'left_to_right' ? 0.9 : 0.1, y: 0.5, attackingDirection: direction },
        flipped ? 'flipped' : 'standard'
      )).toBe(`${capitalized} basket, 6.8 ft`)
    })

    it('a flipped opening view defaults the tracked team to the basket shown on the right', () => {
      const flippedDefault = basketballDefaultTipOffDirection(true)
      expect(flippedDefault).toBe('right_to_left')
      expect(basketballShownCourtEnds(shown(started(flippedDefault), true))).toEqual({ tracked: 'right', opponent: 'left' })
      expect(basketballShownCourtEnds(shown(started(basketballDefaultTipOffDirection(false)), false)))
        .toEqual({ tracked: 'right', opponent: 'left' })
    })

    it('half-court games have no Court ends', () => {
      expect(basketballShownCourtEnds(started())).toBeNull()
    })
  })
})
