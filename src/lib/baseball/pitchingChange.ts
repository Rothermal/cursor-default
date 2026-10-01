import { baseballFieldingPositionCode } from './positions'
import { baseballPersonLabel } from './trackerView'
import type { BaseballBase, BaseballOpponentPitcher, BaseballSportGameState, BaseballSubstitution } from './types'

/**
 * Pitching changes for the tracked team (BSB-3D, Q2). Only two shapes are offered, each a
 * single substitution that always leaves a complete defense:
 *
 * - a bench player replaces the pitcher (one `defensive` substitution at position 1), and
 *   takes the pitcher's batting slot; the pitcher leaves the game;
 * - a fielder swaps with the pitcher (one `position_change` with two assignments); both
 *   keep their batting slots.
 *
 * Anything else (a double switch, the old pitcher to a third position) is a defensive switch
 * and stays in BSB-4.
 */
export interface BaseballPitchingChangeOption {
  kind: 'bench' | 'fielder'
  incomingId: string
  /** The incoming player's name, for the choice list. */
  name: string
  /** Exactly what happens, shown before Confirm. */
  summary: string[]
  substitution: BaseballSubstitution
}

export interface BaseballPitchingChangeOptions {
  pitcherId: string | null
  bench: BaseballPitchingChangeOption[]
  fielders: BaseballPitchingChangeOption[]
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th', '13th', '14th', '15th']
const BASES: readonly BaseballBase[] = ['first', 'second', 'third']

export function baseballPitchingChangeOptions(sport: BaseballSportGameState): BaseballPitchingChangeOptions {
  const { setup, projection } = sport
  const lineup = projection.lineups.tracked
  const pitcherId = lineup.defense['1'] ?? null
  if (!pitcherId) return { pitcherId: null, bench: [], fielders: [] }
  const name = (id: string) => baseballPersonLabel(sport, id).name
  const pitcher = name(pitcherId)
  const onBase = new Set(BASES.flatMap(base => (projection.bases[base] ? [projection.bases[base]!.runnerId] : [])))
  const fielding = new Set(Object.values(lineup.defense))
  const active = (id: string) => lineup.battingOrder.includes(id) || fielding.has(id) || onBase.has(id)
  const reentry = setup.rulesSnapshot.reentry
  const mayReturn = (id: string) => {
    if (!lineup.removedIds.includes(id)) return true
    if (reentry === 'unlimited') return true
    return reentry === 'starters_once' && lineup.starterIds.includes(id) && !lineup.reenteredIds.includes(id)
  }

  const slot = lineup.battingOrder.indexOf(pitcherId)
  const leavingNote = (() => {
    if (reentry === 'unlimited') return `${pitcher} leaves the game and may re-enter later.`
    if (reentry === 'starters_once' && lineup.starterIds.includes(pitcherId) && !lineup.reenteredIds.includes(pitcherId)) {
      return `${pitcher} leaves the game and may re-enter once, in the same batting slot.`
    }
    return `${pitcher} leaves the game and cannot re-enter under these rules.`
  })()

  const bench = setup.participants
    .filter(participant => !active(participant.id) && mayReturn(participant.id))
    .map<BaseballPitchingChangeOption>(participant => {
      const incoming = name(participant.id)
      return {
        kind: 'bench',
        incomingId: participant.id,
        name: incoming,
        summary: [
          slot >= 0
            ? `${incoming} replaces ${pitcher}, batting ${ORDINALS[slot] ?? `${slot + 1}th`}.`
            : `${incoming} replaces ${pitcher} and does not bat.`,
          leavingNote,
        ],
        substitution: { kind: 'defensive', position: 1, incomingId: participant.id, outgoingId: pitcherId },
      }
    })

  const fielders = Object.entries(lineup.defense)
    .filter(([position, id]) => position !== '1' && id !== pitcherId)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map<BaseballPitchingChangeOption>(([position, id]) => {
      const incoming = name(id)
      const code = baseballFieldingPositionCode(Number(position)) ?? `position ${position}`
      return {
        kind: 'fielder',
        incomingId: id,
        name: `${incoming} (${code})`,
        summary: [
          `${incoming} moves from ${code} to pitch.`,
          `${pitcher} moves to ${code}.`,
          'Both keep their batting slots.',
        ],
        substitution: {
          kind: 'position_change',
          assignments: [
            { participantId: id, position: 1 },
            { participantId: pitcherId, position: Number(position) },
          ],
        },
      }
    })

  return { pitcherId, bench, fielders }
}

/** A new opponent pitcher, known by a label and/or number. */
export function baseballOpponentPitcherChange(
  id: string,
  label: string,
  number: string
): Extract<BaseballSubstitution, { kind: 'opponent_pitcher' }> {
  const pitcher: BaseballOpponentPitcher = {
    id,
    label: label.trim() || null,
    number: number.trim() || null,
    throws: null,
  }
  return { kind: 'opponent_pitcher', pitcher }
}
