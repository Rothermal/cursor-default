import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import { createInitialState } from '../gameReducer'
import { GameEventProjectorRegistry, rebuildGameEventProjection } from '../gameEvents/projection'
import { GameEventRegistry } from '../gameEvents/registry'
import type { GameEventLocation, GameEventPeriod } from '../gameEvents/types'
import {
  classifyShotZone,
  courtFeetToNormalizedLocation,
  HALFCOURT_Y,
  isThreePointer,
} from './courtGeometry'
import {
  basketballCurrentDirection,
  basketballPeriodDirection,
  createBasketballAttackingDirectionEvent,
} from './courtDirectionEvents'
import { basketballEventDefinitions, createBasketballLifecycleEvent } from './events'
import {
  basketballFullCourtLocation,
  basketballShotFeet,
  isBasketballBeyondHalfCourt,
} from './fullCourtGeometry'
import { getBasketballRulesProfile } from './profiles'
import { basketballGameEventProjector } from './projector'
import {
  createBasketballMatchRules,
  DEFAULT_BASKETBALL_RULES_SOURCE,
  resolveBasketballPeriodSegment,
} from './rules'
import { BASKETBALL_TEAM_STATS_DEFAULTS } from '../../config/teamStatsDefaults'
import { createBasketballStatEvent } from './statEvents'
import { createBasketballSportGameState } from './state'
import { buildBasketballTimelineReview } from './timeline'
import type {
  BasketballAttackingDirection,
  BasketballMatchEvent,
  BasketballMatchRulesV1,
  BasketballMatchRulesV2,
  BasketballMatchSetup,
  BasketballSportGameState,
} from './types'

const registry = new GameEventRegistry(basketballEventDefinitions)
const projectors = new GameEventProjectorRegistry([basketballGameEventProjector])
const startAt = Date.parse('2026-10-11T12:00:00.000Z')

function profileRules(profileId: 'nba' | 'youth_equal_play'): BasketballMatchRulesV1 | BasketballMatchRulesV2 {
  return getBasketballRulesProfile(profileId, 1)!.rules
}

/** Two halves (the legacy NFHS-style defaults). */
function halves(): BasketballMatchRulesV1 {
  return createBasketballMatchRules()
}

function setup(rules: BasketballMatchRulesV1 | BasketballMatchRulesV2): BasketballMatchSetup {
  return {
    version: 1,
    trackedTeamDesignation: 'home',
    sourceTeamId: null,
    sourceSeasonId: null,
    rulesSource: structuredClone(DEFAULT_BASKETBALL_RULES_SOURCE),
    rulesSnapshot: structuredClone(rules),
    participants: [{
      id: 'tracked-1',
      playerId: 'player-1',
      displayName: 'One',
      number: '1',
      teamSide: 'tracked',
      initialStatus: 'starter',
      position: null,
      captain: false,
    }],
  }
}

class Stream {
  events: BasketballMatchEvent[] = []
  private sequence = 0
  constructor(readonly rules: BasketballMatchRulesV1 | BasketballMatchRulesV2) {}

  private next() {
    const sequence = this.sequence++
    return {
      id: `71000000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`,
      sequence,
      occurredAt: new Date(startAt + sequence * 1_000).toISOString(),
      recorderUserId: 'recorder-1',
    }
  }

  period(periodId: string): GameEventPeriod {
    const segment = resolveBasketballPeriodSegment(this.rules, periodId)!
    return { id: segment.id, order: segment.order }
  }

  start(periodId: string) {
    this.events.push(createBasketballLifecycleEvent({
      ...this.next(),
      eventType: 'basketball.period_started',
      payload: { periodId, captureCommandId: null },
      period: this.period(periodId),
    }))
    return this
  }

  end(periodId: string) {
    this.events.push(createBasketballLifecycleEvent({
      ...this.next(),
      eventType: 'basketball.period_ended',
      payload: { periodId, captureCommandId: null },
      period: this.period(periodId),
    }))
    return this
  }

  direction(
    periodId: string,
    trackedDirection: BasketballAttackingDirection,
    reason: 'tip_off' | 'switch_ends' = 'switch_ends'
  ) {
    this.events.push(createBasketballAttackingDirectionEvent({
      ...this.next(),
      payload: { trackedDirection, reason, captureCommandId: `cmd-${this.sequence}` },
      period: this.period(periodId),
      elapsedMs: null,
    }))
    return this
  }

  shot(periodId: string, location: GameEventLocation | null, value: 2 | 3, side: 'tracked' | 'opponent' = 'tracked') {
    this.events.push(createBasketballStatEvent({
      ...this.next(),
      eventType: 'basketball.shot',
      payload: {
        value,
        made: true,
        attempt: 'field_goal',
        valueSource: location ? 'court' : 'quick_entry',
        freeThrowTripId: null,
        tripAttemptNumber: null,
        captureCommandId: null,
      },
      period: this.period(periodId),
      teamSide: side,
      actors: side === 'tracked'
        ? [{ role: 'shooter', kind: 'player', label: 'One', participantId: 'tracked-1', playerId: 'player-1' }]
        : [{ role: 'shooter', kind: 'unknown', label: 'Opponent shooter' }],
      location,
    }))
    return this
  }

  project() {
    const gameState: GameState = {
      ...createInitialState(),
      sport: sports.find(sport => sport.id === 'basketball')!,
      gameInfo: {
        teamName: 'Tracked',
        opponentName: 'Opponent',
        tournamentName: '',
        tournamentId: null,
        date: '2026-10-11',
      },
      sportGameState: createBasketballSportGameState(setup(this.rules)),
      eventStream: { version: 1, events: this.events },
    }
    const result = rebuildGameEventProjection(gameState, registry, projectors)
    const sportState = result.state.sportGameState as BasketballSportGameState
    return {
      state: result.state,
      projection: sportState.projection,
      diagnostics: result.inspection.diagnostics,
    }
  }
}

function regulationIds(rules: BasketballMatchRulesV1 | BasketballMatchRulesV2): string[] {
  return rules.regulationSegments.map(segment => segment.id)
}

/** Plays every regulation period and returns the tracked direction each started with. */
function directionsThroughRegulation(rules: BasketballMatchRulesV1 | BasketballMatchRulesV2, overtime = false) {
  const stream = new Stream(rules)
  const ids = regulationIds(rules)
  ids.forEach((periodId, index) => {
    stream.start(periodId)
    if (index === 0) stream.direction(periodId, 'left_to_right', 'tip_off')
    stream.end(periodId)
  })
  if (overtime) stream.start(`${rules.overtimeTemplate.idPrefix}-1`)
  const { projection, diagnostics } = stream.project()
  expect(diagnostics).toEqual([])
  return Object.fromEntries(
    Object.entries(projection.court!.periodDirections).map(([periodId, used]) => [periodId, used[0]])
  )
}

describe('BKE-7A full-court frame', () => {
  it('classifies a full-court point exactly like the same half-court point at either basket', () => {
    const points = [
      { x: 0, y: 3 },
      { x: -7, y: 12 },
      { x: 22.5, y: 2 },
      { x: 10, y: 22 },
      { x: 0, y: 23.9 },
      { x: -18, y: 30 },
    ]
    for (const point of points) {
      for (const direction of ['left_to_right', 'right_to_left'] as const) {
        const location = basketballFullCourtLocation(point, direction)
        const feet = basketballShotFeet(location)
        expect(feet.x).toBeCloseTo(point.x, 9)
        expect(feet.y).toBeCloseTo(point.y, 9)
        const halfCourt = basketballShotFeet({ ...courtFeetToNormalizedLocation(point), attackingDirection: 'unknown' })
        expect(isThreePointer(feet.x, feet.y)).toBe(isThreePointer(halfCourt.x, halfCourt.y))
        expect(classifyShotZone(feet.x, feet.y)).toBe(classifyShotZone(halfCourt.x, halfCourt.y))
      }
    }
  })

  it('treats the right basket as a half turn of the left one', () => {
    const left = basketballShotFeet({ x: 0.2, y: 0.3, attackingDirection: 'right_to_left' })
    const right = basketballShotFeet({ x: 0.8, y: 0.7, attackingDirection: 'left_to_right' })
    expect(right.x).toBeCloseTo(left.x, 9)
    expect(right.y).toBeCloseTo(left.y, 9)
    // The rim of the right basket is near the right baseline.
    expect(basketballFullCourtLocation({ x: 0, y: 0 }, 'left_to_right').x).toBeGreaterThan(0.95)
  })

  it('marks points past midcourt from their own basket as beyond half court', () => {
    const heave = { x: 0.1, y: 0.5, attackingDirection: 'left_to_right' } as const
    expect(isBasketballBeyondHalfCourt(heave)).toBe(true)
    expect(basketballShotFeet(heave).y).toBeGreaterThan(HALFCOURT_Y)
    expect(isBasketballBeyondHalfCourt({ x: 0.6, y: 0.5, attackingDirection: 'left_to_right' })).toBe(false)
    expect(isBasketballBeyondHalfCourt({ x: 0.1, y: 0.5, attackingDirection: 'unknown' })).toBe(false)
  })
})

describe('BKE-7A attacking direction', () => {
  it('switches at halftime for halves and keeps the second-half direction in overtime', () => {
    expect(directionsThroughRegulation(halves(), true)).toEqual({
      'regulation-1': 'left_to_right',
      'regulation-2': 'right_to_left',
      'overtime-1': 'right_to_left',
    })
  })

  it('switches only after the second of four quarters', () => {
    expect(directionsThroughRegulation(profileRules('nba'))).toEqual({
      'regulation-1': 'left_to_right',
      'regulation-2': 'left_to_right',
      'regulation-3': 'right_to_left',
      'regulation-4': 'right_to_left',
    })
  })

  it('switches at segment 5 of the eight-segment youth profile', () => {
    const directions = directionsThroughRegulation(profileRules('youth_equal_play'))
    expect(Object.keys(directions)).toHaveLength(8)
    for (let order = 1; order <= 8; order += 1) {
      expect(directions[`regulation-${order}`]).toBe(order <= 4 ? 'left_to_right' : 'right_to_left')
    }
  })

  it('never switches on its own for an odd number of periods', () => {
    const rules = createBasketballMatchRules({
      ...BASKETBALL_TEAM_STATS_DEFAULTS,
      periodsPerGame: 3,
      periodLabels: ['1st', '2nd', '3rd'],
    })
    const directions = directionsThroughRegulation(rules)
    expect(Object.values(directions)).toEqual(['left_to_right', 'left_to_right', 'left_to_right'])
  })

  it('applies Switch ends from that point forward and makes the period ambiguous', () => {
    const rules = halves()
    const stream = new Stream(rules)
      .start('regulation-1')
      .direction('regulation-1', 'left_to_right', 'tip_off')
      .shot('regulation-1', basketballFullCourtLocation({ x: 0, y: 3 }, 'left_to_right'), 2)
      .direction('regulation-1', 'right_to_left')
      .shot('regulation-1', basketballFullCourtLocation({ x: 0, y: 3 }, 'right_to_left'), 2)
    const { projection, diagnostics } = stream.project()
    expect(diagnostics).toEqual([])
    expect(projection.score.tracked).toBe(4)
    expect(basketballCurrentDirection(projection, 'tracked')).toBe('right_to_left')
    expect(basketballCurrentDirection(projection, 'opponent')).toBe('left_to_right')
    expect(basketballPeriodDirection(projection, rules, 'regulation-1', 'tracked')).toEqual({
      direction: null,
      used: ['left_to_right', 'right_to_left'],
    })

    stream.end('regulation-1').start('regulation-2')
    const second = stream.project().projection
    // Halftime flips the direction in force at the break.
    expect(basketballPeriodDirection(second, rules, 'regulation-2', 'tracked').direction).toBe('left_to_right')
    expect(basketballPeriodDirection(second, rules, 'regulation-2', 'opponent').direction).toBe('right_to_left')
  })

  it('rejects Switch ends during a break and keeps the ended period unambiguous', () => {
    const rules = halves()
    const stream = new Stream(rules)
      .start('regulation-1')
      .direction('regulation-1', 'left_to_right', 'tip_off')
      .end('regulation-1')
      .direction('regulation-1', 'right_to_left')
    expect(stream.project().diagnostics[0]?.message).toBe('The ends can be set only during a Basketball period.')

    const valid = new Stream(rules)
      .start('regulation-1')
      .direction('regulation-1', 'left_to_right', 'tip_off')
      .end('regulation-1')
      .start('regulation-2')
      .direction('regulation-2', 'left_to_right')
    const { projection, diagnostics } = valid.project()
    expect(diagnostics).toEqual([])
    expect(basketballPeriodDirection(projection, rules, 'regulation-1', 'tracked')).toEqual({
      direction: 'left_to_right',
      used: ['left_to_right'],
    })
    expect(basketballPeriodDirection(projection, rules, 'regulation-2', 'tracked').used)
      .toEqual(['right_to_left', 'left_to_right'])
  })

  it('keeps earlier shots valid when a Switch ends is removed', () => {
    const rules = halves()
    const stream = new Stream(rules)
      .start('regulation-1')
      .direction('regulation-1', 'left_to_right', 'tip_off')
      .direction('regulation-1', 'right_to_left')
      .shot('regulation-1', basketballFullCourtLocation({ x: 0, y: 3 }, 'right_to_left'), 2)
    stream.events[2] = { ...stream.events[2], deletedAt: new Date(startAt + 60_000).toISOString() }
    const { projection, diagnostics } = stream.project()
    expect(diagnostics).toEqual([])
    expect(projection.score.tracked).toBe(2)
    expect(projection.court!.trackedAttackingDirection).toBe('left_to_right')
  })

  it('counts a backcourt heave as a three from its own basket', () => {
    const rules = halves()
    const heave = { x: 0.1, y: 0.5, attackingDirection: 'left_to_right' } as const
    const valid = new Stream(rules)
      .start('regulation-1')
      .direction('regulation-1', 'left_to_right', 'tip_off')
      .shot('regulation-1', heave, 3)
    expect(valid.project().diagnostics).toEqual([])
    expect(valid.project().projection.score.tracked).toBe(3)

    const wrongValue = new Stream(rules)
      .start('regulation-1')
      .direction('regulation-1', 'left_to_right', 'tip_off')
      .shot('regulation-1', heave, 2)
    expect(wrongValue.project().diagnostics[0]?.message).toMatch(/invalid Basketball payload/)
  })

  it('rejects mixed frames, a second tip-off and a no-op Switch ends', () => {
    const rules = halves()
    const halfCourtShot = { ...courtFeetToNormalizedLocation({ x: 0, y: 3 }), attackingDirection: 'unknown' } as const
    const fullCourtShot = basketballFullCourtLocation({ x: 0, y: 3 }, 'left_to_right')

    const fullInHalf = new Stream(rules).start('regulation-1').shot('regulation-1', fullCourtShot, 2)
    expect(fullInHalf.project().diagnostics[0]?.message).toBe('A full-court location needs a full-court game.')

    const halfInFull = new Stream(rules)
      .start('regulation-1')
      .direction('regulation-1', 'left_to_right', 'tip_off')
      .shot('regulation-1', halfCourtShot, 2)
    expect(halfInFull.project().diagnostics[0]?.message).toBe('A full-court game stores full-court locations.')

    const twoTipOffs = new Stream(rules)
      .start('regulation-1')
      .direction('regulation-1', 'left_to_right', 'tip_off')
      .direction('regulation-1', 'right_to_left', 'tip_off')
    expect(twoTipOffs.project().diagnostics[0]?.message).toBe('The tip-off direction is already set.')

    const lateTipOff = new Stream(rules)
      .start('regulation-1').end('regulation-1').start('regulation-2')
      .direction('regulation-2', 'left_to_right', 'tip_off')
    expect(lateTipOff.project().diagnostics[0]?.message).toBe('The tip-off direction is set in the first period.')

    // A tip-off after any play would leave half-court shots in a full-court game.
    const tipOffAfterPlay = new Stream(rules)
      .start('regulation-1')
      .shot('regulation-1', halfCourtShot, 2)
      .direction('regulation-1', 'left_to_right', 'tip_off')
      .shot('regulation-1', fullCourtShot, 2)
    const afterPlay = tipOffAfterPlay.project()
    expect(afterPlay.diagnostics[0]?.message).toBe('The tip-off direction is set before anything else is recorded.')
    expect('court' in afterPlay.projection).toBe(false)

    const noOp = new Stream(rules)
      .start('regulation-1')
      .direction('regulation-1', 'left_to_right', 'tip_off')
      .direction('regulation-1', 'left_to_right')
    expect(noOp.project().diagnostics[0]?.message).toBe('The tracked team already attacks that basket.')

    const switchInHalf = new Stream(rules).start('regulation-1').direction('regulation-1', 'right_to_left')
    expect(switchInHalf.project().diagnostics[0]?.message).toBe('Switch ends needs a full-court game.')
  })

  it('leaves half-court games without court state and with their old shot markers', () => {
    const rules = halves()
    const location = { ...courtFeetToNormalizedLocation({ x: 4, y: 10 }), attackingDirection: 'unknown' } as const
    const { projection, state, diagnostics } = new Stream(rules)
      .start('regulation-1')
      .shot('regulation-1', location, 2)
      .project()
    expect(diagnostics).toEqual([])
    expect('court' in projection).toBe(false)
    expect(state.shotChart).toEqual([expect.objectContaining({ x: 4, y: 10, shotType: '2pt' })])
  })

  it('labels direction rows in the Timeline as match control', () => {
    const rules = halves()
    const { state } = new Stream(rules)
      .start('regulation-1')
      .direction('regulation-1', 'left_to_right', 'tip_off')
      .direction('regulation-1', 'right_to_left')
      .project()
    const titles = [...buildBasketballTimelineReview(state).eventById.values()]
      .filter(item => item.event.eventType === 'basketball.attacking_direction_set')
      .map(item => [item.title, item.families.includes('match_control')])
    expect(titles).toEqual(expect.arrayContaining([
      ['Tip-off: Tracked shoots at the right basket', true],
      ['Switched ends: Tracked shoots at the left basket', true],
    ]))
  })
})
