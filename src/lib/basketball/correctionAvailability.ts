import type { BasketballMatchProjection } from './types'

export function isBasketballTimelineCorrectionProjection(
  projection: BasketballMatchProjection
): boolean {
  return projection.status === 'in_progress' ||
    projection.status === 'period_break' ||
    (
      projection.status === 'ended' &&
      projection.reopenMode === 'correct_records'
    )
}
