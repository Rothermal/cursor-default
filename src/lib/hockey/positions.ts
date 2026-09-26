/**
 * Standard hockey positions in actor-order sequence. Stored as plain codes in
 * `team_players.position`, like Basketball and Baseball; custom values are kept.
 */
export const HOCKEY_POSITIONS = [
  { code: 'C', label: 'Center', group: 'forward' },
  { code: 'LW', label: 'Left wing', group: 'forward' },
  { code: 'RW', label: 'Right wing', group: 'forward' },
  { code: 'D', label: 'Defense', group: 'defense' },
  { code: 'G', label: 'Goalie', group: 'goalie' },
] as const

export type HockeyPositionCode = (typeof HOCKEY_POSITIONS)[number]['code']

export const HOCKEY_POSITION_CODES: readonly string[] = HOCKEY_POSITIONS.map(position => position.code)
export const HOCKEY_POSITION_MAX_LENGTH = 80

const CUSTOM_KEY = 500
const UNASSIGNED_KEY = 1000

/** Standard codes normalize to upper case; custom labels are preserved; blank is Unassigned. */
export function normalizeHockeyPosition(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > HOCKEY_POSITION_MAX_LENGTH) return null
  return HOCKEY_POSITION_CODES.find(code => code === trimmed.toUpperCase()) ?? trimmed
}

export function hockeyPositionLabel(position: string | null): string {
  if (position === null) return 'Unassigned'
  return HOCKEY_POSITIONS.find(entry => entry.code === position)?.label ?? position
}

/** Sort key: standard positions in catalog order, then custom, then Unassigned. */
export function hockeyPositionSortKey(position: string | null): number {
  if (position === null) return UNASSIGNED_KEY
  const index = HOCKEY_POSITION_CODES.indexOf(position)
  return index >= 0 ? index : CUSTOM_KEY
}

/** A roster goalie dresses as a goalie by default; everyone else as a skater. */
export function defaultHockeyDressedAs(position: string | null): 'skater' | 'goalie' {
  return position === 'G' ? 'goalie' : 'skater'
}

const NATURAL_LABEL_ORDER = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

interface HockeyActorCandidate {
  id: string
  displayName: string
  number: string | null
  position: string | null
}

/** Actor order from the shared decisions: position, jersey number, name, then id. */
export function sortHockeyActors<T extends HockeyActorCandidate>(actors: readonly T[]): T[] {
  return [...actors].sort((left, right) => {
    const leftKey = hockeyPositionSortKey(left.position)
    const rightKey = hockeyPositionSortKey(right.position)
    return leftKey - rightKey ||
      (leftKey === CUSTOM_KEY ? NATURAL_LABEL_ORDER.compare(left.position!, right.position!) : 0) ||
      compareOptionalNumber(left.number, right.number) ||
      NATURAL_LABEL_ORDER.compare(left.displayName, right.displayName) ||
      left.id.localeCompare(right.id)
  })
}

function compareOptionalNumber(left: string | null, right: string | null): number {
  const leftValue = left?.trim() ?? ''
  const rightValue = right?.trim() ?? ''
  if (leftValue && !rightValue) return -1
  if (!leftValue && rightValue) return 1
  return NATURAL_LABEL_ORDER.compare(leftValue, rightValue)
}
