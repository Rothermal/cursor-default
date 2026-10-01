import { baseballCanEnter, baseballLeavingNote, baseballOrdinal } from './lineupView'
import { baseballFieldingPositionCode } from './positions'
import { baseballPersonLabel } from './trackerView'
import type { BaseballOpponentPitcher, BaseballPitchHand, BaseballSportGameState, BaseballSubstitution } from './types'

/**
 * Pitching changes for the tracked team (BSB-3D, Q2). Only two shapes are offered, each a
 * single substitution that always leaves a complete defense:
 *
 * - a bench player replaces the pitcher (one `defensive` substitution at position 1), and
 *   takes the pitcher's batting slot; the pitcher leaves the game;
 * - a fielder swaps with the pitcher (one `position_change` with two assignments); both
 *   keep their batting slots.
 *
 * A double switch is a multi-change substitution on the Lineup tab (BSB-4B).
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

export function baseballPitchingChangeOptions(sport: BaseballSportGameState): BaseballPitchingChangeOptions {
  const { setup, projection } = sport
  const lineup = projection.lineups.tracked
  const pitcherId = lineup.defense['1'] ?? null
  if (!pitcherId) return { pitcherId: null, bench: [], fielders: [] }
  const name = (id: string) => baseballPersonLabel(sport, id).name
  const pitcher = name(pitcherId)
  const slot = lineup.battingOrder.indexOf(pitcherId)
  const leavingNote = baseballLeavingNote(sport, pitcherId)

  const bench = setup.participants
    // The incoming player takes the pitcher's batting slot, so a returning starter must
    // have started in that slot (BSB-4A found the old list could offer an illegal return).
    .filter(participant => baseballCanEnter(sport, participant.id, slot >= 0 ? slot : null))
    .map<BaseballPitchingChangeOption>(participant => {
      const incoming = name(participant.id)
      return {
        kind: 'bench',
        incomingId: participant.id,
        name: incoming,
        summary: [
          slot >= 0
            ? `${incoming} replaces ${pitcher}, batting ${baseballOrdinal(slot)}.`
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
  number: string,
  throws: BaseballPitchHand | null = null
): Extract<BaseballSubstitution, { kind: 'opponent_pitcher' }> {
  const pitcher: BaseballOpponentPitcher = {
    id,
    label: label.trim() || null,
    number: number.trim() || null,
    throws,
  }
  return { kind: 'opponent_pitcher', pitcher }
}
