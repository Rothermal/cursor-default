/** Standard Baseball/Softball positions in scorebook order; custom values sort after these. */
export const BASEBALL_FIELDING_POSITIONS = [
  { number: 1, code: 'P', label: 'Pitcher' },
  { number: 2, code: 'C', label: 'Catcher' },
  { number: 3, code: '1B', label: 'First base' },
  { number: 4, code: '2B', label: 'Second base' },
  { number: 5, code: '3B', label: 'Third base' },
  { number: 6, code: 'SS', label: 'Shortstop' },
  { number: 7, code: 'LF', label: 'Left field' },
  { number: 8, code: 'CF', label: 'Center field' },
  { number: 9, code: 'RF', label: 'Right field' },
  { number: 10, code: 'SF', label: 'Short fielder' },
] as const

/** Batting-only roles: designated hitter, extra hitter, and softball DP/FLEX. */
export const BASEBALL_BATTING_ONLY_POSITIONS = [
  { code: 'DH', label: 'Designated hitter' },
  { code: 'EH', label: 'Extra hitter' },
  { code: 'DP', label: 'Designated player' },
  { code: 'FLEX', label: 'Flex' },
] as const

export const BASEBALL_POSITION_CODES: readonly string[] = [
  ...BASEBALL_FIELDING_POSITIONS.map(position => position.code),
  ...BASEBALL_BATTING_ONLY_POSITIONS.map(position => position.code),
]

export const BASEBALL_POSITION_MAX_LENGTH = 80

export function baseballFieldingPositionCode(number: number): string | null {
  return BASEBALL_FIELDING_POSITIONS.find(position => position.number === number)?.code ?? null
}

export function baseballFieldingNumberForCode(code: string): number | null {
  const normalized = code.trim().toUpperCase()
  return BASEBALL_FIELDING_POSITIONS.find(position => position.code === normalized)?.number ?? null
}

export function isBaseballFieldingNumber(value: unknown, defensivePlayers: 9 | 10 = 10): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= defensivePlayers
}

/** Standard codes normalize to upper case; custom labels are preserved; blank is Unassigned. */
export function normalizeBaseballPosition(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > BASEBALL_POSITION_MAX_LENGTH) return null
  const standard = BASEBALL_POSITION_CODES.find(code => code === trimmed.toUpperCase())
  return standard ?? trimmed
}

/** Sort key: standard positions in catalog order, then custom, then Unassigned. */
export function baseballPositionSortKey(position: string | null): number {
  if (position === null) return 1000
  const index = BASEBALL_POSITION_CODES.indexOf(position)
  return index >= 0 ? index : 500
}
