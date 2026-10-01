import {
  baseballBaseOf,
  baseballCanEnter,
  baseballLeavingNote,
  baseballOrdinal,
} from './lineupView'
import { baseballFieldingPositionCode } from './positions'
import { baseballPersonLabel } from './trackerView'
import type { BaseballSportGameState, BaseballSubstitution } from './types'

/**
 * The single-change substitutions the tracked team can make right now (BSB-4A). Each
 * option is one `baseball.substitution` event; the summary says exactly what happens
 * before Confirm, in the same style as the BSB-3D pitching change. The lists follow the
 * projector's rules, so an illegal choice is never offered. Double switches and DH
 * forfeiture are multi-change substitutions and come with BSB-4B.
 */
export type BaseballSubstitutionKind =
  | 'pinch_hitter'
  | 'pinch_runner'
  | 'courtesy_runner'
  | 'defensive'
  | 'position_change'

export const BASEBALL_SUBSTITUTION_KIND_LABELS: Record<BaseballSubstitutionKind, string> = {
  pinch_hitter: 'Pinch hitter',
  pinch_runner: 'Pinch runner',
  courtesy_runner: 'Courtesy runner',
  defensive: 'Defensive replacement',
  position_change: 'Position switch',
}

export interface BaseballSubstitutionOption {
  key: string
  /** The choice as listed, usually the incoming player. */
  label: string
  summary: string[]
  substitution: BaseballSubstitution
}

/** One "who or where" target, such as the current batter or the shortstop. */
export interface BaseballSubstitutionGroup {
  key: string
  title: string
  options: BaseballSubstitutionOption[]
}

export type BaseballSubstitutionChoices = Record<BaseballSubstitutionKind, BaseballSubstitutionGroup[]>

export const BASEBALL_SUBSTITUTION_KINDS: readonly BaseballSubstitutionKind[] = [
  'pinch_hitter',
  'pinch_runner',
  'courtesy_runner',
  'defensive',
  'position_change',
]

export function baseballSubstitutionChoices(sport: BaseballSportGameState): BaseballSubstitutionChoices {
  const empty: BaseballSubstitutionChoices = {
    pinch_hitter: [],
    pinch_runner: [],
    courtesy_runner: [],
    defensive: [],
    position_change: [],
  }
  const { projection } = sport
  if (projection.status !== 'in_progress' || projection.pendingEnd !== null) return empty
  const groups = {
    pinch_hitter: pinchHitter(sport),
    pinch_runner: pinchRunners(sport),
    courtesy_runner: courtesyRunners(sport),
    defensive: defensive(sport),
    position_change: positionChanges(sport),
  }
  for (const kind of BASEBALL_SUBSTITUTION_KINDS) {
    empty[kind] = groups[kind].filter(group => group.options.length > 0)
  }
  return empty
}

/** What the substitution sheet has picked so far; nothing is written until Confirm. */
export interface BaseballSubstitutionDraft {
  kind: BaseballSubstitutionKind | null
  groupKey: string | null
  optionKey: string | null
}

export function emptyBaseballSubstitutionDraft(kind: BaseballSubstitutionKind | null = null, groupKey: string | null = null): BaseballSubstitutionDraft {
  return { kind, groupKey, optionKey: null }
}

/** The chosen target; a kind with a single target (the current batter) needs no extra tap. */
export function baseballSubstitutionGroup(choices: BaseballSubstitutionChoices, draft: BaseballSubstitutionDraft): BaseballSubstitutionGroup | null {
  if (!draft.kind) return null
  const groups = choices[draft.kind]
  return groups.find(entry => entry.key === draft.groupKey) ?? (groups.length === 1 ? groups[0]! : null)
}

export function selectedBaseballSubstitution(choices: BaseballSubstitutionChoices, draft: BaseballSubstitutionDraft): BaseballSubstitutionOption | null {
  return baseballSubstitutionGroup(choices, draft)?.options.find(entry => entry.key === draft.optionKey) ?? null
}

/** Kinds with at least one legal choice, in menu order. */
export function baseballAvailableSubstitutionKinds(choices: BaseballSubstitutionChoices): BaseballSubstitutionKind[] {
  return BASEBALL_SUBSTITUTION_KINDS.filter(kind => choices[kind].length > 0)
}

function name(sport: BaseballSportGameState, id: string): string {
  return baseballPersonLabel(sport, id).name
}

function code(position: number): string {
  return baseballFieldingPositionCode(position) ?? `position ${position}`
}

function positionOf(sport: BaseballSportGameState, id: string): number | null {
  const defense = sport.projection.lineups.tracked.defense
  const key = Object.keys(defense).find(position => defense[position] === id)
  return key ? Number(key) : null
}

function benchFor(sport: BaseballSportGameState, slot: number | null): string[] {
  return sport.setup.participants.map(participant => participant.id).filter(id => baseballCanEnter(sport, id, slot))
}

function reentryTag(sport: BaseballSportGameState, id: string): string {
  return sport.projection.lineups.tracked.removedIds.includes(id) ? ' (re-entry)' : ''
}

function pinchHitter(sport: BaseballSportGameState): BaseballSubstitutionGroup[] {
  const { projection } = sport
  const lineup = projection.lineups.tracked
  const batterId = projection.battingSide === 'tracked' ? projection.currentBatterId : null
  if (!batterId) return []
  const slot = lineup.battingOrder.indexOf(batterId)
  if (slot < 0) return []
  const batter = name(sport, batterId)
  return [{
    key: `ph:${batterId}`,
    title: `For ${batter}, batting ${baseballOrdinal(slot)}`,
    options: benchFor(sport, slot).map(id => ({
      key: `ph:${batterId}:${id}`,
      label: `${name(sport, id)}${reentryTag(sport, id)}`,
      summary: [
        `${name(sport, id)} pinch-hits for ${batter}, batting ${baseballOrdinal(slot)}.`,
        ...(projection.balls + projection.strikes > 0 ? [`The count stays ${projection.balls}-${projection.strikes}.`] : []),
        baseballLeavingNote(sport, batterId),
      ],
      substitution: { kind: 'pinch_hitter', incomingId: id, outgoingId: batterId },
    })),
  }]
}

function runnersOnBase(sport: BaseballSportGameState) {
  const { projection } = sport
  if (projection.battingSide !== 'tracked') return []
  return (['first', 'second', 'third'] as const).flatMap(base => {
    const runner = projection.bases[base]
    return runner ? [{ base, runnerId: runner.runnerId }] : []
  })
}

function pinchRunners(sport: BaseballSportGameState): BaseballSubstitutionGroup[] {
  const lineup = sport.projection.lineups.tracked
  return runnersOnBase(sport).flatMap(({ base, runnerId }) => {
    const slot = lineup.battingOrder.indexOf(runnerId)
    // A courtesy runner holds no batting slot, so nobody can pinch-run for them.
    if (slot < 0) return []
    const runner = name(sport, runnerId)
    return [{
      key: `pr:${runnerId}`,
      title: `For ${runner} on ${base}`,
      options: benchFor(sport, slot).map(id => ({
        key: `pr:${runnerId}:${id}`,
        label: `${name(sport, id)}${reentryTag(sport, id)}`,
        summary: [
          `${name(sport, id)} runs for ${runner} on ${base} and takes the ${baseballOrdinal(slot)} batting slot.`,
          baseballLeavingNote(sport, runnerId),
        ],
        substitution: { kind: 'pinch_runner', incomingId: id, outgoingId: runnerId },
      })),
    }]
  })
}

function courtesyRunners(sport: BaseballSportGameState): BaseballSubstitutionGroup[] {
  if (!sport.setup.rulesSnapshot.courtesyRunners) return []
  const lineup = sport.projection.lineups.tracked
  return runnersOnBase(sport).flatMap(({ base, runnerId }) => {
    const role = lineup.defense['1'] === runnerId ? 'pitcher' : lineup.defense['2'] === runnerId ? 'catcher' : null
    if (!role) return []
    const runner = name(sport, runnerId)
    // Only players who have not appeared in the game, which is stricter than the engine.
    const candidates = sport.setup.participants
      .map(participant => participant.id)
      .filter(id => !lineup.appearedIds.includes(id) && baseballCanEnter(sport, id, null))
    return [{
      key: `cr:${runnerId}`,
      title: `For ${runner} (${role}) on ${base}`,
      options: candidates.map(id => ({
        key: `cr:${runnerId}:${id}`,
        label: name(sport, id),
        summary: [
          `${name(sport, id)} runs for ${runner} on ${base} (courtesy runner).`,
          `${runner} stays in the game, and ${name(sport, id)} does not take a batting slot.`,
        ],
        substitution: { kind: 'courtesy_runner', incomingId: id, outgoingId: runnerId },
      })),
    }]
  })
}

function defensive(sport: BaseballSportGameState): BaseballSubstitutionGroup[] {
  const { setup, projection } = sport
  const lineup = projection.lineups.tracked
  const positions = Array.from({ length: setup.rulesSnapshot.defensivePlayers }, (_, index) => index + 1)
  // Batters with no position: a pinch hitter or runner still in the game, or a DH or EH.
  const unplaced = lineup.battingOrder.filter(id => positionOf(sport, id) === null)
  return positions.map<BaseballSubstitutionGroup>(position => {
    const occupant = lineup.defense[String(position)] ?? null
    const where = code(position)
    if (occupant) {
      const slot = lineup.battingOrder.indexOf(occupant)
      const leaving = name(sport, occupant)
      // A runner on base leaves through a pinch runner instead.
      const options = baseballBaseOf(sport, occupant)
        ? []
        : benchFor(sport, slot >= 0 ? slot : null).map<BaseballSubstitutionOption>(id => ({
          key: `def:${position}:${id}`,
          label: `${name(sport, id)}${reentryTag(sport, id)}`,
          summary: [
            slot >= 0
              ? `${name(sport, id)} replaces ${leaving} at ${where}, batting ${baseballOrdinal(slot)}.`
              : `${name(sport, id)} replaces ${leaving} at ${where} and does not bat.`,
            baseballLeavingNote(sport, occupant),
          ],
          substitution: { kind: 'defensive', position, incomingId: id, outgoingId: occupant },
        }))
      return { key: `def:${position}`, title: `${where} (${leaving})`, options }
    }
    const stays = unplaced
      .filter(id => !baseballBaseOf(sport, id))
      .map<BaseballSubstitutionOption>(id => ({
        key: `def:${position}:${id}`,
        label: `${name(sport, id)} (already batting)`,
        summary: [
          `${name(sport, id)} stays in the game and plays ${where}, batting ${baseballOrdinal(lineup.battingOrder.indexOf(id))}.`,
        ],
        substitution: { kind: 'defensive', position, incomingId: id, outgoingId: null },
      }))
    const replacing = unplaced
      .filter(leavingId => !baseballBaseOf(sport, leavingId))
      .flatMap(leavingId => {
        const slot = lineup.battingOrder.indexOf(leavingId)
        return benchFor(sport, slot).map<BaseballSubstitutionOption>(id => ({
          key: `def:${position}:${id}:${leavingId}`,
          label: `${name(sport, id)}${reentryTag(sport, id)} for ${name(sport, leavingId)}`,
          summary: [
            `${name(sport, id)} replaces ${name(sport, leavingId)}, batting ${baseballOrdinal(slot)}, and plays ${where}.`,
            baseballLeavingNote(sport, leavingId),
          ],
          substitution: { kind: 'defensive', position, incomingId: id, outgoingId: leavingId },
        }))
      })
    return { key: `def:${position}`, title: `${where} (open)`, options: [...stays, ...replacing] }
  })
}

function positionChanges(sport: BaseballSportGameState): BaseballSubstitutionGroup[] {
  const { setup, projection } = sport
  const defense = projection.lineups.tracked.defense
  const positions = Array.from({ length: setup.rulesSnapshot.defensivePlayers }, (_, index) => index + 1)
  return positions.flatMap<BaseballSubstitutionGroup>(from => {
    const moverId = defense[String(from)]
    if (!moverId) return []
    const mover = name(sport, moverId)
    const options = positions
      .filter(to => to !== from)
      .map<BaseballSubstitutionOption>(to => {
        const otherId = defense[String(to)] ?? null
        if (!otherId) {
          return {
            key: `pos:${from}:${to}`,
            label: `Move to ${code(to)} (open)`,
            summary: [`${mover} moves from ${code(from)} to ${code(to)}.`, `${code(from)} is left open.`, 'Batting slots do not change.'],
            substitution: { kind: 'position_change', assignments: [{ participantId: moverId, position: to }] },
          }
        }
        const other = name(sport, otherId)
        return {
          key: `pos:${from}:${to}`,
          label: `Swap with ${other} (${code(to)})`,
          summary: [`${mover} moves from ${code(from)} to ${code(to)}.`, `${other} moves from ${code(to)} to ${code(from)}.`, 'Batting slots do not change.'],
          substitution: {
            kind: 'position_change',
            assignments: [
              { participantId: moverId, position: to },
              { participantId: otherId, position: from },
            ],
          },
        }
      })
    return [{ key: `pos:${from}`, title: `${mover} (${code(from)})`, options }]
  })
}
