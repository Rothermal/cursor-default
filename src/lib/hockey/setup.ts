import { isPlainObject } from '../gameEvents/envelope'
import type { HockeyLineupDefaults } from './lineupDefaults'
import { normalizeHockeyPosition } from './positions'
import { HOCKEY_RULES_FIELDS, normalizeHockeyMatchRules } from './rules'
import type {
  HockeyAttackingDirection,
  HockeyMatchParticipant,
  HockeyMatchSetup,
  HockeyOpeningLineup,
  HockeyOpponentGoalie,
  HockeyRuleSource,
  HockeySetupValidation,
} from './types'
import { HOCKEY_SETUP_VERSION } from './types'

const MAX_LABEL_LENGTH = 80
const MAX_PARTICIPANTS = 60
const RULE_SOURCES: readonly HockeyRuleSource[] = ['built_in', 'personal', 'team', 'match']

/** Exact parser for a frozen setup snapshot; any malformed value fails closed. */
export function normalizeHockeyMatchSetup(value: unknown): HockeyMatchSetup | null {
  if (!isPlainObject(value) || value.version !== HOCKEY_SETUP_VERSION) return null
  if (!exactKeys(value, [
    'version',
    'trackedTeam',
    'opponentName',
    'sourceTeamId',
    'sourceSeasonId',
    'rulesSnapshot',
    'rulesSource',
    'firstPeriodAttackingDirection',
    'participants',
    'openingLineup',
    'opponentGoalie',
  ])) return null
  if (!['home', 'away', 'neutral'].includes(value.trackedTeam as string)) return null
  if (!isNullableLabel(value.opponentName)) return null
  if (!isNullableId(value.sourceTeamId) || !isNullableId(value.sourceSeasonId)) return null
  if (!normalizeHockeyMatchRules(value.rulesSnapshot)) return null
  if (!isRulesSource(value.rulesSource)) return null
  if (!isDirection(value.firstPeriodAttackingDirection)) return null
  if (
    !Array.isArray(value.participants) ||
    value.participants.length > MAX_PARTICIPANTS ||
    !value.participants.every(isHockeyMatchParticipant)
  ) return null
  if (!isOpeningLineup(value.openingLineup)) return null
  if (!isOpponentGoalie(value.opponentGoalie)) return null
  const setup = structuredClone(value) as unknown as HockeyMatchSetup
  return validateHockeyMatchSetup(setup).ok ? setup : null
}

/** Cross-field checks; the message is suitable for a setup form. */
export function validateHockeyMatchSetup(setup: HockeyMatchSetup): HockeySetupValidation {
  const ids = new Set<string>()
  for (const id of [...setup.participants.map(participant => participant.id), setup.opponentGoalie.id]) {
    if (ids.has(id)) return fail('Every participant needs a unique id.')
    ids.add(id)
  }
  const playerIds = setup.participants.flatMap(participant => participant.playerId ?? [])
  if (new Set(playerIds).size !== playerIds.length) return fail('A roster player can be dressed only once.')

  const byId = new Map(setup.participants.map(participant => [participant.id, participant]))
  const goalie = byId.get(setup.openingLineup.goalieParticipantId)
  if (!goalie) return fail('Choose a starting goalie.')
  if (goalie.dressedAs !== 'goalie') return fail('The starting goalie must be dressed as a goalie.')

  const skaters = setup.openingLineup.skaterParticipantIds
  const required = setup.rulesSnapshot.skatersPerSide
  if (new Set(skaters).size !== skaters.length) return fail('A skater can start only once.')
  if (skaters.length !== required) return fail(`Choose ${required} starting skaters.`)
  for (const id of skaters) {
    const skater = byId.get(id)
    if (!skater) return fail('The starting lineup names an unknown player.')
    if (skater.dressedAs !== 'skater') return fail('Starting skaters must be dressed as skaters.')
  }
  return { ok: true }
}

/**
 * Prefills the opening lineup from team defaults only. Players without a default
 * stay on the bench; nothing is inferred from roster order or jersey number.
 */
export function prefillHockeyOpeningLineup(
  participants: readonly HockeyMatchParticipant[],
  defaults: HockeyLineupDefaults | null
): { goalieParticipantId: string | null; skaterParticipantIds: string[] } {
  if (!defaults) return { goalieParticipantId: null, skaterParticipantIds: [] }
  const byPlayer = new Map(
    participants.flatMap(participant => (participant.playerId ? [[participant.playerId, participant] as const] : []))
  )
  const goalie = defaults.startingGoaliePlayerId ? byPlayer.get(defaults.startingGoaliePlayerId) : undefined
  return {
    goalieParticipantId: goalie?.dressedAs === 'goalie' ? goalie.id : null,
    skaterParticipantIds: defaults.starterPlayerIds.flatMap(playerId => {
      const participant = byPlayer.get(playerId)
      return participant?.dressedAs === 'skater' ? [participant.id] : []
    }),
  }
}

/** One period of the match for direction purposes. */
export type HockeyDirectionPeriod =
  | { kind: 'regulation'; number: number }
  | { kind: 'overtime'; number: number }
  | { kind: 'shootout' }

/**
 * Tracked attacking direction (HKY-1 §2.2): regulation alternates from the frozen
 * period-1 direction; overtime follows the rules' ends policy; a shootout has none.
 */
export function hockeyTrackedAttackingDirection(
  setup: Pick<HockeyMatchSetup, 'firstPeriodAttackingDirection' | 'rulesSnapshot'>,
  period: HockeyDirectionPeriod
): HockeyAttackingDirection | null {
  if (period.kind === 'shootout') return null
  const regulationPeriods = setup.rulesSnapshot.regulation.periods
  let sequence: number
  if (period.kind === 'regulation') {
    sequence = period.number
  } else {
    const overtime = setup.rulesSnapshot.overtime
    if (!overtime) return null
    sequence = overtime.endsPolicy === 'continue_alternation'
      ? regulationPeriods + period.number
      : regulationPeriods
  }
  if (!Number.isInteger(sequence) || sequence < 1) return null
  const first = setup.firstPeriodAttackingDirection
  return sequence % 2 === 1 ? first : opposite(first)
}

function opposite(direction: HockeyAttackingDirection): HockeyAttackingDirection {
  return direction === 'left_to_right' ? 'right_to_left' : 'left_to_right'
}

export function isHockeyMatchParticipant(value: unknown): value is HockeyMatchParticipant {
  return (
    isPlainObject(value) &&
    exactKeys(value, ['id', 'playerId', 'displayName', 'number', 'position', 'dressedAs']) &&
    isId(value.id) &&
    isNullableId(value.playerId) &&
    isLabel(value.displayName) &&
    isNullableShortLabel(value.number) &&
    (value.position === null || normalizeHockeyPosition(value.position) === value.position) &&
    (value.dressedAs === 'skater' || value.dressedAs === 'goalie')
  )
}

function isOpeningLineup(value: unknown): value is HockeyOpeningLineup {
  return (
    isPlainObject(value) &&
    exactKeys(value, ['goalieParticipantId', 'skaterParticipantIds']) &&
    isId(value.goalieParticipantId) &&
    Array.isArray(value.skaterParticipantIds) &&
    value.skaterParticipantIds.every(isId)
  )
}

function isOpponentGoalie(value: unknown): value is HockeyOpponentGoalie {
  return (
    isPlainObject(value) &&
    exactKeys(value, ['id', 'label', 'number']) &&
    isId(value.id) &&
    isNullableLabel(value.label) &&
    isNullableShortLabel(value.number)
  )
}

function isRulesSource(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    exactKeys(value, HOCKEY_RULES_FIELDS) &&
    Object.values(value).every(source => RULE_SOURCES.includes(source as HockeyRuleSource))
  )
}

function isDirection(value: unknown): value is HockeyAttackingDirection {
  return value === 'left_to_right' || value === 'right_to_left'
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 100
}

function isNullableId(value: unknown): boolean {
  return value === null || isId(value)
}

function isLabel(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_LABEL_LENGTH
}

function isNullableLabel(value: unknown): value is string | null {
  return value === null || isLabel(value)
}

function isNullableShortLabel(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.trim().length > 0 && value.length <= 10)
}

function fail(message: string): HockeySetupValidation {
  return { ok: false, message }
}
