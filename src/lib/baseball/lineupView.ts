import { baseballFieldingPositionCode } from './positions'
import { baseballPersonLabel } from './trackerView'
import type {
  BaseballBase,
  BaseballBatHand,
  BaseballPitchHand,
  BaseballSportGameState,
} from './types'

/**
 * Read-only Lineup tab models (BSB-4A). Everything comes from the frozen setup and the
 * projection; the eligibility helpers mirror the projector's admission rules so the
 * substitution sheet never offers a choice the engine would reject.
 */

const BASES: readonly BaseballBase[] = ['first', 'second', 'third']
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th', '13th', '14th', '15th']

export function baseballOrdinal(index: number): string {
  return ORDINALS[index] ?? `${index + 1}th`
}

export interface BaseballLineupCard {
  /** 1-based batting slot. */
  slot: number
  id: string
  name: string
  /** "SS", "DH", "EH" or "No position". */
  position: string
  bats: BaseballBatHand | null
  throws: BaseballPitchHand | null
  /** Batting now (the tracked team is up) or leading off next time. */
  status: 'batting' | 'up_next' | null
  /** The starter this slot began with, when someone else holds it now. */
  replaced: string | null
}

export interface BaseballDefenseRow {
  position: number
  code: string
  id: string | null
  name: string | null
  /** True when this fielder does not bat (a pitcher with a designated hitter). */
  doesNotBat: boolean
}

export type BaseballBenchStatus = 'available' | 'may_reenter' | 'out' | 'courtesy_runner'

export interface BaseballBenchEntry {
  id: string
  name: string
  status: BaseballBenchStatus
  note: string
}

export interface BaseballTrackedLineupView {
  cards: BaseballLineupCard[]
  defense: BaseballDefenseRow[]
  /** Position codes with nobody fielding them. */
  openPositions: string[]
  bench: BaseballBenchEntry[]
}

export interface BaseballOpponentLineupRow {
  slot: number
  id: string
  name: string
  position: string | null
  bats: BaseballBatHand | null
  status: 'batting' | 'up_next' | null
}

export interface BaseballOpponentLineupView {
  slots: BaseballOpponentLineupRow[]
  pitcher: { id: string; name: string; throws: BaseballPitchHand | null } | null
}

/** In the batting order, fielding, or on base (courtesy runners hold no slot). */
export function baseballIsActive(sport: BaseballSportGameState, id: string): boolean {
  const lineup = sport.projection.lineups.tracked
  return (
    lineup.battingOrder.includes(id) ||
    Object.values(lineup.defense).includes(id) ||
    baseballBaseOf(sport, id) !== null
  )
}

export function baseballBaseOf(sport: BaseballSportGameState, id: string): BaseballBase | null {
  return BASES.find(base => sport.projection.bases[base]?.runnerId === id) ?? null
}

/** The batting slot (0-based) a starter began in, or -1 for a substitute. */
export function baseballOriginalSlot(sport: BaseballSportGameState, id: string): number {
  return sport.setup.trackedLineup.battingOrder.indexOf(id)
}

/**
 * Whether a tracked player may enter the game into `slot` (0-based), or into no slot when
 * null. Mirrors the projector: nobody already in the game, and re-entry only as the rules
 * allow (a starter returns once, to the original slot).
 */
export function baseballCanEnter(sport: BaseballSportGameState, id: string, slot: number | null): boolean {
  if (!sport.setup.participants.some(participant => participant.id === id)) return false
  if (baseballIsActive(sport, id)) return false
  const lineup = sport.projection.lineups.tracked
  if (!lineup.removedIds.includes(id)) return true
  switch (sport.setup.rulesSnapshot.reentry) {
    case 'none':
      return false
    case 'unlimited':
      return true
    case 'starters_once':
      return (
        lineup.starterIds.includes(id) &&
        !lineup.reenteredIds.includes(id) &&
        slot !== null &&
        baseballOriginalSlot(sport, id) === slot
      )
  }
}

/** What happens to a player who leaves the game, in the summary's words. */
export function baseballLeavingNote(sport: BaseballSportGameState, id: string): string {
  const name = baseballPersonLabel(sport, id).name
  const lineup = sport.projection.lineups.tracked
  const reentry = sport.setup.rulesSnapshot.reentry
  if (reentry === 'unlimited') return `${name} leaves the game and may re-enter later.`
  if (reentry === 'starters_once' && lineup.starterIds.includes(id) && !lineup.reenteredIds.includes(id)) {
    const slot = baseballOriginalSlot(sport, id)
    return slot >= 0
      ? `${name} leaves the game and may re-enter once, in the ${baseballOrdinal(slot)} slot.`
      : `${name} leaves the game and cannot re-enter, because only starters in the batting order return to their slot.`
  }
  return `${name} leaves the game and cannot re-enter under these rules.`
}

function positionLabel(sport: BaseballSportGameState, id: string, slot: number): string {
  const defense = sport.projection.lineups.tracked.defense
  const key = Object.keys(defense).find(position => defense[position] === id)
  if (key) return baseballFieldingPositionCode(Number(key)) ?? `Fielder ${key}`
  // Only a slot that started without a position is a DH or EH; a pinch hitter or runner
  // who has not taken the field yet has no position.
  const starter = sport.setup.trackedLineup.battingOrder[slot]
  if (!starter || Object.values(sport.setup.trackedLineup.defense).includes(starter)) return 'No position'
  switch (sport.setup.rulesSnapshot.battingOrderFormat) {
    case 'designated_hitter':
      return 'DH'
    case 'extra_hitter':
      return 'EH'
    default:
      return 'No position'
  }
}

/** Batting now while that side is up, else the one who leads off its next half. */
function slotStatus(
  sport: BaseballSportGameState,
  side: 'tracked' | 'opponent',
  index: number
): 'batting' | 'up_next' | null {
  const { projection } = sport
  if (projection.status !== 'in_progress') return null
  const lineup = projection.lineups[side]
  if (lineup.battingOrder.length === 0) return null
  const next = lineup.nextBatterIndex % lineup.battingOrder.length
  if (projection.battingSide === side) {
    if (index === next) return 'batting'
    return index === (next + 1) % lineup.battingOrder.length ? 'up_next' : null
  }
  return index === next ? 'up_next' : null
}

export function baseballTrackedLineupView(sport: BaseballSportGameState): BaseballTrackedLineupView {
  const { setup, projection } = sport
  const lineup = projection.lineups.tracked
  const participant = new Map(setup.participants.map(entry => [entry.id, entry]))
  const name = (id: string) => baseballPersonLabel(sport, id).name

  const cards = lineup.battingOrder.map<BaseballLineupCard>((id, index) => {
    const starter = setup.trackedLineup.battingOrder[index] ?? null
    return {
      slot: index + 1,
      id,
      name: name(id),
      position: positionLabel(sport, id, index),
      bats: participant.get(id)?.bats ?? null,
      throws: participant.get(id)?.throws ?? null,
      status: slotStatus(sport, 'tracked', index),
      replaced: starter && starter !== id ? name(starter) : null,
    }
  })

  const defense = Array.from({ length: setup.rulesSnapshot.defensivePlayers }, (_, index) => index + 1).map<BaseballDefenseRow>(position => {
    const id = lineup.defense[String(position)] ?? null
    return {
      position,
      code: baseballFieldingPositionCode(position) ?? `Fielder ${position}`,
      id,
      name: id ? name(id) : null,
      doesNotBat: id !== null && !lineup.battingOrder.includes(id),
    }
  })

  const bench = setup.participants
    .filter(entry => !lineup.battingOrder.includes(entry.id) && !Object.values(lineup.defense).includes(entry.id))
    .map<BaseballBenchEntry>(entry => {
      const base = baseballBaseOf(sport, entry.id)
      if (base) {
        return { id: entry.id, name: name(entry.id), status: 'courtesy_runner', note: `On ${base} as a courtesy runner.` }
      }
      if (!lineup.removedIds.includes(entry.id)) {
        return { id: entry.id, name: name(entry.id), status: 'available', note: 'Available.' }
      }
      const slot = baseballOriginalSlot(sport, entry.id)
      const reentry = setup.rulesSnapshot.reentry
      if (reentry === 'unlimited') {
        return { id: entry.id, name: name(entry.id), status: 'may_reenter', note: 'Left the game; may re-enter.' }
      }
      if (reentry === 'starters_once' && baseballCanEnter(sport, entry.id, slot >= 0 ? slot : null)) {
        return {
          id: entry.id,
          name: name(entry.id),
          status: 'may_reenter',
          note: `Left the game; may re-enter once, in the ${baseballOrdinal(slot)} slot.`,
        }
      }
      return {
        id: entry.id,
        name: name(entry.id),
        status: 'out',
        note: lineup.reenteredIds.includes(entry.id) ? 'Out of the game; already re-entered once.' : 'Out of the game; cannot re-enter.',
      }
    })

  return {
    cards,
    defense,
    openPositions: defense.filter(row => row.id === null).map(row => row.code),
    bench,
  }
}

export function baseballOpponentLineupView(sport: BaseballSportGameState): BaseballOpponentLineupView {
  const { projection } = sport
  const lineup = projection.lineups.opponent
  const slots = lineup.battingOrder.map<BaseballOpponentLineupRow>((id, index) => {
    const detail = projection.opponentSlotDetails[id]
    return {
      slot: index + 1,
      id,
      name: baseballPersonLabel(sport, id).name,
      position: detail?.position ?? null,
      bats: detail?.bats ?? null,
      status: slotStatus(sport, 'opponent', index),
    }
  })
  const pitcherId = lineup.pitcherId || null
  const pitcher = pitcherId
    ? { id: pitcherId, name: baseballPersonLabel(sport, pitcherId).name, throws: projection.opponentPitchers[pitcherId]?.throws ?? null }
    : null
  return { slots, pitcher }
}

/** The current batter's hand for the pitch pad ("Bats L"), when it is known. */
export function baseballBatterHand(sport: BaseballSportGameState): BaseballBatHand | null {
  const id = sport.projection.status === 'in_progress' ? sport.projection.currentBatterId : null
  if (!id) return null
  const participant = sport.setup.participants.find(entry => entry.id === id)
  if (participant) return participant.bats
  return sport.projection.opponentSlotDetails[id]?.bats ?? null
}

export interface BaseballPlayerGameDetail {
  id: string
  name: string
  /** "Batting 2nd · C · Bats R, throws R", or the bench note. */
  role: string
  lines: string[]
}

/** A tracked player's game so far, read-only, for the Lineup tab (shared product decision). */
export function baseballPlayerGameDetail(sport: BaseballSportGameState, id: string): BaseballPlayerGameDetail | null {
  const participant = sport.setup.participants.find(entry => entry.id === id)
  if (!participant) return null
  const { projection } = sport
  const view = baseballTrackedLineupView(sport)
  const card = view.cards.find(entry => entry.id === id)
  const fielding = view.defense.find(entry => entry.id === id)
  const bench = view.bench.find(entry => entry.id === id)
  const hands = [participant.bats ? `Bats ${participant.bats}` : null, participant.throws ? `throws ${participant.throws}` : null]
    .filter(Boolean)
    .join(', ')
  const role = [
    card ? `Batting ${baseballOrdinal(card.slot - 1)}` : null,
    card ? card.position : fielding ? `${fielding.code}, does not bat` : bench?.note ?? null,
    hands || null,
  ].filter(Boolean).join(' · ')

  const lines: string[] = []
  const batting = projection.battingLines[id]
  if (batting && batting.pa > 0) {
    const extras = [
      batting.doubles ? `${batting.doubles} 2B` : null,
      batting.triples ? `${batting.triples} 3B` : null,
      batting.hr ? `${batting.hr} HR` : null,
      batting.rbi ? `${batting.rbi} RBI` : null,
      batting.r ? `${batting.r} R` : null,
      batting.bb ? `${batting.bb} BB` : null,
      batting.hbp ? `${batting.hbp} HBP` : null,
      batting.k ? `${batting.k} K` : null,
      batting.sb ? `${batting.sb} SB` : null,
    ].filter(Boolean)
    lines.push(`Batting: ${batting.h} for ${batting.ab}${extras.length ? `, ${extras.join(', ')}` : ''} (${batting.pa} PA)`)
  } else if (batting && (batting.r || batting.sb)) {
    lines.push(`Running: ${[batting.r ? `${batting.r} R` : null, batting.sb ? `${batting.sb} SB` : null].filter(Boolean).join(', ')}`)
  }
  const pitching = projection.pitchingLines[id]
  if (pitching && (pitching.bf > 0 || pitching.outs > 0 || pitching.pitches > 0)) {
    lines.push(
      `Pitching: ${Math.floor(pitching.outs / 3)}.${pitching.outs % 3} IP, ${pitching.pitches} pitches, ${pitching.h} H, ${pitching.r} R, ${pitching.er} ER, ${pitching.bb} BB, ${pitching.k} K`
    )
  }
  const field = projection.fieldingLines[id]
  if (field && (field.po || field.a || field.e)) {
    lines.push(`Fielding: ${field.po} PO, ${field.a} A, ${field.e} E`)
  }
  if (lines.length === 0) lines.push('No plays recorded yet.')
  return { id, name: baseballPersonLabel(sport, id).name, role, lines }
}
