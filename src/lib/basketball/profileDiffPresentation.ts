import type {
  BasketballFoulWindowRule,
  BasketballMatchRulesV2,
  BasketballMatchSegmentV2,
  BasketballOvertimeFoulPolicy,
  BasketballOvertimeTemplateV2,
  BasketballOvertimeTimeoutPolicy,
  BasketballRulesV2Field,
  BasketballTimeoutPoolRule,
} from './types'

export const BASKETBALL_RULE_FIELD_LABELS = {
  regulationSegments: 'Regulation segments',
  overtimeTemplate: 'Overtime',
  foulWindows: 'Foul windows',
  timeoutPools: 'Timeout pools',
  personalFoulLimit: 'Player foul limit',
  clockModel: 'Clock model',
} satisfies Record<BasketballRulesV2Field, string>

export const BASKETBALL_RULE_FIELDS = Object.keys(
  BASKETBALL_RULE_FIELD_LABELS
) as BasketballRulesV2Field[]

export function basketballRuleFieldLabel(field: BasketballRulesV2Field): string {
  return BASKETBALL_RULE_FIELD_LABELS[field]
}

export function formatBasketballRuleField(
  field: BasketballRulesV2Field,
  value: BasketballMatchRulesV2[BasketballRulesV2Field]
): string {
  switch (field) {
    case 'regulationSegments':
      return (value as BasketballMatchSegmentV2[]).map(segment => [
        `#${segment.order} ${segment.label}`,
        `${segment.id} (${segment.kind})`,
        durationLabel(segment.durationMs),
        `foul ${segment.foulWindowId}`,
        `timeout ${segment.timeoutPoolId}`,
        `lineup ${yesNo(segment.lineupChangeBoundary)}`,
      ].join(' | ')).join('; ')
    case 'overtimeTemplate':
      return formatOvertime(value as BasketballOvertimeTemplateV2)
    case 'foulWindows':
      return (value as BasketballFoulWindowRule[]).map(window => [
        `${window.label} (${window.id})`,
        `segments ${window.segmentIds.join(', ')}`,
        `bonus ${foulLimit(window.bonusThreshold)}`,
        `double ${foulLimit(window.doubleBonusThreshold)}`,
        `1-and-1 ${yesNo(window.hasOneAndOne)}`,
      ].join(' | ')).join('; ')
    case 'timeoutPools':
      return (value as BasketballTimeoutPoolRule[]).map(pool => [
        `${pool.label} (${pool.id})`,
        `segments ${pool.segmentIds.join(', ')}`,
        `total ${timeoutLimit(pool.totalLimit)}`,
        `full ${timeoutLimit(pool.fullLimit)}`,
        `30-sec ${timeoutLimit(pool.shortLimit)}`,
        `carry ${pool.carryoverToPoolId ?? 'none'}`,
      ].join(' | ')).join('; ')
    case 'personalFoulLimit':
      return String(value)
    case 'clockModel':
      return String(value)
  }
}

function formatOvertime(overtime: BasketballOvertimeTemplateV2): string {
  return [
    `${overtime.label} (${overtime.idPrefix})`,
    durationLabel(overtime.durationMs),
    `lineup ${yesNo(overtime.lineupChangeBoundary)}`,
    `fouls ${formatFoulPolicy(overtime.foulPolicy)}`,
    `timeouts ${formatTimeoutPolicy(overtime.timeoutPolicy)}`,
  ].join(' | ')
}

function formatFoulPolicy(policy: BasketballOvertimeFoulPolicy): string {
  const window = policy.window
    ? [
        policy.window.label,
        `bonus ${foulLimit(policy.window.bonusThreshold)}`,
        `double ${foulLimit(policy.window.doubleBonusThreshold)}`,
        `1-and-1 ${yesNo(policy.window.hasOneAndOne)}`,
      ].join(', ')
    : 'none'
  return `${policy.mode} (regulation ${policy.regulationWindowId ?? 'none'}; window ${window})`
}

function formatTimeoutPolicy(policy: BasketballOvertimeTimeoutPolicy): string {
  const pool = policy.pool
    ? [
        policy.pool.label,
        `total ${timeoutLimit(policy.pool.totalLimit)}`,
        `full ${timeoutLimit(policy.pool.fullLimit)}`,
        `30-sec ${timeoutLimit(policy.pool.shortLimit)}`,
      ].join(', ')
    : 'none'
  const additions = policy.additionsPerOvertime
  return `${policy.mode} (regulation ${policy.regulationPoolId ?? 'none'}; pool ${pool}; add total ${additions.total}, full ${additions.full}, 30-sec ${additions.short})`
}

function durationLabel(durationMs: number): string {
  const wholeSeconds = Math.floor(durationMs / 1_000)
  const minutes = Math.floor(wholeSeconds / 60)
  const seconds = wholeSeconds % 60
  const milliseconds = durationMs % 1_000
  return `${minutes}:${String(seconds).padStart(2, '0')}${milliseconds === 0 ? '' : `.${String(milliseconds).padStart(3, '0')}`}`
}

function foulLimit(value: number | null): string {
  return value === null ? 'none' : String(value)
}

function timeoutLimit(value: number | null): string {
  return value === null ? 'unlimited' : String(value)
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no'
}
