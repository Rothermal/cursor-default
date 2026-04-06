import { getBonusStatus } from '../../lib/basketballBonus'

export interface BasketballBonusIndicatorProps {
  foulCount: number
  bonusThreshold: number
  doubleBonusThreshold: number
  hasOneAndOne: boolean
}

export default function BasketballBonusIndicator({
  foulCount,
  bonusThreshold,
  doubleBonusThreshold,
  hasOneAndOne,
}: BasketballBonusIndicatorProps) {
  const status = getBonusStatus(foulCount, bonusThreshold, doubleBonusThreshold, hasOneAndOne)

  const approachingOneAndOne =
    status === 'none' &&
    hasOneAndOne &&
    foulCount < bonusThreshold &&
    foulCount >= bonusThreshold - 2

  const approachingBonusNba =
    status === 'none' &&
    !hasOneAndOne &&
    foulCount < bonusThreshold &&
    foulCount >= bonusThreshold - 2

  const approachingDoubleFromOneAndOne =
    status === 'one_and_one' &&
    foulCount < doubleBonusThreshold &&
    foulCount >= doubleBonusThreshold - 2

  let hint: string | null = null
  if (approachingOneAndOne) {
    hint = `${bonusThreshold - foulCount} foul${bonusThreshold - foulCount === 1 ? '' : 's'} from 1-and-1`
  } else if (approachingBonusNba) {
    hint = `${bonusThreshold - foulCount} foul${bonusThreshold - foulCount === 1 ? '' : 's'} from bonus`
  } else if (approachingDoubleFromOneAndOne) {
    hint = `${doubleBonusThreshold - foulCount} foul${doubleBonusThreshold - foulCount === 1 ? '' : 's'} from double bonus`
  }

  if (status === 'none' && !hint) {
    return null
  }

  return (
    <div className="space-y-2 mb-2">
      {status === 'double_bonus' && (
        <div
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 shadow-md"
          role="status"
        >
          <p className="text-sm font-bold text-red-800">
            🔴 {!hasOneAndOne ? 'BONUS' : 'DOUBLE BONUS'}
            <span className="font-semibold text-red-700/90"> ({foulCount}{getOrdinalSuffix(foulCount)} foul)</span>
          </p>
          <p className="text-xs text-red-700/90 mt-0.5">
            Next foul: opponent shoots 2 free throws
          </p>
        </div>
      )}

      {status === 'one_and_one' && (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 shadow-md"
          role="status"
        >
          <p className="text-sm font-bold text-amber-900">
            ⚠️ 1-AND-1
            <span className="font-semibold text-amber-800/90"> ({foulCount}{getOrdinalSuffix(foulCount)} foul)</span>
          </p>
          <p className="text-xs text-amber-800/90 mt-0.5">
            Next foul: opponent shoots 1-and-1
          </p>
        </div>
      )}

      {hint && (
        <p className="text-[11px] text-slate-500 text-center px-1">
          ℹ️ {hint}
        </p>
      )}
    </div>
  )
}

function getOrdinalSuffix(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  switch (n % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}
