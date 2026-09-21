export const BASKETBALL_POSITION_OPTIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const
export const BASKETBALL_POSITION_MAX_LENGTH = 80

export function normalizeBasketballPosition(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null
}

export function isValidBasketballPosition(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.trim().length > 0 &&
    value === value.trim() && value.length <= BASKETBALL_POSITION_MAX_LENGTH)
}
