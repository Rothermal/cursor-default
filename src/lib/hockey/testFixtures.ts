import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import { createInitialState } from '../gameReducer'
import { hockeySportState, initializeHockeyEventGame, type HockeyCommandContext, type HockeyCommandResult } from './live'
import { defaultHockeyDressedAs } from './positions'
import { createHockeyMatchRules } from './profiles'
import { HOCKEY_RULES_FIELDS } from './rules'
import type {
  HockeyAttackingDirection,
  HockeyMatchParticipant,
  HockeyMatchProjection,
  HockeyMatchSetup,
  HockeyProfileId,
  HockeyRuleOverrides,
  HockeyRuleSource,
  HockeyRulesField,
} from './types'

const BASE_MS = Date.UTC(2026, 8, 27, 12, 0, 0)

/** ISO time `seconds` after a fixed base, so clock arithmetic is exact. */
export function at(seconds: number): string {
  return new Date(BASE_MS + seconds * 1000).toISOString()
}

export function ctx(seconds: number, eventIds?: string[]): HockeyCommandContext {
  return { recorderUserId: null, occurredAt: at(seconds), ...(eventIds ? { eventIds } : {}) }
}

function participant(n: number, position: string): HockeyMatchParticipant {
  return {
    id: `p${n}`,
    playerId: `player-${n}`,
    displayName: `Player ${n}`,
    number: String(n),
    position,
    dressedAs: defaultHockeyDressedAs(position),
  }
}

export const CLOCKLESS: HockeyRuleOverrides = { clockModel: 'none', clock: null }

export function hockeySetup(options: {
  profile?: HockeyProfileId
  rules?: HockeyRuleOverrides
  direction?: HockeyAttackingDirection
} = {}): HockeyMatchSetup {
  return {
    version: 1,
    trackedTeam: 'home',
    opponentName: 'Rivals',
    sourceTeamId: null,
    sourceSeasonId: null,
    rulesSnapshot: createHockeyMatchRules(options.profile, options.rules),
    rulesSource: Object.fromEntries(HOCKEY_RULES_FIELDS.map(field => [field, 'built_in'])) as Record<
      HockeyRulesField,
      HockeyRuleSource
    >,
    firstPeriodAttackingDirection: options.direction ?? 'left_to_right',
    participants: [
      participant(1, 'G'),
      participant(2, 'C'),
      participant(3, 'LW'),
      participant(4, 'RW'),
      participant(5, 'D'),
      participant(6, 'D'),
      participant(30, 'G'),
    ],
    openingLineup: { goalieParticipantId: 'p1', skaterParticipantIds: ['p2', 'p3', 'p4', 'p5', 'p6'] },
    opponentGoalie: { id: 'opp-goalie', label: null, number: '35' },
  }
}

export function freshHockeyGame(): GameState {
  return {
    ...createInitialState(),
    sport: sports.find(sport => sport.id === 'hockey')!,
    gameInfo: { teamName: 'Blades', opponentName: 'Rivals', tournamentName: '', tournamentId: null, date: '2026-09-27' },
    players: [1, 2, 3, 4, 5, 6, 30].map(n => ({ id: `player-${n}`, name: `Player ${n}`, number: String(n), stats: {} })),
  }
}

export function initializedHockeyGame(setup: HockeyMatchSetup = hockeySetup()): GameState {
  return expectOk(initializeHockeyEventGame(freshHockeyGame(), setup))
}

export function expectOk(result: HockeyCommandResult): GameState {
  if (!result.ok) throw new Error(`Command rejected: ${result.message}`)
  return result.state
}

export function projection(state: GameState): HockeyMatchProjection {
  const sport = hockeySportState(state)
  if (!sport) throw new Error('Not a Hockey game')
  return sport.projection
}
