import { evaluateBasketballEqualPlayCandidate } from './lineupProjection'
import { isBasketballMatchRulesV3 } from './rules'
import type {
  BasketballEqualPlayViolation,
  BasketballEqualPlayViolationCode,
  BasketballSportGameState,
  BasketballTeamSide,
} from './types'

export interface BasketballBoundarySideReview {
  teamSide: BasketballTeamSide
  participantIds: string[]
  violations: BasketballEqualPlayViolation[]
  equalPlayMode: 'off' | 'advisory' | 'enforced'
}

export function buildBasketballBoundarySideReview(
  sportState: BasketballSportGameState,
  teamSide: BasketballTeamSide,
  participantIds: readonly string[]
): BasketballBoundarySideReview | null {
  const periodId = sportState.projection.currentPeriodId
  const side = sportState.projection.lineup?.sides[teamSide]
  if (!periodId || !side) return null
  const rules = sportState.setup.rulesSnapshot
  const equalPlayMode = isBasketballMatchRulesV3(rules)
    ? rules.equalPlayPolicy.mode
    : 'off'
  return {
    teamSide,
    participantIds: [...participantIds],
    equalPlayMode,
    violations: teamSide === 'tracked'
      ? evaluateBasketballEqualPlayCandidate(
          sportState.projection,
          sportState,
          periodId,
          [...participantIds]
        )
      : [],
  }
}

const VIOLATION_LABELS: Record<BasketballEqualPlayViolationCode, string> = {
  minimum_periods: 'Minimum-period opportunity',
  maximum_consecutive_periods: 'Consecutive-period limit',
  maximum_period_imbalance: 'Period-balance limit',
}

export function basketballEqualPlayViolationLabel(
  code: BasketballEqualPlayViolationCode
): string {
  return VIOLATION_LABELS[code]
}
