import type {
  BasketballSubstitutionMode,
  BasketballSubstitutionReasonCode,
} from './types'

const BASKETBALL_SUBSTITUTION_MODES = {
  balanced: true,
  exit_only: true,
  entry_only: true,
  mixed: true,
  boundary: true,
  current_lineup_recovery: true,
} satisfies Record<BasketballSubstitutionMode, true>

export const BASKETBALL_SUBSTITUTION_REASON_LABELS = {
  injury: 'Injury',
  eligibility: 'Eligibility',
  short_handed: 'Short-handed',
  recovery: 'Recovery',
  other: 'Other',
} satisfies Record<BasketballSubstitutionReasonCode, string>

export const BASKETBALL_SUBSTITUTION_REASON_OPTIONS = Object.entries(
  BASKETBALL_SUBSTITUTION_REASON_LABELS
).map(([value, label]) => ({
  value: value as BasketballSubstitutionReasonCode,
  label,
}))

export function isBasketballSubstitutionMode(
  value: unknown
): value is BasketballSubstitutionMode {
  return typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(BASKETBALL_SUBSTITUTION_MODES, value)
}

export function isBasketballSubstitutionReasonCode(
  value: unknown
): value is BasketballSubstitutionReasonCode {
  return typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(BASKETBALL_SUBSTITUTION_REASON_LABELS, value)
}

export function deriveBasketballLiveSubstitutionMode(
  exitCount: number,
  entryCount: number
): BasketballSubstitutionMode | null {
  if (exitCount > 0 && entryCount > 0) {
    return exitCount === entryCount ? 'balanced' : 'mixed'
  }
  if (exitCount > 0) return 'exit_only'
  if (entryCount > 0) return 'entry_only'
  return null
}

export function basketballSubstitutionRequiresReason(
  mode: BasketballSubstitutionMode,
  resultingParticipantCount: number
): boolean {
  if (resultingParticipantCount < 5) return true
  return mode === 'exit_only' ||
    mode === 'entry_only' ||
    mode === 'mixed' ||
    mode === 'current_lineup_recovery'
}

export function formatBasketballSubstitutionReason(
  reasonCode: BasketballSubstitutionReasonCode,
  reasonNote: string | null
): string {
  const label = BASKETBALL_SUBSTITUTION_REASON_LABELS[reasonCode]
  return reasonNote ? `${label}: ${reasonNote}` : label
}
