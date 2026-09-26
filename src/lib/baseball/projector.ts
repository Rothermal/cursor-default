import type { GameState } from '../../types'
import { compareGameEventCaptureOrder } from '../gameEvents/stream'
import type {
  GameEvent,
  GameEventDiagnostic,
  SportGameEventProjectionResult,
  SportGameEventProjector,
} from '../gameEvents/types'
import { basePosition } from './events'
import { baseballPeriod } from './periods'
import { createBaseballMatchProjection } from './state'
import { baseballPlayerStatsById } from './stats'
import type {
  BaseballBase,
  BaseballBattingLine,
  BaseballEvent,
  BaseballFieldingLine,
  BaseballHalfInningLine,
  BaseballInPlay,
  BaseballMatchProjection,
  BaseballMatchRules,
  BaseballMatchSetup,
  BaseballMovementReason,
  BaseballPitchingLine,
  BaseballPlateAppearanceOutcome,
  BaseballReachKind,
  BaseballRunner,
  BaseballRunnerMovement,
  BaseballSideLineup,
  BaseballSportGameState,
  BaseballSubstitution,
  BaseballTeamSide,
} from './types'

const BASES: readonly BaseballBase[] = ['first', 'second', 'third']
const HITS = new Set(['single', 'double', 'triple', 'home_run', 'ground_rule_double'])
const HIT_MIN_BASE: Record<string, number> = {
  single: 1,
  double: 2,
  ground_rule_double: 2,
  triple: 3,
  home_run: 4,
}
const HIT_BASES: Record<string, number> = { single: 1, double: 2, ground_rule_double: 2, triple: 3, home_run: 4 }
const RUNNING_REASONS = new Set<BaseballMovementReason>([
  'stolen_base',
  'caught_stealing',
  'pickoff',
  'wild_pitch',
  'passed_ball',
  'balk',
  'error',
  'throw',
  'defensive_indifference',
  'appeal',
  'interference',
  'obstruction',
  'awarded',
])
const RBI_REASONS = new Set<BaseballMovementReason>(['on_play', 'forced', 'awarded'])
const NO_AT_BAT = new Set<BaseballPlateAppearanceOutcome>([
  'walk',
  'intentional_walk',
  'hit_by_pitch',
  'catcher_interference',
  'sacrifice_bunt',
  'sacrifice_fly',
])

export class BaseballReplayError extends Error {}

type Terminal =
  | { kind: 'walk'; intentional: boolean }
  | { kind: 'hit_by_pitch' }
  | { kind: 'catcher_interference' }
  | { kind: 'strikeout'; looking: boolean }
  | { kind: 'in_play'; inPlay: BaseballInPlay }

interface ReplayOutput {
  projection: BaseballMatchProjection
  diagnostics: GameEventDiagnostic[]
}

/** Replays Baseball events in capture order and stops at the first invalid event. */
export function replayBaseballEvents(setup: BaseballMatchSetup, events: readonly GameEvent[]): ReplayOutput {
  const replay = new BaseballReplay(setup)
  const ordered = [...events].sort(compareGameEventCaptureOrder)
  for (const event of ordered) {
    try {
      replay.apply(event as BaseballEvent)
    } catch (error) {
      if (!(error instanceof BaseballReplayError)) throw error
      return {
        projection: replay.projection,
        diagnostics: [
          {
            code: 'semantic_validation_failed',
            message: error.message,
            eventId: event.id,
          },
        ],
      }
    }
  }
  return { projection: replay.projection, diagnostics: [] }
}

export const baseballGameEventProjector: SportGameEventProjector = {
  sportId: 'baseball',
  requiresSportGameState: true,
  project: (state: GameState, events: GameEvent[]): SportGameEventProjectionResult => {
    const sportState = state.sportGameState
    if (!sportState || sportState.sportId !== 'baseball') {
      return {
        projection: emptyProjection(state),
        diagnostics: [
          { code: 'missing_authoritative_data', message: 'Baseball setup is missing.', eventId: null },
        ],
      }
    }
    const baseball = sportState as BaseballSportGameState
    const { projection, diagnostics } = replayBaseballEvents(baseball.setup, events)
    const nextSportState: BaseballSportGameState = { ...baseball, projection }
    return {
      projection: {
        playerStatsById: baseballPlayerStatsById(baseball.setup, projection),
        homeTeamScore: projection.score.tracked,
        opponentScore: projection.score.opponent,
        shotChart: [],
        currentPeriod: projection.inning * 2 - (projection.half === 'top' ? 1 : 0),
        sportGameState: nextSportState,
      },
      diagnostics,
    }
  },
}

function emptyProjection(state: GameState) {
  return {
    playerStatsById: {},
    homeTeamScore: state.homeTeamScore,
    opponentScore: state.opponentScore,
    shotChart: [],
  }
}

// ---------------------------------------------------------------------------

class BaseballReplay {
  readonly projection: BaseballMatchProjection
  private readonly rules: BaseballMatchRules
  private readonly originalSlotById: Map<string, number>

  constructor(private readonly setup: BaseballMatchSetup) {
    this.projection = createBaseballMatchProjection(setup)
    this.rules = setup.rulesSnapshot
    this.originalSlotById = new Map(setup.trackedLineup.battingOrder.map((id, index) => [id, index]))
  }

  apply(event: BaseballEvent): void {
    const p = this.projection
    if (event.eventType === 'baseball.game_started') {
      if (p.status !== 'pregame') fail('The game has already started.')
      this.expectPeriod(event, 1, 'top')
      p.status = 'in_progress'
      this.openHalf(1, 'top')
      return
    }
    if (event.eventType === 'baseball.game_reopened') {
      if (p.status === 'pregame' || p.status === 'in_progress') fail('Only a finished game can be reopened.')
      this.expectCurrentPeriod(event)
      p.status = 'in_progress'
      p.result = null
      return
    }
    if (p.status === 'pregame') {
      if (event.eventType === 'baseball.substitution') {
        this.expectPeriod(event, 1, 'top')
        this.applySubstitution(event.teamSide as BaseballTeamSide, event.payload.substitution)
        return
      }
      fail('Start the game before recording play.')
    }
    if (p.status !== 'in_progress') fail('This game is over; reopen it to record more.')
    this.expectCurrentPeriod(event)

    switch (event.eventType) {
      case 'baseball.game_ended':
        this.applyGameEnd(event.payload.outcome, event.payload.forfeitWinner, event.payload.note)
        return
      case 'baseball.score_adjustment': {
        const side = event.teamSide as BaseballTeamSide
        const next = p.score[side] + event.payload.delta
        if (next < 0) fail('A score cannot become negative.')
        p.score[side] = next
        return
      }
      case 'baseball.substitution':
        this.applySubstitution(event.teamSide as BaseballTeamSide, event.payload.substitution)
        return
      default:
        break
    }

    if (p.pendingEnd) fail('The game can end now; record the ending or correct earlier play.')
    switch (event.eventType) {
      case 'baseball.half_inning_ended':
        if (p.outs >= 3) fail('The half-inning already ended.')
        this.closeHalf()
        return
      case 'baseball.pitch':
        this.expectBattingSide(event)
        this.applyPitch(event)
        return
      case 'baseball.plate_appearance':
        this.expectBattingSide(event)
        this.applyQuickPlateAppearance(event)
        return
      case 'baseball.baserunning':
        this.expectBattingSide(event)
        this.requireDefense()
        if (event.payload.play === 'balk' && !this.rules.balks) fail('Balks are not called under these rules.')
        this.applyMovements(event.payload.movements, null)
        this.afterPlay()
        return
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle

  private expectPeriod(event: GameEvent, inning: number, half: 'top' | 'bottom'): void {
    const expected = baseballPeriod(inning, half)
    if (event.period.id !== expected.id || event.period.order !== expected.order) {
      fail(`Expected an event in ${expected.id}.`)
    }
  }

  private expectCurrentPeriod(event: GameEvent): void {
    this.expectPeriod(event, this.projection.inning, this.projection.half)
  }

  private expectBattingSide(event: GameEvent): void {
    if (event.teamSide !== this.projection.battingSide) fail('Offensive events belong to the batting side.')
  }

  private openHalf(inning: number, half: 'top' | 'bottom'): void {
    const p = this.projection
    p.inning = inning
    p.half = half
    const homeSide = this.homeSide()
    p.battingSide = half === 'top' ? otherSide(homeSide) : homeSide
    p.outs = 0
    this.resetCount()
    p.bases = { first: null, second: null, third: null }
    p.lineScore.push({
      inning,
      half,
      battingSide: p.battingSide,
      runs: 0,
      hits: 0,
      errors: 0,
      leftOnBase: 0,
      complete: false,
    })
    const placedBase = this.rules.placedRunnerBase
    const fromInning = this.rules.placedRunnerFromInning
    if (placedBase && fromInning !== null && inning >= fromInning) {
      const lineup = this.battingLineup()
      const length = lineup.battingOrder.length
      const runnerId = lineup.battingOrder[(lineup.nextBatterIndex - 1 + length) % length]
      p.bases[placedBase] = {
        runnerId,
        responsiblePitcherId: this.fieldingLineup().pitcherId,
        reachedBy: 'placed_runner',
        unearned: true,
      }
    }
    p.currentBatterId = this.currentBatterId()
  }

  private closeHalf(): void {
    const p = this.projection
    const line = this.currentHalfLine()
    line.leftOnBase = BASES.filter(base => p.bases[base] !== null).length
    line.complete = true
    p.bases = { first: null, second: null, third: null }
    this.resetCount()

    const homeSide = this.homeSide()
    const awaySide = otherSide(homeSide)
    const home = p.score[homeSide]
    const away = p.score[awaySide]
    const inning = p.inning
    if (p.half === 'top') {
      if (inning >= this.rules.scheduledInnings && home > away) {
        p.pendingEnd = 'regulation'
        return
      }
      if (this.runRuleMet(inning, home - away)) {
        p.pendingEnd = 'run_rule'
        return
      }
      this.openHalf(inning, 'bottom')
      return
    }
    if (this.runRuleMet(inning, Math.abs(home - away))) {
      p.pendingEnd = 'run_rule'
      return
    }
    if (inning >= this.rules.scheduledInnings && (home !== away || !this.rules.extraInningsAllowed)) {
      p.pendingEnd = 'regulation'
      return
    }
    this.openHalf(inning + 1, 'top')
  }

  private runRuleMet(inning: number, lead: number): boolean {
    return this.rules.runRules.some(rule => inning >= rule.afterInning && lead >= rule.lead)
  }

  private afterPlay(): void {
    const p = this.projection
    if (p.outs >= 3) {
      this.closeHalf()
      return
    }
    if (p.half === 'bottom') {
      const homeSide = this.homeSide()
      const lead = p.score[homeSide] - p.score[otherSide(homeSide)]
      if (lead > 0 && p.inning >= this.rules.scheduledInnings) {
        this.currentHalfLine().complete = true
        p.pendingEnd = 'walk_off'
        return
      }
      if (lead > 0 && this.runRuleMet(p.inning, lead)) {
        this.currentHalfLine().complete = true
        p.pendingEnd = 'run_rule'
        return
      }
    }
    const max = this.rules.maxRunsPerHalfInning
    if (max !== null && this.currentHalfLine().runs >= max) this.closeHalf()
  }

  private applyGameEnd(
    outcome: BaseballEvent<'baseball.game_ended'>['payload']['outcome'],
    forfeitWinner: BaseballTeamSide | null,
    note: string | null
  ): void {
    const p = this.projection
    if (outcome === 'completed' && p.pendingEnd !== 'regulation' && p.pendingEnd !== 'walk_off') {
      fail('The game is not complete yet.')
    }
    if (outcome === 'run_rule' && p.pendingEnd !== 'run_rule') fail('The run rule has not been reached.')
    const line = p.lineScore[p.lineScore.length - 1]
    if (line && !line.complete) {
      line.leftOnBase = BASES.filter(base => p.bases[base] !== null).length
      line.complete = true
    }
    p.status = outcome === 'suspended' ? 'suspended' : outcome === 'abandoned' ? 'abandoned' : 'final'
    let winner: BaseballTeamSide | 'tie' | null
    if (outcome === 'forfeit') winner = forfeitWinner
    else if (outcome === 'suspended' || outcome === 'abandoned') winner = null
    else if (p.score.tracked === p.score.opponent) winner = 'tie'
    else winner = p.score.tracked > p.score.opponent ? 'tracked' : 'opponent'
    if (winner === 'tie' && outcome !== 'time_limit' && !this.rules.tiesAllowed && this.rules.extraInningsAllowed) {
      fail('A tie is not a legal result under these rules.')
    }
    p.result = { outcome, winner, note }
  }

  // -------------------------------------------------------------------------
  // Pitches and plate appearances

  private applyPitch(event: BaseballEvent<'baseball.pitch'>): void {
    this.requireDefense()
    const p = this.projection
    const { result } = event.payload
    const pitcher = this.pitchingLine(this.fieldingLineup().pitcherId, otherSide(p.battingSide))
    const batterId = this.currentBatterId()
    const batter = this.battingLine(batterId)
    const isBall = result === 'ball' || result === 'intentional_ball' || result === 'pitchout'
    const isHbp = result === 'hit_by_pitch'
    pitcher.pitches += 1
    batter.pitchesSeen += 1
    if (isBall || isHbp) pitcher.balls += 1
    else pitcher.strikes += 1
    if (p.pitchesInPlateAppearance === 0 && !isBall && !isHbp) pitcher.firstPitchStrikes += 1
    p.pitchesInPlateAppearance += 1

    const strikeLimit = this.rules.strikesForStrikeout
    let terminal: Terminal | null = null
    switch (result) {
      case 'ball':
      case 'pitchout':
      case 'intentional_ball':
        p.balls += 1
        if (p.balls >= this.rules.ballsForWalk) terminal = { kind: 'walk', intentional: result === 'intentional_ball' }
        break
      case 'called_strike':
      case 'swinging_strike':
      case 'missed_bunt':
      case 'foul_tip':
        p.strikes += 1
        if (p.strikes >= strikeLimit) terminal = { kind: 'strikeout', looking: result === 'called_strike' }
        break
      case 'foul':
        if (p.strikes < strikeLimit - 1) p.strikes += 1
        else if (this.rules.twoStrikeFoulIsOut) terminal = { kind: 'strikeout', looking: false }
        break
      case 'foul_bunt':
        if (p.strikes < strikeLimit - 1) p.strikes += 1
        else if (this.rules.twoStrikeFoulBuntIsStrikeout) terminal = { kind: 'strikeout', looking: false }
        break
      case 'hit_by_pitch':
        terminal = { kind: 'hit_by_pitch' }
        break
      case 'in_play':
        terminal = { kind: 'in_play', inPlay: event.payload.inPlay! }
        break
    }
    this.applyMovements(event.payload.movements, terminal)
    if (terminal) this.completePlateAppearance(event, batterId, terminal, true)
    this.afterPlay()
  }

  private applyQuickPlateAppearance(event: BaseballEvent<'baseball.plate_appearance'>): void {
    this.requireDefense()
    const p = this.projection
    if (p.pitchesInPlateAppearance > 0) fail('Pitches were tracked for this batter; finish with a pitch.')
    const { result } = event.payload
    const terminal: Terminal =
      result === 'walk' || result === 'intentional_walk'
        ? { kind: 'walk', intentional: result === 'intentional_walk' }
        : result === 'hit_by_pitch'
          ? { kind: 'hit_by_pitch' }
          : result === 'catcher_interference'
            ? { kind: 'catcher_interference' }
            : result === 'in_play'
              ? { kind: 'in_play', inPlay: event.payload.inPlay! }
              : { kind: 'strikeout', looking: result === 'strikeout_looking' }
    const batterId = this.currentBatterId()
    const pitcher = this.pitchingLine(this.fieldingLineup().pitcherId, otherSide(p.battingSide))
    const { finalBalls, finalStrikes } = event.payload
    if (finalBalls !== null && finalStrikes !== null) {
      if (finalBalls > this.rules.ballsForWalk || finalStrikes > this.rules.strikesForStrikeout) {
        fail('The final count is not possible under these rules.')
      }
      if (result !== 'intentional_walk' && result !== 'catcher_interference') {
        // The final count excludes the deciding pitch for balls in play and hit batters.
        // Two-strike fouls are not recoverable from a count, so this is a lower bound.
        const balls = Math.max(0, finalBalls - this.rules.startingBalls) + (result === 'hit_by_pitch' ? 1 : 0)
        const strikes = Math.max(0, finalStrikes - this.rules.startingStrikes) + (result === 'in_play' ? 1 : 0)
        pitcher.pitches += balls + strikes
        pitcher.balls += balls
        pitcher.strikes += strikes
        this.battingLine(batterId).pitchesSeen += balls + strikes
      }
    }
    if (result !== 'intentional_walk' && result !== 'catcher_interference') pitcher.untrackedPlateAppearances += 1
    this.applyMovements(event.payload.movements, terminal)
    this.completePlateAppearance(event, batterId, terminal, false)
    this.afterPlay()
  }

  private completePlateAppearance(
    event: GameEvent,
    batterId: string,
    terminal: Terminal,
    pitchesTracked: boolean
  ): void {
    const p = this.projection
    const outcome: BaseballPlateAppearanceOutcome =
      terminal.kind === 'walk'
        ? terminal.intentional ? 'intentional_walk' : 'walk'
        : terminal.kind === 'in_play'
          ? terminal.inPlay.result
          : terminal.kind
    const batter = this.battingLine(batterId)
    const pitcherId = this.fieldingLineup().pitcherId
    const pitcher = this.pitchingLine(pitcherId, otherSide(p.battingSide))
    batter.pa += 1
    pitcher.bf += 1
    if (!NO_AT_BAT.has(outcome)) batter.ab += 1
    switch (outcome) {
      case 'walk':
        batter.bb += 1
        pitcher.bb += 1
        break
      case 'intentional_walk':
        batter.bb += 1
        batter.ibb += 1
        pitcher.bb += 1
        pitcher.ibb += 1
        break
      case 'hit_by_pitch':
        batter.hbp += 1
        pitcher.hbp += 1
        break
      case 'catcher_interference':
        batter.ci += 1
        break
      case 'strikeout':
        batter.k += 1
        if (terminal.kind === 'strikeout' && terminal.looking) batter.kLooking += 1
        pitcher.k += 1
        break
      case 'error':
        batter.roe += 1
        break
      case 'fielders_choice':
        batter.fc += 1
        break
      case 'sacrifice_bunt':
        batter.sh += 1
        break
      case 'sacrifice_fly':
        batter.sf += 1
        break
      case 'double_play':
        if (terminal.kind === 'in_play' && terminal.inPlay.battedBallType === 'ground') batter.gidp += 1
        break
      default:
        break
    }
    if (HITS.has(outcome)) {
      const bases = HIT_BASES[outcome]
      batter.h += 1
      batter.tb += bases
      if (bases === 1) batter.singles += 1
      else if (bases === 2) batter.doubles += 1
      else if (bases === 3) batter.triples += 1
      else batter.hr += 1
      pitcher.h += 1
      if (bases === 4) pitcher.hr += 1
      this.currentHalfLine().hits += 1
    }
    const record = this.pendingPlay
    p.plateAppearances.push({
      eventId: event.id,
      inning: p.inning,
      half: p.half,
      battingSide: p.battingSide,
      batterId,
      pitcherId,
      outcome,
      pitches: pitchesTracked ? p.pitchesInPlateAppearance : 0,
      pitchesTracked,
      runs: record.runs,
      rbi: record.rbi,
      location: event.location,
    })
    const lineup = this.battingLineup()
    lineup.nextBatterIndex = (lineup.nextBatterIndex + 1) % lineup.battingOrder.length
    this.resetCount()
  }

  private resetCount(): void {
    const p = this.projection
    p.balls = this.rules.startingBalls
    p.strikes = this.rules.startingStrikes
    p.pitchesInPlateAppearance = 0
    p.currentBatterId = p.status === 'in_progress' ? this.currentBatterId() : null
  }

  // -------------------------------------------------------------------------
  // Runner movements

  private pendingPlay = { runs: 0, rbi: 0 }

  private applyMovements(
    movements: readonly BaseballRunnerMovement[],
    terminal: Terminal | null
  ): void {
    const p = this.projection
    this.pendingPlay = { runs: 0, rbi: 0 }
    const batterId = this.currentBatterId()
    const batterMovement = movements.find(movement => movement.from === 'batter') ?? null
    const runnerMovements = movements.filter(movement => movement.from !== 'batter')

    // Occupancy.
    for (const movement of runnerMovements) {
      const runner = p.bases[movement.from as BaseballBase]
      if (!runner || runner.runnerId !== movement.runnerId) fail(`No such runner on ${movement.from} base.`)
    }
    if (batterMovement && batterMovement.runnerId !== batterId) fail('The batter movement names another player.')
    this.validateContext(movements, batterMovement, terminal)

    // Final positions and ordering.
    const forcedAtStart = this.forcedBases(terminal)
    type Entry = { runnerId: string; start: number; final: number; movement: BaseballRunnerMovement | null }
    const entries: Entry[] = []
    for (const base of BASES) {
      const runner = p.bases[base]
      if (!runner) continue
      const movement = runnerMovements.find(value => value.runnerId === runner.runnerId) ?? null
      entries.push({ runnerId: runner.runnerId, start: basePosition(base), final: movement ? basePosition(movement.to) : basePosition(base), movement })
    }
    if (terminal) {
      if (!batterMovement) fail('Say what happened to the batter.')
      entries.push({ runnerId: batterId, start: 0, final: basePosition(batterMovement.to), movement: batterMovement })
    }
    entries.sort((left, right) => right.start - left.start)
    const OUT = basePosition('out')
    let leadFinal = Number.POSITIVE_INFINITY
    for (const entry of entries) {
      if (entry.final === OUT) continue
      if (entry.final === 4) {
        if (leadFinal !== Number.POSITIVE_INFINITY && leadFinal !== 4) fail('A runner cannot pass the runner ahead.')
        leadFinal = 4
        continue
      }
      if (entry.final >= leadFinal) fail('Two runners cannot finish on the same base or pass each other.')
      leadFinal = entry.final
    }

    const outMovements = movements.filter(movement => movement.to === 'out')
    if (p.outs + outMovements.length > 3) fail('A half-inning has only three outs.')
    const endsHalf = p.outs + outMovements.length === 3
    let runsCountByDefault = true
    if (endsHalf) {
      const thirdOut = outMovements[3 - p.outs - 1]
      const batterOutBefore = outMovements.indexOf(thirdOut) > 0 &&
        outMovements.slice(0, outMovements.indexOf(thirdOut)).some(value => value.from === 'batter')
      const isForce = thirdOut.from !== 'batter' && forcedAtStart.has(thirdOut.from as BaseballBase) && !batterOutBefore
      // A batter credited with a hit reached first before being put out.
      const batterReachedFirst = terminal?.kind === 'in_play' && HITS.has(terminal.inPlay.result)
      const batterOutBeforeFirst = thirdOut.from === 'batter' && !batterReachedFirst
      if (batterOutBeforeFirst || isForce) runsCountByDefault = false
    }
    this.validateResult(terminal, entries.filter(entry => entry.movement?.from === 'batter')[0]?.final ?? null, outMovements.length, movements)

    // Credit outs in listed order.
    const fieldingSide = otherSide(p.battingSide)
    const pitcherId = this.fieldingLineup().pitcherId
    const pitcher = this.pitchingLine(pitcherId, fieldingSide)
    const dpFielders = new Set<number>()
    for (const movement of outMovements) {
      p.outs += 1
      pitcher.outs += 1
      let fielders = movement.fielders
      if (fielders.length === 0 && movement.from === 'batter' && terminal?.kind === 'strikeout') fielders = [2]
      this.creditOut(fielders)
      if (outMovements.length >= 2) fielders.forEach(value => dpFielders.add(value))
      if (movement.reason === 'caught_stealing') {
        this.battingLine(movement.runnerId).cs += 1
        this.fielding(2).cs += 1
      }
      if (movement.reason === 'pickoff') this.battingLine(movement.runnerId).pickedOff += 1
    }
    dpFielders.forEach(value => {
      this.fielding(value).dp += 1
    })

    // Errors: one per fielder per event.
    const errorFielders = new Set<number>()
    if (terminal?.kind === 'in_play' && terminal.inPlay.errorBy !== null) errorFielders.add(terminal.inPlay.errorBy)
    for (const movement of movements) if (movement.errorBy !== null) errorFielders.add(movement.errorBy)
    errorFielders.forEach(value => {
      this.fielding(value).e += 1
      this.currentHalfLine().errors += 1
    })

    // Runs and new base state.
    const nextBases: Record<BaseballBase, BaseballRunner | null> = { first: null, second: null, third: null }
    const priorRunners = new Map(BASES.flatMap(base => (p.bases[base] ? [[p.bases[base]!.runnerId, p.bases[base]!]] : [])))
    const isPaEvent = terminal !== null
    for (const entry of entries) {
      const movement = entry.movement
      if (movement?.reason === 'stolen_base') {
        this.battingLine(entry.runnerId).sb += 1
        this.fielding(2).sbAllowed += 1
      }
      const runner = priorRunners.get(entry.runnerId) ?? (entry.start === 0 ? this.newBatterRunner(batterId, terminal!, movement!, pitcherId) : null)
      if (!runner) continue
      if (entry.final === OUT) continue
      if (entry.final === 4) {
        const counts = movement?.runCounts ?? runsCountByDefault
        if (!counts) continue
        this.scoreRun(runner, movement!, pitcherId, isPaEvent, terminal)
        continue
      }
      nextBases[BASES[entry.final - 1]] = {
        ...runner,
        unearned: runner.unearned || (movement !== null && (movement.errorBy !== null || movement.reason === 'passed_ball')),
      }
    }
    p.bases = nextBases

    // Pitcher/catcher credits for the event.
    if (movements.some(movement => movement.reason === 'wild_pitch')) pitcher.wp += 1
    if (movements.some(movement => movement.reason === 'balk')) pitcher.bk += 1
    if (movements.some(movement => movement.reason === 'passed_ball')) this.fielding(2).pb += 1
  }

  private validateContext(
    movements: readonly BaseballRunnerMovement[],
    batterMovement: BaseballRunnerMovement | null,
    terminal: Terminal | null
  ): void {
    const p = this.projection
    if (!terminal) {
      if (batterMovement) fail('The batter can only run when the plate appearance ends.')
      for (const movement of movements) {
        if (!RUNNING_REASONS.has(movement.reason)) fail('Use a running reason for runners between plate appearances.')
        if (movement.reason === 'stolen_base' && !this.rules.stealing) fail('Stealing is not allowed under these rules.')
      }
      return
    }
    if (!batterMovement) fail('Say what happened to the batter.')
    switch (terminal.kind) {
      case 'walk':
      case 'hit_by_pitch':
      case 'catcher_interference': {
        if (batterMovement.to === 'out') fail('The batter is awarded first base.')
        for (const base of this.forcedBases(terminal)) {
          const runner = p.bases[base]!
          const movement = movements.find(value => value.runnerId === runner.runnerId)
          if (!movement) fail(`The runner on ${base} base is forced to advance.`)
        }
        return
      }
      case 'strikeout':
        if (batterMovement.to !== 'out') {
          if (batterMovement.reason !== 'dropped_third_strike') fail('A strikeout batter is out unless the third strike is dropped.')
          if (!this.rules.droppedThirdStrike) fail('Dropped third strikes are not played under these rules.')
          if (p.bases.first && p.outs < 2) fail('The batter cannot run on a dropped third strike with first base occupied.')
        }
        return
      case 'in_play':
        if (batterMovement.reason === 'dropped_third_strike') fail('Use a normal reason for a ball in play.')
        return
    }
  }

  private validateResult(
    terminal: Terminal | null,
    batterFinal: number | null,
    outsOnPlay: number,
    movements: readonly BaseballRunnerMovement[]
  ): void {
    if (terminal?.kind !== 'in_play') return
    const result = terminal.inPlay.result
    const batterOut = batterFinal === basePosition('out')
    const runsScored = movements.filter(movement => movement.to === 'home' && movement.from !== 'batter').length
    if (HITS.has(result)) {
      if (!batterOut && (batterFinal ?? 0) < HIT_MIN_BASE[result]) fail('The batter must reach at least the base of the hit.')
      if (result === 'home_run' && batterOut) fail('A home run batter cannot be out.')
      return
    }
    switch (result) {
      case 'out':
        if (!batterOut) fail('The batter is out on this result.')
        return
      case 'error':
        if (batterOut) fail('The batter reached on the error.')
        return
      case 'fielders_choice':
        if (batterOut) fail('The batter reached on the fielder\'s choice.')
        return
      case 'sacrifice_bunt':
        if (!movements.some(movement => movement.from !== 'batter' && movement.to !== 'out')) {
          fail('A sacrifice bunt advances a runner.')
        }
        return
      case 'sacrifice_fly':
        if (!batterOut || runsScored < 1) fail('A sacrifice fly is a caught fly ball that scores a run.')
        return
      case 'double_play':
        if (outsOnPlay !== 2) fail('A double play records two outs.')
        return
      case 'triple_play':
        if (outsOnPlay !== 3) fail('A triple play records three outs.')
        return
    }
  }

  /** Bases whose runners are forced when the batter becomes a runner. */
  private forcedBases(terminal: Terminal | null): Set<BaseballBase> {
    const forced = new Set<BaseballBase>()
    if (!terminal) return forced
    const bases = this.projection.bases
    if (!bases.first) return forced
    forced.add('first')
    if (!bases.second) return forced
    forced.add('second')
    if (bases.third) forced.add('third')
    return forced
  }

  private newBatterRunner(
    batterId: string,
    terminal: Terminal,
    movement: BaseballRunnerMovement,
    pitcherId: string
  ): BaseballRunner {
    let reachedBy: BaseballReachKind
    switch (terminal.kind) {
      case 'walk':
        reachedBy = 'walk'
        break
      case 'hit_by_pitch':
        reachedBy = 'hit_by_pitch'
        break
      case 'catcher_interference':
        reachedBy = 'catcher_interference'
        break
      case 'strikeout':
        reachedBy = 'dropped_third_strike'
        break
      case 'in_play': {
        const result = terminal.inPlay.result
        reachedBy = HITS.has(result)
          ? 'hit'
          : result === 'error' || terminal.inPlay.errorBy !== null
            ? 'error'
            : 'fielders_choice'
        break
      }
    }
    return {
      runnerId: batterId,
      responsiblePitcherId: pitcherId,
      reachedBy,
      unearned:
        reachedBy === 'error' ||
        reachedBy === 'catcher_interference' ||
        movement.errorBy !== null ||
        movement.reason === 'passed_ball',
    }
  }

  private scoreRun(
    runner: BaseballRunner,
    movement: BaseballRunnerMovement,
    currentPitcherId: string,
    isPaEvent: boolean,
    terminal: Terminal | null
  ): void {
    const p = this.projection
    const side = p.battingSide
    p.score[side] += 1
    this.currentHalfLine().runs += 1
    this.battingLine(runner.runnerId).r += 1
    this.pendingPlay.runs += 1
    const responsible = this.pitchingLine(runner.responsiblePitcherId, otherSide(side))
    responsible.r += 1
    const unearnedByDefault =
      runner.unearned || movement.errorBy !== null || movement.reason === 'passed_ball' || movement.reason === 'error'
    if (movement.earned ?? !unearnedByDefault) responsible.er += 1
    if (runner.responsiblePitcherId !== currentPitcherId) {
      this.pitchingLine(currentPitcherId, otherSide(side)).inheritedRunnersScored += 1
    }
    const groundDoublePlay =
      terminal?.kind === 'in_play' &&
      terminal.inPlay.result === 'double_play' &&
      terminal.inPlay.battedBallType === 'ground'
    const rbiByDefault =
      isPaEvent &&
      RBI_REASONS.has(movement.reason) &&
      movement.errorBy === null &&
      !groundDoublePlay &&
      !(terminal?.kind === 'in_play' && terminal.inPlay.result === 'error' && movement.from !== 'third')
    if (isPaEvent && (movement.rbi ?? rbiByDefault)) {
      this.battingLine(this.currentBatterId()).rbi += 1
      this.pendingPlay.rbi += 1
    }
  }

  private creditOut(fielders: readonly number[]): void {
    if (fielders.length === 0) return
    fielders.slice(0, -1).forEach((value, index, list) => {
      if (list.indexOf(value) === index && value !== fielders[fielders.length - 1]) this.fielding(value).a += 1
    })
    this.fielding(fielders[fielders.length - 1]).po += 1
  }

  // -------------------------------------------------------------------------
  // Substitutions

  private applySubstitution(side: BaseballTeamSide, substitution: BaseballSubstitution): void {
    if (side === 'opponent') {
      this.applyOpponentChange(substitution)
      return
    }
    const p = this.projection
    const lineup = p.lineups.tracked
    const participantIds = new Set(this.setup.participants.map(participant => participant.id))
    switch (substitution.kind) {
      case 'pinch_hitter': {
        if (p.status !== 'in_progress' || p.battingSide !== 'tracked') fail('Pinch hit while your team is batting.')
        if (this.currentBatterId() !== substitution.outgoingId) fail('A pinch hitter replaces the current batter.')
        this.enterBattingSlot(substitution.incomingId, substitution.outgoingId)
        p.currentBatterId = this.currentBatterId()
        return
      }
      case 'pinch_runner': {
        if (p.status !== 'in_progress' || p.battingSide !== 'tracked') fail('Pinch run while your team is batting.')
        const base = this.baseOf(substitution.outgoingId)
        if (!base) fail('A pinch runner replaces a runner on base.')
        this.enterBattingSlot(substitution.incomingId, substitution.outgoingId)
        p.bases[base] = { ...p.bases[base]!, runnerId: substitution.incomingId }
        return
      }
      case 'courtesy_runner': {
        if (!this.rules.courtesyRunners) fail('Courtesy runners are not allowed under these rules.')
        if (p.battingSide !== 'tracked') fail('Courtesy runners are used while your team is batting.')
        const base = this.baseOf(substitution.outgoingId)
        if (!base) fail('A courtesy runner replaces a runner on base.')
        if (lineup.defense['1'] !== substitution.outgoingId && lineup.defense['2'] !== substitution.outgoingId) {
          fail('Courtesy runners run for the pitcher or catcher.')
        }
        if (!participantIds.has(substitution.incomingId) || this.isActive(substitution.incomingId)) {
          fail('A courtesy runner must come from the bench.')
        }
        p.bases[base] = { ...p.bases[base]!, runnerId: substitution.incomingId }
        return
      }
      case 'defensive':
        this.applyDefensiveSubstitution(substitution.position, substitution.incomingId, substitution.outgoingId)
        return
      case 'position_change':
        this.applyPositionChange(substitution.assignments)
        return
      default:
        fail('That change belongs to the opponent.')
    }
  }

  private applyOpponentChange(substitution: BaseballSubstitution): void {
    const p = this.projection
    const lineup = p.lineups.opponent
    switch (substitution.kind) {
      case 'opponent_pitcher': {
        const pitcher = substitution.pitcher
        const known = p.opponentPitchers[pitcher.id]
        if (!known && this.isKnownId(pitcher.id)) fail('That id already belongs to someone else.')
        if (lineup.pitcherId === pitcher.id) fail('That pitcher is already pitching.')
        p.opponentPitchers[pitcher.id] = { ...pitcher }
        this.changePitcher(lineup, pitcher.id, 'opponent')
        return
      }
      case 'opponent_slot': {
        if (!p.opponentSlotDetails[substitution.slotId]) fail('Unknown opponent batting slot.')
        p.opponentSlotDetails[substitution.slotId] = {
          id: substitution.slotId,
          label: substitution.label,
          number: substitution.number,
          position: substitution.position,
          bats: substitution.bats,
        }
        return
      }
      default:
        fail('The opponent is tracked by batting slot and pitcher only.')
    }
  }

  /** The incoming player takes the outgoing player's batting slot; the outgoing player leaves the game. */
  private enterBattingSlot(incomingId: string, outgoingId: string): void {
    const lineup = this.projection.lineups.tracked
    const slot = lineup.battingOrder.indexOf(outgoingId)
    if (slot < 0) fail('The player leaving is not in the batting order.')
    this.admit(incomingId, slot)
    lineup.battingOrder[slot] = incomingId
    this.removeFromGame(outgoingId)
  }

  private admit(incomingId: string, slot: number | null): void {
    const lineup = this.projection.lineups.tracked
    if (!this.setup.participants.some(participant => participant.id === incomingId)) fail('Unknown player.')
    if (this.isActive(incomingId)) fail('That player is already in the game.')
    if (lineup.removedIds.includes(incomingId)) {
      switch (this.rules.reentry) {
        case 'none':
          fail('Players who leave the game cannot re-enter under these rules.')
          break
        case 'starters_once':
          if (!lineup.starterIds.includes(incomingId)) fail('Only starters may re-enter.')
          if (lineup.reenteredIds.includes(incomingId)) fail('A starter may re-enter only once.')
          if (slot === null || this.originalSlotById.get(incomingId) !== slot) {
            fail('A re-entering starter returns to the original batting slot.')
          }
          lineup.reenteredIds.push(incomingId)
          break
        case 'unlimited':
          break
      }
      lineup.removedIds = lineup.removedIds.filter(id => id !== incomingId)
    }
    if (!lineup.appearedIds.includes(incomingId)) lineup.appearedIds.push(incomingId)
  }

  private removeFromGame(participantId: string): void {
    const lineup = this.projection.lineups.tracked
    for (const [key, id] of Object.entries(lineup.defense)) {
      if (id === participantId) delete lineup.defense[key]
    }
    if (!lineup.removedIds.includes(participantId)) lineup.removedIds.push(participantId)
  }

  private applyDefensiveSubstitution(position: number, incomingId: string, outgoingId: string | null): void {
    if (position > this.rules.defensivePlayers) fail('That position is not used under these rules.')
    const lineup = this.projection.lineups.tracked
    const key = String(position)
    const previous = lineup.defense[key] ?? null
    const standard = this.rules.battingOrderFormat === 'standard'
    if (Object.values(lineup.defense).includes(incomingId)) fail('Use a position change for a player already fielding.')
    const leaving = outgoingId ?? previous
    const previousPitcher = lineup.pitcherId
    if (lineup.battingOrder.includes(incomingId)) {
      if (outgoingId) fail('A player already batting cannot replace another batter.')
      if (previous && standard) fail('Move the current fielder to another position first.')
      lineup.defense[key] = incomingId
    } else {
      if (!leaving) {
        fail('Name the player leaving the game.')
      }
      if (!this.isActive(leaving)) fail('The player leaving is not in the game.')
      const slot = lineup.battingOrder.indexOf(leaving)
      if (slot >= 0) {
        this.admit(incomingId, slot)
        lineup.battingOrder[slot] = incomingId
      } else {
        this.admit(incomingId, null)
      }
      this.removeFromGame(leaving)
      if (previous && previous !== leaving) {
        if (standard) fail('Move the current fielder to another position first.')
      }
      lineup.defense[key] = incomingId
      const base = this.baseOf(leaving)
      if (base) fail('A runner on base leaves through a pinch runner.')
    }
    if (lineup.defense['1'] && lineup.defense['1'] !== previousPitcher) {
      this.changePitcher(lineup, lineup.defense['1'], 'tracked')
    }
  }

  private applyPositionChange(assignments: ReadonlyArray<{ participantId: string; position: number }>): void {
    const lineup = this.projection.lineups.tracked
    const previousPitcher = lineup.pitcherId
    const movers = new Set(assignments.map(entry => entry.participantId))
    const targets = new Set(assignments.map(entry => entry.position))
    if (movers.size !== assignments.length || targets.size !== assignments.length) {
      fail('Each player and position appears once in a position change.')
    }
    for (const entry of assignments) {
      if (entry.position > this.rules.defensivePlayers) fail('That position is not used under these rules.')
      if (!this.isActive(entry.participantId)) fail('Only players in the game can change positions.')
      const occupant = lineup.defense[String(entry.position)]
      if (occupant && !movers.has(occupant)) fail('Every displaced fielder needs a new position.')
      if (
        this.rules.battingOrderFormat === 'standard' &&
        !Object.values(lineup.defense).includes(entry.participantId)
      ) {
        fail('Only fielders can change positions in a standard batting order.')
      }
    }
    for (const [key, id] of Object.entries(lineup.defense)) {
      if (movers.has(id)) delete lineup.defense[key]
    }
    for (const entry of assignments) lineup.defense[String(entry.position)] = entry.participantId
    if (lineup.defense['1'] && lineup.defense['1'] !== previousPitcher) {
      this.changePitcher(lineup, lineup.defense['1'], 'tracked')
    }
  }

  private changePitcher(lineup: BaseballSideLineup, pitcherId: string, side: BaseballTeamSide): void {
    const p = this.projection
    lineup.pitcherId = pitcherId
    lineup.defense['1'] = pitcherId
    if (!lineup.appearedIds.includes(pitcherId)) lineup.appearedIds.push(pitcherId)
    const line = this.pitchingLine(pitcherId, side)
    if (p.status === 'in_progress' && p.battingSide !== side) {
      line.inheritedRunners += BASES.filter(base => p.bases[base] !== null).length
    }
  }

  // -------------------------------------------------------------------------
  // Helpers

  private requireDefense(): void {
    if (this.projection.battingSide !== 'opponent') return
    const defense = this.projection.lineups.tracked.defense
    for (let position = 1; position <= this.rules.defensivePlayers; position += 1) {
      if (!defense[String(position)]) fail('Fill every defensive position before play continues.')
    }
  }

  private isActive(participantId: string): boolean {
    const lineup = this.projection.lineups.tracked
    return lineup.battingOrder.includes(participantId) || Object.values(lineup.defense).includes(participantId)
  }

  private isKnownId(id: string): boolean {
    return (
      this.setup.participants.some(participant => participant.id === id) ||
      this.setup.opponentSlots.some(slot => slot.id === id)
    )
  }

  private baseOf(runnerId: string): BaseballBase | null {
    return BASES.find(base => this.projection.bases[base]?.runnerId === runnerId) ?? null
  }

  private homeSide(): BaseballTeamSide {
    return this.setup.trackedSide === 'home' ? 'tracked' : 'opponent'
  }

  private battingLineup(): BaseballSideLineup {
    return this.projection.lineups[this.projection.battingSide]
  }

  private fieldingLineup(): BaseballSideLineup {
    return this.projection.lineups[otherSide(this.projection.battingSide)]
  }

  private currentBatterId(): string {
    const lineup = this.battingLineup()
    return lineup.battingOrder[lineup.nextBatterIndex]
  }

  private currentHalfLine(): BaseballHalfInningLine {
    return this.projection.lineScore[this.projection.lineScore.length - 1]
  }

  private battingLine(id: string): BaseballBattingLine {
    const lines = this.projection.battingLines
    lines[id] ??= emptyBattingLine()
    return lines[id]
  }

  private pitchingLine(id: string, side: BaseballTeamSide): BaseballPitchingLine {
    const lines = this.projection.pitchingLines
    lines[id] ??= emptyPitchingLine(id, side)
    return lines[id]
  }

  /** Fielding credit only for the tracked defense, resolved from the current alignment. */
  private fielding(position: number): BaseballFieldingLine {
    const p = this.projection
    if (p.battingSide === 'tracked') return scratchFieldingLine()
    const id = p.lineups.tracked.defense[String(position)]
    if (!id) return scratchFieldingLine()
    p.fieldingLines[id] ??= emptyFieldingLine()
    return p.fieldingLines[id]
  }
}

function fail(message: string): never {
  throw new BaseballReplayError(message)
}

function otherSide(side: BaseballTeamSide): BaseballTeamSide {
  return side === 'tracked' ? 'opponent' : 'tracked'
}

export function emptyBattingLine(): BaseballBattingLine {
  return {
    pa: 0, ab: 0, h: 0, singles: 0, doubles: 0, triples: 0, hr: 0, r: 0, rbi: 0, bb: 0, ibb: 0,
    hbp: 0, k: 0, kLooking: 0, sh: 0, sf: 0, roe: 0, fc: 0, gidp: 0, ci: 0, tb: 0, sb: 0, cs: 0,
    pickedOff: 0, pitchesSeen: 0,
  }
}

export function emptyPitchingLine(pitcherId: string, side: BaseballTeamSide): BaseballPitchingLine {
  return {
    pitcherId, side, outs: 0, bf: 0, pitches: 0, strikes: 0, balls: 0, firstPitchStrikes: 0, h: 0,
    r: 0, er: 0, bb: 0, ibb: 0, k: 0, hbp: 0, wp: 0, bk: 0, hr: 0, inheritedRunners: 0,
    inheritedRunnersScored: 0, untrackedPlateAppearances: 0,
  }
}

export function emptyFieldingLine(): BaseballFieldingLine {
  return { po: 0, a: 0, e: 0, dp: 0, pb: 0, sbAllowed: 0, cs: 0 }
}

function scratchFieldingLine(): BaseballFieldingLine {
  return emptyFieldingLine()
}
