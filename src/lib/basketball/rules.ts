import type { BasketballTeamStatsConfig } from '../../types'
import { BASKETBALL_TEAM_STATS_DEFAULTS } from '../../config/teamStatsDefaults'
import { isPlainObject } from '../gameEvents/envelope'
import type {
  BasketballMatchRules,
  BasketballMatchSegment,
  BasketballRulesSource,
} from './types'

const MINUTE_MS = 60_000

export const DEFAULT_BASKETBALL_RULES_SOURCE: BasketballRulesSource = {
  profileId: 'nfhs',
  profileVersion: 1,
  personalRevision: null,
  teamRevision: null,
  hasExplicitMatchOverrides: false,
}

export function createBasketballMatchRules(
  config: BasketballTeamStatsConfig = BASKETBALL_TEAM_STATS_DEFAULTS
): BasketballMatchRules {
  const durationMs = config.periodsPerGame === 2 ? 20 * MINUTE_MS : 8 * MINUTE_MS
  const rules: BasketballMatchRules = {
    ...structuredClone(config),
    regulationSegments: config.periodLabels.map((label, index) => ({
      id: `regulation-${index + 1}`,
      label,
      kind: 'regulation',
      order: index + 1,
      durationMs,
    })),
    overtimeTemplate: {
      idPrefix: 'overtime',
      label: config.overtimeLabel,
      durationMs: 4 * MINUTE_MS,
    },
    clockModel: 'none',
  }
  const error = validateBasketballMatchRules(rules)
  if (error) throw new Error(error)
  return structuredClone(rules)
}

export function normalizeBasketballMatchRules(value: unknown): BasketballMatchRules | null {
  if (validateBasketballMatchRules(value) !== null) return null
  return structuredClone(value as BasketballMatchRules)
}

export function normalizeBasketballRulesSource(value: unknown): BasketballRulesSource | null {
  if (!isPlainObject(value)) return null
  if (typeof value.profileId !== 'string' || value.profileId.trim().length === 0) return null
  if (!isPositiveInteger(value.profileVersion)) return null
  if (!isNullableNonNegativeInteger(value.personalRevision)) return null
  if (!isNullableNonNegativeInteger(value.teamRevision)) return null
  if (typeof value.hasExplicitMatchOverrides !== 'boolean') return null
  return structuredClone(value as unknown as BasketballRulesSource)
}

export function validateBasketballMatchRules(value: unknown): string | null {
  if (!isPlainObject(value)) return 'Basketball rules must be an object.'
  if (!isPositiveInteger(value.periodsPerGame)) return 'Regulation period count must be positive.'
  if (!Array.isArray(value.periodLabels) || value.periodLabels.length !== value.periodsPerGame) {
    return 'Regulation labels must match the period count.'
  }
  const periodLabels = value.periodLabels as unknown[]
  if (!periodLabels.every(isNonEmptyString)) return 'Regulation labels must be non-empty.'
  if (
    !Array.isArray(value.regulationSegments) ||
    value.regulationSegments.length !== value.periodsPerGame ||
    !value.regulationSegments.every(isBasketballSegment)
  ) {
    return 'Regulation segments must match the period count.'
  }
  const segments = value.regulationSegments as unknown as BasketballMatchSegment[]
  if (!segments.every(segment => segment.kind === 'regulation')) {
    return 'Regulation segments must use the regulation kind.'
  }
  if (new Set(segments.map(segment => segment.id)).size !== segments.length) {
    return 'Regulation segment ids must be unique.'
  }
  if (new Set(segments.map(segment => segment.order)).size !== segments.length) {
    return 'Regulation segment orders must be unique.'
  }
  if (!segments.every((segment, index) => (
    segment.order === index + 1 && segment.label === periodLabels[index]
  ))) {
    return 'Regulation segment order and labels must match compatibility fields.'
  }
  if (!isPlainObject(value.overtimeTemplate)) return 'Overtime template is required.'
  if (!isNonEmptyString(value.overtimeTemplate.idPrefix)) return 'Overtime id prefix is required.'
  if (!isNonEmptyString(value.overtimeTemplate.label)) return 'Overtime label is required.'
  if (!isPositiveInteger(value.overtimeTemplate.durationMs)) return 'Overtime duration is invalid.'
  if (value.overtimeTemplate.label !== value.overtimeLabel) {
    return 'Overtime template label must match the compatibility label.'
  }
  if (!isPositiveInteger(value.bonusThreshold)) return 'Bonus threshold must be positive.'
  if (!isPositiveInteger(value.doubleBonusThreshold)) return 'Double-bonus threshold must be positive.'
  if (value.doubleBonusThreshold < value.bonusThreshold) {
    return 'Double-bonus threshold cannot precede the bonus threshold.'
  }
  if (typeof value.hasOneAndOne !== 'boolean') return 'One-and-one policy is invalid.'
  if (!isNonEmptyString(value.overtimeLabel)) return 'Overtime label is required.'
  if (typeof value.overtimeFoulsReset !== 'boolean') return 'Overtime foul reset policy is invalid.'
  if (!isNullableNonNegativeInteger(value.timeoutsPerPeriod)) {
    return 'Regulation timeout inventory is invalid.'
  }
  if (!isNullableNonNegativeInteger(value.timeoutsPerOvertime)) {
    return 'Overtime timeout inventory is invalid.'
  }
  if (value.clockModel !== 'none' && value.clockModel !== 'anchored') {
    return 'Basketball clock model is invalid.'
  }
  return null
}

export function resolveBasketballPeriodSegment(
  rules: BasketballMatchRules,
  periodId: string
): BasketballMatchSegment | null {
  const regulation = rules.regulationSegments.find(segment => segment.id === periodId)
  if (regulation) return structuredClone(regulation)

  const escapedPrefix = rules.overtimeTemplate.idPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^${escapedPrefix}-(\\d+)$`).exec(periodId)
  const overtimeNumber = match ? Number(match[1]) : 0
  if (!Number.isInteger(overtimeNumber) || overtimeNumber < 1) return null
  return {
    id: periodId,
    label: overtimeNumber === 1
      ? rules.overtimeTemplate.label
      : `${rules.overtimeTemplate.label} ${overtimeNumber}`,
    kind: 'overtime',
    order: rules.regulationSegments.length + overtimeNumber,
    durationMs: rules.overtimeTemplate.durationMs,
  }
}

function isBasketballSegment(value: unknown): value is BasketballMatchSegment {
  return Boolean(
    isPlainObject(value) &&
      isNonEmptyString(value.id) &&
      isNonEmptyString(value.label) &&
      (value.kind === 'regulation' || value.kind === 'overtime') &&
      isPositiveInteger(value.order) &&
      isPositiveInteger(value.durationMs)
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && Number(value) >= 0)
}
