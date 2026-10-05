import type { GameState } from '../../types'
import { baseballSportState } from './commands'
import type {
  BaseballBase,
  BaseballCapturePreferences,
  BaseballMatchRules,
  BaseballPitchResult,
  BaseballSportGameState,
  BaseballTeamSide,
} from './types'

/**
 * Read-only presentation models for the live Baseball tracker (BSB-3A). Everything is
 * derived from the projection and the frozen setup; nothing here writes events.
 */

export interface BaseballPersonLabel {
  id: string
  /** Full label, such as "#12 Garcia" or "#7 Lead-off". */
  name: string
  /** Up to four characters for chips and markers: the number, else initials. */
  short: string
}

export interface BaseballScoreboardSide {
  side: BaseballTeamSide
  name: string
  runs: number
}

export interface BaseballScoreboardView {
  away: BaseballScoreboardSide
  home: BaseballScoreboardSide
  /** "Top 3", or the status before and after play. */
  halfLabel: string
  balls: number
  strikes: number
  outs: number
  /** Dots to draw: one fewer than the count that ends the plate appearance or half. */
  ballDots: number
  strikeDots: number
  outDots: number
  /** The count and outs only mean something while play is live. */
  showCount: boolean
  pitcher: BaseballPitcherCount | null
}

export interface BaseballPitcherCount {
  label: string
  pitches: number
  /** Advisory only: the profile limit, or the highest warning threshold reached. */
  alert: { kind: 'limit' | 'warning'; threshold: number } | null
}

export interface BaseballLineScoreRow {
  side: BaseballTeamSide
  name: string
  /** Runs per inning; null when that half has not been played. */
  innings: Array<number | null>
  runs: number
  hits: number
  errors: number
}

export interface BaseballLineScoreView {
  innings: number[]
  away: BaseballLineScoreRow
  home: BaseballLineScoreRow
}

export interface BaseballDiamondView {
  batter: (BaseballPersonLabel & { slot: number }) | null
  runners: Record<BaseballBase, BaseballPersonLabel | null>
  fieldingSide: BaseballTeamSide
  fielders: Array<{ position: number; label: string; name: string | null }>
}

export interface BaseballTeamNames {
  tracked: string
  opponent: string
}

export function baseballPersonLabel(sport: BaseballSportGameState, id: string): BaseballPersonLabel {
  const participant = sport.setup.participants.find(entry => entry.id === id)
  if (participant) return label(id, participant.number, participant.displayName)
  const slot = sport.projection.opponentSlotDetails[id]
  if (slot) {
    const index = sport.setup.opponentSlots.findIndex(entry => entry.id === id)
    return label(id, slot.number, slot.label ?? `Batter ${index + 1}`)
  }
  const pitcher = sport.projection.opponentPitchers[id]
  if (pitcher) return label(id, pitcher.number, pitcher.label ?? 'Starting pitcher')
  return { id, name: 'Unknown player', short: '?' }
}

function label(id: string, number: string | null, name: string): BaseballPersonLabel {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0]!.toUpperCase())
    .join('')
    .slice(0, 3)
  return {
    id,
    name: number ? `#${number} ${name}` : name,
    short: (number ?? initials) || '?',
  }
}

function sideNames(sport: BaseballSportGameState, names: BaseballTeamNames) {
  const trackedHome = sport.setup.trackedSide === 'home'
  return {
    away: { side: (trackedHome ? 'opponent' : 'tracked') as BaseballTeamSide },
    home: { side: (trackedHome ? 'tracked' : 'opponent') as BaseballTeamSide },
    name: (side: BaseballTeamSide) => (side === 'tracked' ? names.tracked : names.opponent),
  }
}

export function baseballScoreboardView(sport: BaseballSportGameState, names: BaseballTeamNames): BaseballScoreboardView {
  const { projection, setup } = sport
  const rules = setup.rulesSnapshot
  const sides = sideNames(sport, names)
  const board = (side: BaseballTeamSide): BaseballScoreboardSide => ({
    side,
    name: sides.name(side),
    runs: projection.score[side],
  })
  return {
    away: board(sides.away.side),
    home: board(sides.home.side),
    halfLabel: halfLabel(sport),
    balls: projection.balls,
    strikes: projection.strikes,
    outs: projection.outs,
    ballDots: rules.ballsForWalk - 1,
    strikeDots: rules.strikesForStrikeout - 1,
    outDots: 2,
    showCount: projection.status === 'in_progress',
    pitcher: projection.status === 'pregame' ? null : pitcherCount(sport),
  }
}

function halfLabel(sport: BaseballSportGameState): string {
  const { projection } = sport
  switch (projection.status) {
    case 'pregame':
      return 'Pregame'
    case 'final':
      return 'Final'
    case 'suspended':
      return 'Suspended'
    case 'abandoned':
      return 'Abandoned'
    case 'in_progress':
      return `${projection.half === 'top' ? 'Top' : 'Bottom'} ${projection.inning}`
  }
}

function pitcherCount(sport: BaseballSportGameState): BaseballPitcherCount {
  const { projection, setup } = sport
  const fieldingSide: BaseballTeamSide = projection.battingSide === 'tracked' ? 'opponent' : 'tracked'
  const pitcherId = projection.lineups[fieldingSide].pitcherId
  const pitches = projection.pitchingLines[pitcherId]?.pitches ?? 0
  return { label: baseballPersonLabel(sport, pitcherId).name, pitches, alert: baseballPitchCountAlert(setup.rulesSnapshot, pitches) }
}

/** The profile limit, or the highest warning threshold a pitch total has reached (shared with the Summary, BSB-5C). */
export function baseballPitchCountAlert(
  rules: Pick<BaseballMatchRules, 'pitchCountLimit' | 'pitchCountWarnings'>,
  pitches: number
): BaseballPitcherCount['alert'] {
  if (rules.pitchCountLimit !== null && pitches >= rules.pitchCountLimit) {
    return { kind: 'limit', threshold: rules.pitchCountLimit }
  }
  const reached = rules.pitchCountWarnings.filter(threshold => pitches >= threshold)
  return reached.length > 0 ? { kind: 'warning', threshold: Math.max(...reached) } : null
}

export function baseballLineScoreView(sport: BaseballSportGameState, names: BaseballTeamNames): BaseballLineScoreView {
  const { projection, setup } = sport
  const sides = sideNames(sport, names)
  const played = projection.lineScore.reduce((most, line) => Math.max(most, line.inning), 0)
  const innings = Array.from({ length: Math.max(setup.rulesSnapshot.scheduledInnings, played) }, (_, index) => index + 1)
  const row = (side: BaseballTeamSide): BaseballLineScoreRow => {
    const batting = projection.lineScore.filter(line => line.battingSide === side)
    return {
      side,
      name: sides.name(side),
      innings: innings.map(inning => batting.find(line => line.inning === inning)?.runs ?? null),
      runs: projection.score[side],
      hits: batting.reduce((sum, line) => sum + line.hits, 0),
      // Errors a side commits are recorded on the halves the other side bats.
      errors: projection.lineScore
        .filter(line => line.battingSide !== side)
        .reduce((sum, line) => sum + line.errors, 0),
    }
  }
  return { innings, away: row(sides.away.side), home: row(sides.home.side) }
}

export function baseballDiamondView(sport: BaseballSportGameState): BaseballDiamondView {
  const { projection, setup } = sport
  const batterId = projection.status === 'in_progress' ? projection.currentBatterId : null
  const battingOrder = projection.lineups[projection.battingSide].battingOrder
  const runner = (base: BaseballBase) => {
    const entry = projection.bases[base]
    return entry ? baseballPersonLabel(sport, entry.runnerId) : null
  }
  const fieldingSide: BaseballTeamSide = projection.battingSide === 'tracked' ? 'opponent' : 'tracked'
  const positions = Array.from({ length: setup.rulesSnapshot.defensivePlayers }, (_, index) => index + 1)
  const defense = projection.lineups.tracked.defense
  return {
    batter: batterId
      ? { ...baseballPersonLabel(sport, batterId), slot: battingOrder.indexOf(batterId) + 1 }
      : null,
    runners: { first: runner('first'), second: runner('second'), third: runner('third') },
    fieldingSide,
    // The tracked defense shows player numbers; the opponent defense is not tracked, so
    // it shows position numbers only.
    fielders: positions.map(position => {
      if (fieldingSide === 'opponent') return { position, label: String(position), name: null }
      const id = defense[String(position)]
      if (!id) return { position, label: '–', name: null }
      const person = baseballPersonLabel(sport, id)
      return { position, label: person.short, name: person.name }
    }),
  }
}

/**
 * Updates the recorder's capture preferences. They are kept out of fingerprints and
 * events, like the Hockey rink flip.
 */
export function setBaseballCapturePreferences(
  state: GameState,
  patch: Partial<BaseballCapturePreferences>
): GameState {
  const sport = baseballSportState(state)
  if (!sport) return state
  const next = { ...sport.capturePreferences, ...patch }
  const current = sport.capturePreferences
  if ((Object.keys(next) as Array<keyof BaseballCapturePreferences>).every(key => next[key] === current[key])) {
    return state
  }
  return { ...state, sportGameState: { ...sport, capturePreferences: next } }
}

/** Pitch pad results: the main row, then the ones behind More. */
export const BASEBALL_PRIMARY_PITCH_RESULTS: ReadonlyArray<{ result: BaseballPitchResult; label: string }> = [
  { result: 'ball', label: 'Ball' },
  { result: 'called_strike', label: 'Called strike' },
  { result: 'swinging_strike', label: 'Swinging strike' },
  { result: 'foul', label: 'Foul' },
  { result: 'in_play', label: 'In play' },
  { result: 'hit_by_pitch', label: 'HBP' },
]

export const BASEBALL_MORE_PITCH_RESULTS: ReadonlyArray<{ result: BaseballPitchResult; label: string }> = [
  { result: 'foul_tip', label: 'Foul tip' },
  { result: 'foul_bunt', label: 'Foul bunt' },
  { result: 'missed_bunt', label: 'Missed bunt' },
  { result: 'intentional_ball', label: 'Intentional ball' },
  { result: 'pitchout', label: 'Pitchout' },
]
