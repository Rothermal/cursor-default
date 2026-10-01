import {
  baseballBaseOf,
  baseballCanEnter,
  baseballDesignatedHitterId,
  baseballLeavingNote,
  baseballNonBattingFielders,
  baseballOrdinal,
} from './lineupView'
import { baseballFieldingPositionCode } from './positions'
import { baseballPersonLabel } from './trackerView'
import type { BaseballSportGameState, BaseballSubstitution } from './types'

/**
 * The substitutions the tracked team can make right now. Each option is one
 * `baseball.substitution` event: a single change (BSB-4A), or the ordered changes of a
 * double switch or a DH forfeiture (BSB-4B), which the engine checks as a whole. The
 * summary says exactly what happens before Confirm, in the same style as the BSB-3D
 * pitching change. The lists follow the projector's rules, so an illegal choice is never
 * offered.
 */
export type BaseballSubstitutionKind =
  | 'pinch_hitter'
  | 'pinch_runner'
  | 'courtesy_runner'
  | 'defensive'
  | 'position_change'
  | 'double_switch'
  | 'designated_hitter'

export const BASEBALL_SUBSTITUTION_KIND_LABELS: Record<BaseballSubstitutionKind, string> = {
  pinch_hitter: 'Pinch hitter',
  pinch_runner: 'Pinch runner',
  courtesy_runner: 'Courtesy runner',
  defensive: 'Defensive replacement',
  position_change: 'Position switch',
  double_switch: 'Double switch',
  designated_hitter: 'End the DH',
}

export interface BaseballSubstitutionOption {
  key: string
  /** The choice as listed, usually the incoming player. */
  label: string
  summary: string[]
  /** Applied in order as one event. */
  changes: BaseballSubstitution[]
  /** Double switch options are picked by their parts rather than from one long list. */
  doubleSwitch?: BaseballDoubleSwitchOptionParts
}

export interface BaseballDoubleSwitchParts {
  pitcherId: string
  fielderId: string
  /** Whose batting slot the new pitcher takes; the new fielder takes the other one. */
  pitcherBats: 'fielder_slot' | 'pitcher_slot'
}

interface BaseballDoubleSwitchOptionParts extends BaseballDoubleSwitchParts {
  pitcherLabel: string
  fielderLabel: string
  slotLabel: string
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
  'double_switch',
  'designated_hitter',
]

export function baseballSubstitutionChoices(sport: BaseballSportGameState): BaseballSubstitutionChoices {
  const empty: BaseballSubstitutionChoices = {
    pinch_hitter: [],
    pinch_runner: [],
    courtesy_runner: [],
    defensive: [],
    position_change: [],
    double_switch: [],
    designated_hitter: [],
  }
  const { projection } = sport
  if (projection.status !== 'in_progress' || projection.pendingEnd !== null) return empty
  const groups = {
    pinch_hitter: pinchHitter(sport),
    pinch_runner: pinchRunners(sport),
    courtesy_runner: courtesyRunners(sport),
    defensive: defensive(sport),
    position_change: positionChanges(sport),
    double_switch: doubleSwitches(sport),
    designated_hitter: designatedHitter(sport),
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
  /** Double switch picks so far; the option is chosen once all three are set. */
  parts?: Partial<BaseballDoubleSwitchParts>
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
      changes: [{ kind: 'pinch_hitter', incomingId: id, outgoingId: batterId }],
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
        changes: [{ kind: 'pinch_runner', incomingId: id, outgoingId: runnerId }],
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
        changes: [{ kind: 'courtesy_runner', incomingId: id, outgoingId: runnerId }],
      })),
    }]
  })
}

function defensive(sport: BaseballSportGameState): BaseballSubstitutionGroup[] {
  const { setup, projection } = sport
  const lineup = projection.lineups.tracked
  const positions = Array.from({ length: setup.rulesSnapshot.defensivePlayers }, (_, index) => index + 1)
  // Batters with no position: a pinch hitter or runner still in the game, or a DH or EH.
  // The DH (or whoever replaces them) taking the field ends the DH role, which is the
  // End the DH choice, because the pitcher has to bat.
  const dhId = baseballDesignatedHitterId(sport)
  const unplaced = lineup.battingOrder.filter(id => positionOf(sport, id) === null && id !== dhId)
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
          changes: [{ kind: 'defensive', position, incomingId: id, outgoingId: occupant }],
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
        changes: [{ kind: 'defensive', position, incomingId: id, outgoingId: null }],
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
          changes: [{ kind: 'defensive', position, incomingId: id, outgoingId: leavingId }],
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
            changes: [{ kind: 'position_change', assignments: [{ participantId: moverId, position: to }] }],
          }
        }
        const other = name(sport, otherId)
        return {
          key: `pos:${from}:${to}`,
          label: `Swap with ${other} (${code(to)})`,
          summary: [`${mover} moves from ${code(from)} to ${code(to)}.`, `${other} moves from ${code(to)} to ${code(from)}.`, 'Batting slots do not change.'],
          changes: [{
            kind: 'position_change',
            assignments: [
              { participantId: moverId, position: to },
              { participantId: otherId, position: from },
            ],
          }],
        }
      })
    return [{ key: `pos:${from}`, title: `${mover} (${code(from)})`, options }]
  })
}

/**
 * Double switch (BSB-4B): a new pitcher and a new fielder enter together, and the
 * outgoing pitcher and fielder leave, so the new pitcher can take the fielder's batting
 * slot. One group per position; its options cover every new pitcher, new fielder and slot
 * arrangement, picked by part in the sheet. Needs a pitcher who bats.
 */
function doubleSwitches(sport: BaseballSportGameState): BaseballSubstitutionGroup[] {
  const { setup, projection } = sport
  const lineup = projection.lineups.tracked
  const pitcherId = lineup.defense['1'] ?? null
  if (!pitcherId || baseballBaseOf(sport, pitcherId)) return []
  const pitcherSlot = lineup.battingOrder.indexOf(pitcherId)
  if (pitcherSlot < 0) return []
  const pitcher = name(sport, pitcherId)
  const positions = Array.from({ length: setup.rulesSnapshot.defensivePlayers }, (_, index) => index + 1).filter(position => position !== 1)
  return positions.flatMap<BaseballSubstitutionGroup>(position => {
    const fielderId = lineup.defense[String(position)] ?? null
    if (!fielderId || baseballBaseOf(sport, fielderId)) return []
    const fielderSlot = lineup.battingOrder.indexOf(fielderId)
    if (fielderSlot < 0) return []
    const fielder = name(sport, fielderId)
    const where = code(position)
    const options: BaseballSubstitutionOption[] = []
    for (const pitcherBats of ['fielder_slot', 'pitcher_slot'] as const) {
      const newPitcherSlot = pitcherBats === 'fielder_slot' ? fielderSlot : pitcherSlot
      const newFielderSlot = pitcherBats === 'fielder_slot' ? pitcherSlot : fielderSlot
      for (const inPitcher of benchFor(sport, newPitcherSlot)) {
        for (const inFielder of benchFor(sport, newFielderSlot)) {
          if (inFielder === inPitcher) continue
          options.push({
            key: `ds:${position}:${inPitcher}:${inFielder}:${pitcherBats}`,
            label: `${name(sport, inPitcher)} pitches, ${name(sport, inFielder)} to ${where}`,
            summary: [
              `${name(sport, inPitcher)}${reentryTag(sport, inPitcher)} replaces ${pitcher} as pitcher, batting ${baseballOrdinal(newPitcherSlot)}.`,
              `${name(sport, inFielder)}${reentryTag(sport, inFielder)} replaces ${fielder} at ${where}, batting ${baseballOrdinal(newFielderSlot)}.`,
              baseballLeavingNote(sport, pitcherId),
              baseballLeavingNote(sport, fielderId),
            ],
            changes: [
              { kind: 'defensive', position: 1, incomingId: inPitcher, outgoingId: pitcherBats === 'fielder_slot' ? fielderId : pitcherId },
              { kind: 'defensive', position, incomingId: inFielder, outgoingId: pitcherBats === 'fielder_slot' ? pitcherId : fielderId },
            ],
            doubleSwitch: {
              pitcherId: inPitcher,
              fielderId: inFielder,
              pitcherBats,
              pitcherLabel: `${name(sport, inPitcher)}${reentryTag(sport, inPitcher)}`,
              fielderLabel: `${name(sport, inFielder)}${reentryTag(sport, inFielder)}`,
              slotLabel: pitcherBats === 'fielder_slot'
                ? `Pitcher bats ${baseballOrdinal(fielderSlot)}, ${where} bats ${baseballOrdinal(pitcherSlot)} (switched)`
                : `Pitcher bats ${baseballOrdinal(pitcherSlot)}, ${where} bats ${baseballOrdinal(fielderSlot)} (unchanged)`,
            },
          })
        }
      }
    }
    return [{ key: `ds:${position}`, title: `${where} (${fielder}) with ${pitcher}`, options }]
  })
}

/**
 * DH forfeiture (BSB-4B): the DH takes the field and the pitcher bats in the place of the
 * fielder who leaves, or the pitcher bats in the DH's place. Either way the DH role ends
 * for the rest of the game, as every profile's DH rule says.
 */
function designatedHitter(sport: BaseballSportGameState): BaseballSubstitutionGroup[] {
  const { setup, projection } = sport
  const lineup = projection.lineups.tracked
  const dhId = baseballDesignatedHitterId(sport)
  const [pitcherId] = baseballNonBattingFielders(sport)
  if (!dhId || !pitcherId) return []
  const dh = name(sport, dhId)
  const pitcher = name(sport, pitcherId)
  const dhSlot = lineup.battingOrder.indexOf(dhId)
  const ends = 'The DH role ends for the rest of the game.'
  const pitcherCode = code(Number(Object.keys(lineup.defense).find(key => lineup.defense[key] === pitcherId)))
  const positions = Array.from({ length: setup.rulesSnapshot.defensivePlayers }, (_, index) => index + 1)
  const field = positions.flatMap<BaseballSubstitutionOption>(position => {
    const occupant = lineup.defense[String(position)] ?? null
    const where = code(position)
    if (!occupant) return []
    if (occupant === pitcherId) {
      return [{
        key: `dh:field:${position}`,
        label: `${dh} to ${where}`,
        summary: [`${dh} moves from DH to ${where} and keeps batting ${baseballOrdinal(dhSlot)}.`, `${pitcher} leaves the game.`, baseballLeavingNote(sport, pitcherId), ends],
        changes: [{ kind: 'defensive', position, incomingId: dhId, outgoingId: null }],
      }]
    }
    const slot = lineup.battingOrder.indexOf(occupant)
    if (slot < 0 || baseballBaseOf(sport, occupant)) return []
    const leaving = name(sport, occupant)
    return [{
      key: `dh:field:${position}`,
      label: `${dh} to ${where} for ${leaving}`,
      summary: [
        `${dh} moves from DH to ${where} and keeps batting ${baseballOrdinal(dhSlot)}.`,
        `${leaving} leaves the game; ${pitcher} (${pitcherCode}) bats ${baseballOrdinal(slot)} in that place.`,
        baseballLeavingNote(sport, occupant),
        ends,
      ],
      changes: [
        { kind: 'defensive', position, incomingId: dhId, outgoingId: null },
        { kind: 'batting_slot', incomingId: pitcherId, outgoingId: occupant },
      ],
    }]
  })
  const bats: BaseballSubstitutionOption[] = baseballBaseOf(sport, dhId)
    ? []
    : [{
      key: 'dh:bats',
      label: `${pitcher} bats for ${dh}`,
      summary: [`${pitcher} (${pitcherCode}) bats ${baseballOrdinal(dhSlot)} in place of ${dh}.`, `${dh} leaves the game.`, baseballLeavingNote(sport, dhId), ends],
      changes: [{ kind: 'batting_slot', incomingId: pitcherId, outgoingId: dhId }],
    }]
  return [
    { key: 'dh:field', title: `${dh} takes the field`, options: field },
    { key: 'dh:bats', title: `${pitcher} bats for the DH`, options: bats },
  ]
}

export interface BaseballDoubleSwitchPicker {
  pitchers: Array<{ id: string; label: string }>
  /** Empty until a new pitcher is picked. */
  fielders: Array<{ id: string; label: string }>
  /** Empty until both players are picked. */
  slots: Array<{ value: BaseballDoubleSwitchParts['pitcherBats']; label: string }>
}

/** The three double switch pickers, each narrowed by the picks before it. */
export function baseballDoubleSwitchPicker(group: BaseballSubstitutionGroup, parts: Partial<BaseballDoubleSwitchParts> = {}): BaseballDoubleSwitchPicker {
  const options = group.options.flatMap(entry => (entry.doubleSwitch ? [entry.doubleSwitch] : []))
  const unique = <T extends { id: string }>(list: T[]) => list.filter((entry, index) => list.findIndex(other => other.id === entry.id) === index)
  const pitchers = unique(options.map(entry => ({ id: entry.pitcherId, label: entry.pitcherLabel })))
  const withPitcher = options.filter(entry => entry.pitcherId === parts.pitcherId)
  const fielders = unique(withPitcher.map(entry => ({ id: entry.fielderId, label: entry.fielderLabel })))
  const slots = withPitcher
    .filter(entry => entry.fielderId === parts.fielderId)
    .map(entry => ({ value: entry.pitcherBats, label: entry.slotLabel }))
  return { pitchers, fielders, slots }
}

/**
 * Applies one double switch pick: later picks that no longer fit are cleared, and the
 * option is selected once all three parts match one.
 */
export function pickBaseballDoubleSwitch(
  group: BaseballSubstitutionGroup,
  draft: BaseballSubstitutionDraft,
  patch: Partial<BaseballDoubleSwitchParts>
): BaseballSubstitutionDraft {
  let parts: Partial<BaseballDoubleSwitchParts> = { ...draft.parts, ...patch }
  const picker = baseballDoubleSwitchPicker(group, parts)
  if (!picker.fielders.some(entry => entry.id === parts.fielderId)) parts = { pitcherId: parts.pitcherId, pitcherBats: parts.pitcherBats }
  const slots = baseballDoubleSwitchPicker(group, parts).slots
  if (!slots.some(entry => entry.value === parts.pitcherBats)) {
    parts = { ...parts, pitcherBats: slots.find(entry => entry.value === 'fielder_slot')?.value ?? slots[0]?.value }
  }
  const option = group.options.find(entry =>
    entry.doubleSwitch?.pitcherId === parts.pitcherId &&
    entry.doubleSwitch?.fielderId === parts.fielderId &&
    entry.doubleSwitch?.pitcherBats === parts.pitcherBats
  )
  return { ...draft, groupKey: group.key, parts, optionKey: option?.key ?? null }
}
