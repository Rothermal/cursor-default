/**
 * RTN-2 shared roster refresh model (sport neutral, pure).
 *
 * Compares a game's tracked-team participants with the team's current roster
 * and lists what changed. Only participants with a playerId are matched;
 * opponents and free-text late adds are edited by hand only.
 */

export interface RosterRefreshParticipant {
  participantId: string
  playerId: string | null
  teamSide: 'tracked' | 'opponent'
  displayName: string
  number: string | null
  position: string | null
}

export interface RosterRefreshRosterRow {
  playerId: string
  name: string
  number: string | null
  position: string | null
  isActive: boolean
}

export interface RosterRefreshUpdate {
  participantId: string
  playerId: string
  displayName: string
  from: { number: string | null; position: string | null }
  to: { number: string | null; position: string | null }
}

export interface RosterRefreshAddition {
  playerId: string
  name: string
  number: string | null
  position: string | null
}

export interface RosterRefreshDiff {
  updates: RosterRefreshUpdate[]
  additions: RosterRefreshAddition[]
  /** Tracked participants with a playerId that the roster no longer lists. Shown, never removed. */
  unmatched: RosterRefreshParticipant[]
}

export function normalizeRosterLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

export function diffGameRoster(
  participants: RosterRefreshParticipant[],
  roster: RosterRefreshRosterRow[],
  /** `number`: sports whose game position is tactical (Soccer) compare numbers only. */
  fields: 'number' | 'number_and_position' = 'number_and_position'
): RosterRefreshDiff {
  const rosterById = new Map(roster.map(row => [row.playerId, row]))
  const inGame = new Set<string>()
  const updates: RosterRefreshUpdate[] = []
  const unmatched: RosterRefreshParticipant[] = []
  for (const participant of participants) {
    if (participant.teamSide !== 'tracked' || !participant.playerId) continue
    inGame.add(participant.playerId)
    const row = rosterById.get(participant.playerId)
    if (!row) {
      unmatched.push(participant)
      continue
    }
    const from = { number: normalizeRosterLabel(participant.number), position: normalizeRosterLabel(participant.position) }
    const to = {
      number: normalizeRosterLabel(row.number),
      position: fields === 'number' ? from.position : normalizeRosterLabel(row.position),
    }
    if (from.number === to.number && from.position === to.position) continue
    updates.push({ participantId: participant.participantId, playerId: participant.playerId, displayName: participant.displayName, from, to })
  }
  const additions = roster
    .filter(row => row.isActive && !inGame.has(row.playerId))
    .map(row => ({ playerId: row.playerId, name: row.name, number: normalizeRosterLabel(row.number), position: normalizeRosterLabel(row.position) }))
    .sort((a, b) => compareRosterNumbers(a.number, b.number) || a.name.localeCompare(b.name))
  return { updates, additions, unmatched }
}

export function isEmptyRosterRefreshDiff(diff: RosterRefreshDiff): boolean {
  return diff.updates.length === 0 && diff.additions.length === 0
}

/** "#12 → #21, G → PG" style summary of one update. */
export function describeRosterUpdate(update: Pick<RosterRefreshUpdate, 'from' | 'to'>): string {
  const parts: string[] = []
  if (update.from.number !== update.to.number) {
    parts.push(`${formatNumber(update.from.number)} → ${formatNumber(update.to.number)}`)
  }
  if (update.from.position !== update.to.position) {
    parts.push(`${update.from.position ?? 'no position'} → ${update.to.position ?? 'no position'}`)
  }
  return parts.join(', ')
}

function formatNumber(value: string | null): string {
  return value ? `#${value}` : 'no number'
}

function compareRosterNumbers(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  const numeric = Number(a) - Number(b)
  return Number.isFinite(numeric) && numeric !== 0 ? numeric : a.localeCompare(b)
}
