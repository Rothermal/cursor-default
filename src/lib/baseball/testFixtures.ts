import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import { createInitialState } from '../gameReducer'
import {
  baseballMovement,
  baseballSportState,
  initializeBaseballEventGame,
  proposeBaseballMovements,
  recordBaseballPitch,
  startBaseballGame,
  type BaseballCommandContext,
  type BaseballCommandResult,
  type RecordPitchInput,
} from './commands'
import { createBaseballMatchRules } from './profiles'
import type {
  BaseballInPlay,
  BaseballMatchProjection,
  BaseballMatchRules,
  BaseballMatchSetup,
  BaseballProfileId,
} from './types'

export const TRACKED = Array.from({ length: 12 }, (_, index) => `t${index + 1}`)
export const OPPONENT_SLOTS = Array.from({ length: 9 }, (_, index) => `o${index + 1}`)
export const OPPONENT_PITCHER = 'opp-p1'

export function baseballSetup(
  options: {
    profile?: BaseballProfileId
    trackedSide?: 'home' | 'away'
    rules?: Partial<BaseballMatchRules>
  } = {}
): BaseballMatchSetup {
  const rules = createBaseballMatchRules(options.profile ?? 'nfhs_baseball', {
    battingOrderFormat: 'standard',
    ...options.rules,
  })
  const fielders = TRACKED.slice(0, rules.defensivePlayers)
  return {
    version: 1,
    trackedSide: options.trackedSide ?? 'home',
    opponentName: 'Visitors',
    sourceTeamId: null,
    sourceSeasonId: null,
    rulesSnapshot: rules,
    participants: TRACKED.map((id, index) => ({
      id,
      playerId: `player-${id}`,
      displayName: `Player ${index + 1}`,
      number: String(index + 1),
      position: null,
      bats: 'R',
      throws: 'R',
    })),
    trackedLineup: {
      battingOrder: [...fielders],
      defense: Object.fromEntries(fielders.map((id, index) => [String(index + 1), id])),
    },
    opponentSlots: OPPONENT_SLOTS.map(id => ({ id, label: null, number: null, position: null, bats: null })),
    opponentPitcher: { id: OPPONENT_PITCHER, label: 'Starter', number: '21', throws: 'R' },
  }
}

let clock = 0
export function ctx(): BaseballCommandContext {
  clock += 1
  return { recorderUserId: null, occurredAt: new Date(Date.UTC(2026, 8, 26, 12, 0, clock)).toISOString() }
}

export function startedGame(setup: BaseballMatchSetup = baseballSetup()): GameState {
  const base: GameState = {
    ...createInitialState(),
    sport: sports.find(sport => sport.id === 'baseball')!,
    players: setup.participants.map(participant => ({
      id: participant.playerId!,
      name: participant.displayName,
      number: participant.number ?? '',
      stats: {},
    })),
  }
  const initialized = expectOk(initializeBaseballEventGame(base, setup))
  return expectOk(startBaseballGame(initialized, ctx()))
}

export function expectOk(result: BaseballCommandResult): GameState {
  if (!result.ok) throw new Error(`Command rejected: ${result.message}`)
  return result.state
}

export function projection(state: GameState): BaseballMatchProjection {
  const sport = baseballSportState(state)
  if (!sport) throw new Error('Not a Baseball game')
  return sport.projection
}

export function pitch(state: GameState, input: RecordPitchInput): GameState {
  return expectOk(recordBaseballPitch(state, input, ctx()))
}

export function pitches(state: GameState, ...results: RecordPitchInput['result'][]): GameState {
  return results.reduce((current, result) => pitch(current, { result }), state)
}

export function inPlay(
  result: BaseballInPlay['result'],
  options: Partial<BaseballInPlay> = {}
): BaseballInPlay {
  return {
    battedBallType: options.battedBallType ?? 'ground',
    result,
    fielders: options.fielders ?? [],
    errorBy: options.errorBy ?? (result === 'error' ? 6 : null),
    insideThePark: options.insideThePark ?? false,
  }
}

/** Ball in play using the standard proposal for the result. */
export function ballInPlay(
  state: GameState,
  result: BaseballInPlay['result'],
  options: Partial<BaseballInPlay> = {}
): GameState {
  const detail = inPlay(result, options)
  const movements = proposeBaseballMovements(projection(state), result, detail.fielders)
  return pitch(state, { result: 'in_play', inPlay: detail, movements })
}

export function strikeout(state: GameState): GameState {
  const p = projection(state)
  const needed = p.strikes === 0 ? 2 : p.strikes === 1 ? 1 : 0
  let next = state
  for (let index = 0; index < needed; index += 1) next = pitch(next, { result: 'called_strike' })
  const batter = projection(next).currentBatterId!
  return pitch(next, {
    result: 'swinging_strike',
    movements: [baseballMovement(batter, 'batter', 'out', 'on_play', { fielders: [2] })],
  })
}

export function walk(state: GameState): GameState {
  let next = state
  while (projection(next).balls < 3) next = pitch(next, { result: 'ball' })
  return pitch(next, { result: 'ball', movements: proposeBaseballMovements(projection(next), 'walk') })
}

export function threeUpThreeDown(state: GameState): GameState {
  return strikeout(strikeout(strikeout(state)))
}
