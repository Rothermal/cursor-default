import { describe, expect, it } from 'vitest'
import { buildGameSyncFingerprint, isAggregateCloudSyncEligible } from '../gameSyncFingerprint'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { normalizeSportGameState, sportSupportsEventGameState } from '../sportGameState/state'
import {
  adjustBaseballScore,
  baseballMovement,
  endBaseballGame,
  endBaseballHalfInning,
  proposeBaseballMovements,
  recordBaseballBaserunning,
  recordBaseballPitch,
  recordBaseballPlateAppearance,
  reopenBaseballGame,
  substituteBaseball,
} from './commands'
import { createBaseballEvent } from './events'
import { baseballPeriod, parseBaseballPeriod } from './periods'
import { baseballPositionSortKey, normalizeBaseballPosition } from './positions'
import { baseballRulesProfiles, createBaseballMatchRules } from './profiles'
import { normalizeBaseballMatchRules } from './rules'
import { normalizeBaseballMatchSetup, validateBaseballMatchSetup } from './state'
import {
  battingAverage,
  earnedRunAverage,
  formatInningsPitched,
  onBasePercentage,
  sluggingPercentage,
} from './stats'
import {
  OPPONENT_PITCHER,
  TRACKED,
  ballInPlay,
  baseballSetup,
  ctx,
  expectOk,
  inPlay,
  pitch,
  pitches,
  projection,
  startedGame,
  strikeout,
  threeUpThreeDown,
  walk,
} from './testFixtures'

describe('Baseball rules, profiles and setup', () => {
  it('ships exact, parseable profiles including softball', () => {
    const ids = baseballRulesProfiles().map(profile => profile.id)
    expect(ids).toEqual([
      'nfhs_baseball',
      'youth_baseball',
      'mlb',
      'ncaa_baseball',
      'nfhs_softball_fastpitch',
      'softball_slowpitch',
      'custom',
    ])
    for (const profile of baseballRulesProfiles()) {
      expect(normalizeBaseballMatchRules(structuredClone(profile.rules))).toEqual(profile.rules)
      expect(Object.isFrozen(profile.rules)).toBe(true)
    }
    const slowpitch = createBaseballMatchRules('softball_slowpitch')
    expect(slowpitch).toMatchObject({ startingBalls: 1, startingStrikes: 1, defensivePlayers: 10 })
  })

  it('fails closed on unknown keys and impossible values', () => {
    const rules = createBaseballMatchRules()
    expect(normalizeBaseballMatchRules({ ...rules, extra: true })).toBeNull()
    expect(normalizeBaseballMatchRules({ ...rules, ballsForWalk: 5 })).toBeNull()
    expect(normalizeBaseballMatchRules({ ...rules, startingBalls: 4 })).toBeNull()
    expect(normalizeBaseballMatchRules({ ...rules, placedRunnerBase: 'second', placedRunnerFromInning: 3 })).toBeNull()
    expect(normalizeBaseballMatchRules({ ...rules, profileId: 'made_up' })).toBeNull()
  })

  it('validates batting-order formats', () => {
    const standard = baseballSetup()
    expect(validateBaseballMatchSetup(standard)).toEqual({ ok: true })
    expect(normalizeBaseballMatchSetup(structuredClone(standard))).toEqual(standard)

    const dh = baseballSetup({ rules: { battingOrderFormat: 'designated_hitter' } })
    dh.trackedLineup.battingOrder[0] = TRACKED[9]
    expect(validateBaseballMatchSetup(dh)).toEqual({ ok: true })
    dh.trackedLineup.battingOrder[1] = TRACKED[10]
    expect(validateBaseballMatchSetup(dh).ok).toBe(false)

    const continuous = baseballSetup({ rules: { battingOrderFormat: 'continuous' } })
    continuous.trackedLineup.battingOrder.push(TRACKED[9], TRACKED[10], TRACKED[11])
    expect(validateBaseballMatchSetup(continuous)).toEqual({ ok: true })

    const broken = baseballSetup()
    delete broken.trackedLineup.defense['6']
    expect(validateBaseballMatchSetup(broken).ok).toBe(false)
  })

  it('normalizes positions and periods', () => {
    expect(normalizeBaseballPosition(' ss ')).toBe('SS')
    expect(normalizeBaseballPosition('Rover')).toBe('Rover')
    expect(normalizeBaseballPosition('')).toBeNull()
    expect(baseballPositionSortKey('P')).toBeLessThan(baseballPositionSortKey('Rover'))
    expect(baseballPositionSortKey('Rover')).toBeLessThan(baseballPositionSortKey(null))
    expect(baseballPeriod(3, 'bottom')).toEqual({ id: 'inning-3-bottom', order: 6 })
    expect(parseBaseballPeriod({ id: 'inning-3-bottom', order: 5 })).toBeNull()
  })

  it('registers as an event sport that fails closed out of aggregate sync', () => {
    const state = startedGame()
    expect(sportSupportsEventGameState('baseball')).toBe(true)
    expect(normalizeSportGameState(structuredClone(state.sportGameState))).not.toBeNull()
    expect(isAggregateCloudSyncEligible(state)).toBe(false)
    expect(buildGameSyncFingerprint(state)).toBe(buildGameSyncFingerprint(structuredClone(state)))
  })
})

describe('Baseball event validation', () => {
  it('rejects clock time, wrong locations and malformed movements', () => {
    const base = {
      eventType: 'baseball.pitch' as const,
      teamSide: 'opponent' as const,
      period: baseballPeriod(1, 'top'),
      recorderUserId: null,
      sequence: 1,
      occurredAt: '2026-09-26T12:00:00.000Z',
    }
    const valid = createBaseballEvent({
      ...base,
      payload: { captureCommandId: null, result: 'ball', pitchLocation: { x: 1.2, y: 0.5 }, inPlay: null, movements: [] },
    })
    expect(gameEventRegistry.inspect(valid).ok).toBe(true)
    expect(gameEventRegistry.inspect({ ...valid, elapsedMs: 1000 }).ok).toBe(false)
    expect(
      gameEventRegistry.inspect({ ...valid, location: { x: 0.5, y: 0.5, attackingDirection: 'unknown' } }).ok
    ).toBe(false)
    const backwards = createBaseballEvent({
      ...base,
      payload: {
        captureCommandId: null,
        result: 'ball',
        pitchLocation: null,
        inPlay: null,
        movements: [baseballMovement('r', 'second', 'first', 'stolen_base')],
      },
    })
    expect(gameEventRegistry.inspect(backwards).ok).toBe(false)
  })
})

describe('Count and plate appearances', () => {
  it('walks on ball four and strikes out on strike three', () => {
    let state = startedGame()
    expect(projection(state)).toMatchObject({ inning: 1, half: 'top', battingSide: 'opponent', currentBatterId: 'o1' })
    state = walk(state)
    let p = projection(state)
    expect(p.bases.first?.runnerId).toBe('o1')
    expect(p.currentBatterId).toBe('o2')
    expect(p.pitchingLines.t1).toMatchObject({ pitches: 4, balls: 4, bb: 1, bf: 1 })

    state = pitches(state, 'called_strike', 'foul', 'foul', 'foul')
    expect(projection(state).strikes).toBe(2)
    state = strikeout(state)
    p = projection(state)
    expect(p.outs).toBe(1)
    expect(p.battingLines.o2).toMatchObject({ pa: 1, ab: 1, k: 1 })
    expect(p.fieldingLines.t2).toMatchObject({ po: 1 })
    expect(p.pitchingLines.t1).toMatchObject({ k: 1, outs: 1, firstPitchStrikes: 1 })
  })

  it('rejects a strikeout without resolving the batter and illegal dropped third strikes', () => {
    let state = startedGame()
    state = walk(state)
    state = pitches(state, 'called_strike', 'called_strike')
    const noBatter = recordBaseballPitch(state, { result: 'swinging_strike' }, ctx())
    expect(noBatter.ok).toBe(false)
    const batter = projection(state).currentBatterId!
    const dropped = recordBaseballPitch(
      state,
      { result: 'swinging_strike', movements: [baseballMovement(batter, 'batter', 'first', 'dropped_third_strike')] },
      ctx()
    )
    expect(dropped.ok).toBe(false)
    if (!dropped.ok) expect(dropped.message).toMatch(/first base occupied/)
  })

  it('forces runners on a bases-loaded walk and credits the RBI', () => {
    let state = startedGame()
    state = walk(walk(walk(state)))
    expect(Object.values(projection(state).bases).every(Boolean)).toBe(true)
    state = walk(state)
    const p = projection(state)
    expect(p.score.opponent).toBe(1)
    expect(p.battingLines.o4).toMatchObject({ bb: 1, rbi: 1, ab: 0 })
    expect(p.battingLines.o1.r).toBe(1)
    expect(p.pitchingLines.t1).toMatchObject({ r: 1, er: 1 })
  })

  it('requires forced runners to move on a walk', () => {
    let state = startedGame()
    state = walk(state)
    state = pitches(state, 'ball', 'ball', 'ball')
    const batter = projection(state).currentBatterId!
    const result = recordBaseballPitch(
      state,
      { result: 'ball', movements: [baseballMovement(batter, 'batter', 'first', 'awarded')] },
      ctx()
    )
    expect(result.ok).toBe(false)
  })

  it('handles slowpitch 1-1 counts and two-strike foul outs', () => {
    let state = startedGame(baseballSetup({ profile: 'softball_slowpitch', rules: { battingOrderFormat: 'standard' } }))
    expect(projection(state)).toMatchObject({ balls: 1, strikes: 1 })
    state = pitch(state, { result: 'called_strike' })
    const batter = projection(state).currentBatterId!
    state = pitch(state, { result: 'foul', movements: [baseballMovement(batter, 'batter', 'out', 'on_play')] })
    expect(projection(state).battingLines[batter].k).toBe(1)
    expect(projection(state)).toMatchObject({ outs: 1, balls: 1, strikes: 1 })
  })

  it('records quick plate appearances with an optional final count', () => {
    let state = startedGame()
    const batter = projection(state).currentBatterId!
    state = expectOk(
      recordBaseballPlateAppearance(
        state,
        {
          result: 'in_play',
          inPlay: inPlay('double', { battedBallType: 'line' }),
          location: { x: 0.2, y: 0.3 },
          finalBalls: 2,
          finalStrikes: 1,
          movements: [baseballMovement(batter, 'batter', 'second', 'on_play')],
        },
        ctx()
      )
    )
    const p = projection(state)
    expect(p.bases.second?.runnerId).toBe(batter)
    expect(p.battingLines[batter]).toMatchObject({ h: 1, doubles: 1, tb: 2, pitchesSeen: 4 })
    expect(p.pitchingLines.t1).toMatchObject({ pitches: 4, untrackedPlateAppearances: 1 })
    expect(p.plateAppearances[0]).toMatchObject({ outcome: 'double', pitchesTracked: false })
    expect(p.plateAppearances[0].location).toEqual({ x: 0.2, y: 0.3, attackingDirection: 'unknown' })
  })
})

describe('Balls in play and runners', () => {
  it('applies hit proposals and scores runs with RBI', () => {
    let state = startedGame()
    state = ballInPlay(state, 'single')
    state = ballInPlay(state, 'double')
    let p = projection(state)
    expect(p.score.opponent).toBe(0)
    expect(p.bases.third?.runnerId).toBe('o1')
    expect(p.bases.second?.runnerId).toBe('o2')
    expect(p.battingLines.o2).toMatchObject({ rbi: 0, doubles: 1 })
    state = ballInPlay(state, 'home_run', { battedBallType: 'fly' })
    p = projection(state)
    expect(p.score.opponent).toBe(3)
    expect(p.battingLines.o3).toMatchObject({ hr: 1, rbi: 3, r: 1, tb: 4 })
    expect(p.pitchingLines.t1).toMatchObject({ h: 3, hr: 1, r: 3, er: 3 })
    expect(p.lineScore[0]).toMatchObject({ runs: 3, hits: 3 })
  })

  it('turns a 6-4-3 double play and credits fielders', () => {
    let state = startedGame()
    state = ballInPlay(state, 'single')
    state = ballInPlay(state, 'double_play', { fielders: [6, 4, 3] })
    const p = projection(state)
    expect(p.outs).toBe(2)
    expect(p.bases.first).toBeNull()
    expect(p.battingLines.o2).toMatchObject({ gidp: 1, ab: 1 })
    expect(p.fieldingLines.t6).toMatchObject({ a: 1, dp: 1 })
    expect(p.fieldingLines.t4).toMatchObject({ po: 1, a: 1, dp: 1 })
    expect(p.fieldingLines.t3).toMatchObject({ po: 1, dp: 1 })
  })

  it('does not count a run when the third out is a force out', () => {
    let state = startedGame()
    state = ballInPlay(state, 'single')
    state = ballInPlay(state, 'single')
    state = ballInPlay(state, 'single')
    state = strikeout(strikeout(state))
    const p0 = projection(state)
    const batter = p0.currentBatterId!
    const movements = [
      baseballMovement(p0.bases.third!.runnerId, 'third', 'home', 'on_play'),
      baseballMovement(p0.bases.second!.runnerId, 'second', 'third', 'on_play'),
      baseballMovement(p0.bases.first!.runnerId, 'first', 'out', 'on_play', { fielders: [6, 4] }),
      baseballMovement(batter, 'batter', 'first', 'on_play'),
    ]
    state = pitch(state, { result: 'in_play', inPlay: inPlay('fielders_choice', { fielders: [6] }), movements })
    const p = projection(state)
    expect(p.score.opponent).toBe(0)
    expect(p.lineScore[0]).toMatchObject({ runs: 0, leftOnBase: 2, complete: true })
    expect(p).toMatchObject({ inning: 1, half: 'bottom', outs: 0, battingSide: 'tracked' })
  })

  it('counts a timing-play run on a non-force third out', () => {
    let state = startedGame()
    state = strikeout(strikeout(state))
    state = ballInPlay(state, 'triple')
    const p0 = projection(state)
    const batter = p0.currentBatterId!
    state = pitch(state, {
      result: 'in_play',
      inPlay: inPlay('single', { battedBallType: 'line' }),
      movements: [
        baseballMovement(p0.bases.third!.runnerId, 'third', 'home', 'on_play'),
        baseballMovement(batter, 'batter', 'out', 'on_play', { fielders: [8, 4] }),
      ],
    })
    expect(projection(state).score.opponent).toBe(1)
    expect(projection(state).battingLines[batter]).toMatchObject({ h: 1, rbi: 1 })
  })

  it('rejects runners passing each other or sharing a base', () => {
    let state = startedGame()
    state = ballInPlay(state, 'single')
    const batter = projection(state).currentBatterId!
    const passing = recordBaseballPitch(
      state,
      {
        result: 'in_play',
        inPlay: inPlay('double'),
        movements: [baseballMovement(batter, 'batter', 'second', 'on_play')],
      },
      ctx()
    )
    expect(passing.ok).toBe(false)
    const empty = recordBaseballBaserunning(state, 'stolen_base', [baseballMovement('o9', 'second', 'third', 'stolen_base')], ctx())
    expect(empty.ok).toBe(false)
  })

  it('records steals, caught stealing, wild pitches and passed balls', () => {
    let state = startedGame()
    state = walk(state)
    state = expectOk(recordBaseballBaserunning(state, 'stolen_base', [baseballMovement('o1', 'first', 'second', 'stolen_base')], ctx()))
    state = pitch(state, { result: 'ball', movements: [baseballMovement('o1', 'second', 'third', 'wild_pitch')] })
    state = pitch(state, { result: 'ball', movements: [baseballMovement('o1', 'third', 'home', 'passed_ball')] })
    let p = projection(state)
    expect(p.score.opponent).toBe(1)
    expect(p.battingLines.o1.sb).toBe(1)
    expect(p.pitchingLines.t1).toMatchObject({ wp: 1, r: 1, er: 0 })
    expect(p.fieldingLines.t2).toMatchObject({ pb: 1, sbAllowed: 1 })
    expect(p.battingLines.o2.rbi).toBe(0)
    state = ballInPlay(state, 'single')
    state = pitch(state, {
      result: 'called_strike',
      movements: [baseballMovement('o2', 'first', 'out', 'caught_stealing', { fielders: [2, 6] })],
    })
    p = projection(state)
    expect(p.outs).toBe(1)
    expect(p.battingLines.o2.cs).toBe(1)
    expect(p.fieldingLines.t2.cs).toBe(1)
    expect(p.strikes).toBe(1)
  })

  it('charges errors as unearned runs', () => {
    let state = startedGame()
    state = ballInPlay(state, 'error', { errorBy: 6 })
    state = ballInPlay(state, 'home_run')
    const p = projection(state)
    expect(p.fieldingLines.t6.e).toBe(1)
    expect(p.battingLines.o1.roe).toBe(1)
    expect(p.pitchingLines.t1).toMatchObject({ r: 2, er: 1 })
    expect(p.lineScore[0].errors).toBe(1)
  })
})

describe('Half-innings and game endings', () => {
  it('rotates halves and batting order across innings', () => {
    let state = startedGame()
    state = threeUpThreeDown(state)
    expect(projection(state)).toMatchObject({ half: 'bottom', battingSide: 'tracked', currentBatterId: 't1' })
    state = threeUpThreeDown(state)
    expect(projection(state)).toMatchObject({ inning: 2, half: 'top', currentBatterId: 'o4' })
    expect(projection(state).pitchingLines[OPPONENT_PITCHER].outs).toBe(3)
  })

  it('skips the bottom of the last inning when the home side leads and ends on completion', () => {
    let state = startedGame(baseballSetup({ rules: { scheduledInnings: 1 } }))
    state = threeUpThreeDown(state)
    state = ballInPlay(state, 'home_run')
    expect(projection(state).pendingEnd).toBe('walk_off')
    expect(recordBaseballPitch(state, { result: 'ball' }, ctx()).ok).toBe(false)
    state = expectOk(endBaseballGame(state, 'completed', ctx()))
    expect(projection(state)).toMatchObject({ status: 'final', result: { outcome: 'completed', winner: 'tracked' } })

    let away = startedGame(baseballSetup({ trackedSide: 'away', rules: { scheduledInnings: 1 } }))
    away = threeUpThreeDown(away)
    away = threeUpThreeDown(away)
    expect(projection(away)).toMatchObject({ inning: 2, half: 'top' })
  })

  it('applies the run rule and max runs per half-inning', () => {
    let state = startedGame(baseballSetup({ rules: { runRules: [{ afterInning: 1, lead: 2 }] } }))
    state = threeUpThreeDown(state)
    state = ballInPlay(state, 'home_run')
    expect(projection(state).pendingEnd).toBeNull()
    state = ballInPlay(state, 'home_run')
    expect(projection(state).pendingEnd).toBe('run_rule')
    expect(endBaseballGame(state, 'completed', ctx()).ok).toBe(false)
    state = expectOk(endBaseballGame(state, 'run_rule', ctx()))
    expect(projection(state).result?.winner).toBe('tracked')

    let capped = startedGame(baseballSetup({ rules: { maxRunsPerHalfInning: 2 } }))
    capped = ballInPlay(capped, 'home_run')
    capped = ballInPlay(capped, 'home_run')
    expect(projection(capped)).toMatchObject({ half: 'bottom', score: { opponent: 2 } })
  })

  it('places the extra-inning runner and treats the run as unearned', () => {
    let state = startedGame(baseballSetup({ profile: 'mlb', rules: { scheduledInnings: 1, placedRunnerFromInning: 2 } }))
    state = threeUpThreeDown(threeUpThreeDown(state))
    const p = projection(state)
    expect(p).toMatchObject({ inning: 2, half: 'top' })
    expect(p.bases.second).toMatchObject({ runnerId: 'o3', reachedBy: 'placed_runner', unearned: true })
    state = ballInPlay(state, 'double')
    expect(projection(state).pitchingLines.t1).toMatchObject({ r: 1, er: 0 })
  })

  it('ends a half early for a time limit and supports suspend and reopen', () => {
    let state = startedGame()
    state = strikeout(state)
    state = expectOk(endBaseballHalfInning(state, 'time_limit', null, ctx()))
    expect(projection(state)).toMatchObject({ half: 'bottom', outs: 0 })
    state = expectOk(endBaseballGame(state, 'suspended', ctx(), { note: 'Rain' }))
    expect(projection(state).status).toBe('suspended')
    expect(recordBaseballPitch(state, { result: 'ball' }, ctx()).ok).toBe(false)
    state = expectOk(reopenBaseballGame(state, 'Resumed Tuesday', ctx()))
    expect(projection(state)).toMatchObject({ status: 'in_progress', half: 'bottom' })
    state = expectOk(adjustBaseballScore(state, 'opponent', 1, 'Scorebook reconciliation', ctx()))
    expect(projection(state).score.opponent).toBe(1)
    expect(adjustBaseballScore(state, 'tracked', -1, 'Nope', ctx()).ok).toBe(false)
  })

  it('projects the shared scoreboard and player stats', () => {
    let state = startedGame()
    state = threeUpThreeDown(state)
    state = ballInPlay(state, 'home_run')
    expect(state.homeTeamScore).toBe(1)
    expect(state.opponentScore).toBe(0)
    const t1 = state.players.find(player => player.id === 'player-t1')!
    expect(t1.stats).toMatchObject({ bsb_hr: 1, bsb_rbi: 1, bsb_r: 1, bsb_p_k: 3, bsb_p_outs: 3 })
  })
})

describe('Lineup changes', () => {
  it('pinch hits, pinch runs and enforces re-entry rules', () => {
    let state = startedGame()
    state = threeUpThreeDown(state)
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'pinch_hitter', incomingId: 't10', outgoingId: 't1' }, ctx()))
    expect(projection(state).currentBatterId).toBe('t10')
    state = ballInPlay(state, 'single')
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'pinch_runner', incomingId: 't11', outgoingId: 't10' }, ctx()))
    let p = projection(state)
    expect(p.bases.first?.runnerId).toBe('t11')
    expect(p.lineups.tracked.battingOrder[0]).toBe('t11')
    expect(p.lineups.tracked.removedIds).toEqual(['t1', 't10'])
    expect(p.lineups.tracked.defense['1']).toBeUndefined()
    state = strikeout(strikeout(strikeout(state)))

    // Pitcher position is vacant: play cannot continue until it is filled.
    expect(recordBaseballPitch(state, { result: 'ball' }, ctx()).ok).toBe(false)
    // Starter t1 re-enters once in the original slot (NFHS), replacing t11.
    state = expectOk(
      substituteBaseball(state, 'tracked', { kind: 'defensive', position: 1, incomingId: 't1', outgoingId: 't11' }, ctx())
    )
    p = projection(state)
    expect(p.lineups.tracked).toMatchObject({ pitcherId: 't1', reenteredIds: ['t1'] })
    expect(p.lineups.tracked.battingOrder[0]).toBe('t1')
    // t10 was a substitute: no re-entry.
    const denied = substituteBaseball(state, 'tracked', { kind: 'defensive', position: 9, incomingId: 't10', outgoingId: null }, ctx())
    expect(denied.ok).toBe(false)
  })

  it('changes pitchers, tracks inherited runners and charges runs to the responsible pitcher', () => {
    let state = startedGame()
    state = walk(state)
    state = expectOk(
      substituteBaseball(state, 'tracked', { kind: 'position_change', assignments: [
        { participantId: 't9', position: 1 },
        { participantId: 't1', position: 9 },
      ] }, ctx())
    )
    let p = projection(state)
    expect(p.lineups.tracked.pitcherId).toBe('t9')
    expect(p.pitchingLines.t9.inheritedRunners).toBe(1)
    state = ballInPlay(state, 'home_run')
    p = projection(state)
    expect(p.pitchingLines.t1).toMatchObject({ r: 1, er: 1 })
    expect(p.pitchingLines.t9).toMatchObject({ r: 1, hr: 1, inheritedRunnersScored: 1 })

    state = expectOk(
      substituteBaseball(state, 'opponent', { kind: 'opponent_pitcher', pitcher: { id: 'opp-p2', label: 'Reliever', number: '44', throws: 'L' } }, ctx())
    )
    expect(projection(state).lineups.opponent.pitcherId).toBe('opp-p2')
  })

  it('updates opponent slot labels without inventing players', () => {
    let state = startedGame()
    state = expectOk(
      substituteBaseball(state, 'opponent', { kind: 'opponent_slot', slotId: 'o1', label: 'Garcia', number: '12', position: 'CF', bats: 'L' }, ctx())
    )
    expect(projection(state).opponentSlotDetails.o1).toMatchObject({ label: 'Garcia', number: '12', position: 'CF' })
    expect(state.players.some(player => player.name === 'Garcia')).toBe(false)
  })

  it('uses courtesy runners only for the pitcher or catcher', () => {
    let state = startedGame()
    state = threeUpThreeDown(state)
    state = ballInPlay(state, 'single')
    expect(substituteBaseball(state, 'tracked', { kind: 'courtesy_runner', incomingId: 't10', outgoingId: 't1' }, ctx()).ok).toBe(true)
    state = ballInPlay(state, 'single')
    expect(substituteBaseball(state, 'tracked', { kind: 'courtesy_runner', incomingId: 't11', outgoingId: 't3' }, ctx()).ok).toBe(false)
  })
})

describe('Stats helpers', () => {
  it('formats and computes rates', () => {
    expect(formatInningsPitched(20)).toBe('6.2')
    let state = startedGame()
    state = ballInPlay(state, 'single')
    state = walk(state)
    const p = projection(state)
    expect(battingAverage(p.battingLines.o1)).toBe(1)
    expect(onBasePercentage(p.battingLines.o2)).toBe(1)
    expect(sluggingPercentage(p.battingLines.o1)).toBe(1)
    expect(earnedRunAverage(p.pitchingLines.t1, 7)).toBeNull()
  })

  it('proposes standard movements for each result', () => {
    let state = startedGame()
    state = walk(state)
    const p = projection(state)
    expect(proposeBaseballMovements(p, 'single').map(value => `${value.from}->${value.to}`)).toEqual([
      'batter->first',
      'first->second',
    ])
    expect(proposeBaseballMovements(p, 'fielders_choice', [6, 4]).map(value => `${value.from}->${value.to}`)).toEqual([
      'batter->first',
      'first->out',
    ])
  })
})

describe('Full game replay', () => {
  it('plays a complete 7-inning game and replays deterministically from the raw stream', () => {
    let state = startedGame()
    for (let inning = 1; inning <= 7; inning += 1) {
      state = threeUpThreeDown(state)
      if (inning === 7) break
      if (inning === 3) state = ballInPlay(state, 'home_run')
      state = threeUpThreeDown(state)
    }
    const p = projection(state)
    expect(p.pendingEnd).toBe('regulation')
    state = expectOk(endBaseballGame(state, 'completed', ctx()))
    const final = projection(state)
    expect(final.result).toEqual({ outcome: 'completed', winner: 'tracked', note: null })
    expect(final.lineScore).toHaveLength(13)
    expect(final.pitchingLines.t1).toMatchObject({ outs: 21, k: 21, bf: 21 })

    const rebuilt = rebuildGameEventProjection(
      { ...state, sportGameState: { ...state.sportGameState!, projection: {} } as never },
      gameEventRegistry,
      gameEventProjectors
    )
    expect(rebuilt.inspection.complete).toBe(true)
    expect(projection(rebuilt.state)).toEqual(final)
  })
})
