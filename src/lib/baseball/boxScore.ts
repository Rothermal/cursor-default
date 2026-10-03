import type { GameEvent } from '../gameEvents/types'
import { baseballFieldingPositionCode } from './positions'
import { emptyBattingLine, emptyFieldingLine, emptyPitchingLine, replayBaseballLineupHistory } from './projector'
import { formatInningsPitched } from './stats'
import { baseballPersonLabel } from './trackerView'
import type {
  BaseballBattingLine,
  BaseballFieldingLine,
  BaseballPitchingLine,
  BaseballSportGameState,
  BaseballTeamSide,
} from './types'

/**
 * Box score rows for the Baseball Summary (BSB-5A). Totals come straight from the replayed
 * projection; the lineup history only decides order, indentation and positions.
 */

export interface BaseballBoxBattingRow {
  id: string
  name: string
  /** "C", "PH-LF", "DH"; the opponent's recorded position, or "". */
  position: string
  /** Entered after the start, shown indented under the slot's starter. */
  substitute: boolean
  /** True for our players, whose game detail can open. */
  tracked: boolean
  line: BaseballBattingLine
}

export interface BaseballBoxNote {
  label: string
  /** "Lee, Kim 2" */
  text: string
}

export interface BaseballBoxBatting {
  side: BaseballTeamSide
  rows: BaseballBoxBattingRow[]
  totals: Pick<BaseballBattingLine, 'ab' | 'r' | 'h' | 'rbi' | 'bb' | 'k'>
  notes: BaseballBoxNote[]
  leftOnBase: number
}

export interface BaseballBoxPitchingRow {
  id: string
  name: string
  tracked: boolean
  ip: string
  line: BaseballPitchingLine
  /** The pitch total includes plate appearances recorded without every pitch, so it is a lower bound. */
  pitchesLowerBound: boolean
}

export interface BaseballBoxPitching {
  side: BaseballTeamSide
  rows: BaseballBoxPitchingRow[]
  totals: { ip: string; h: number; r: number; er: number; bb: number; k: number; hr: number; pitches: number; strikes: number }
  pitchesLowerBound: boolean
  /** "HR: Garcia", "HBP: ...", "WP: ..." under the table. */
  notes: BaseballBoxNote[]
}

export interface BaseballBoxFieldingRow {
  id: string
  name: string
  position: string
  line: BaseballFieldingLine
}

export interface BaseballBoxFielding {
  rows: BaseballBoxFieldingRow[]
  totals: Pick<BaseballFieldingLine, 'po' | 'a' | 'e'>
  notes: BaseballBoxNote[]
}

export interface BaseballBoxScore {
  batting: Record<BaseballTeamSide, BaseballBoxBatting>
  pitching: Record<BaseballTeamSide, BaseballBoxPitching>
  fielding: BaseballBoxFielding
}

export function baseballBoxScore(sport: BaseballSportGameState, events: readonly GameEvent[]): BaseballBoxScore {
  const history = replayBaseballLineupHistory(sport.setup, events)
  const trackedBatting = trackedBattingRows(sport, history.trackedSlots, history.trackedPositions)
  return {
    batting: {
      tracked: batting(sport, 'tracked', trackedBatting),
      opponent: batting(sport, 'opponent', opponentBattingRows(sport)),
    },
    pitching: {
      tracked: pitching(sport, 'tracked', history.pitchers.tracked),
      opponent: pitching(sport, 'opponent', history.pitchers.opponent),
    },
    fielding: fielding(sport, trackedBatting.map(row => row.id), history.pitchers.tracked, history.trackedPositions),
  }
}

function positionCodes(numbers: readonly number[] | undefined): string {
  return (numbers ?? []).map(number => baseballFieldingPositionCode(number) ?? String(number)).join('-')
}

function trackedBattingRows(
  sport: BaseballSportGameState,
  slots: readonly string[][],
  positions: Record<string, number[]>
): BaseballBoxBattingRow[] {
  const { projection, setup } = sport
  const starters = new Set(projection.lineups.tracked.starterIds)
  const nonFieldingStarter = setup.rulesSnapshot.battingOrderFormat === 'designated_hitter' ? 'DH' : 'EH'
  const rows: BaseballBoxBattingRow[] = []
  const listed = new Set<string>()
  const add = (id: string, substitute: boolean, fallback: string) => {
    listed.add(id)
    const line = projection.battingLines[id] ?? emptyBattingLine()
    rows.push({
      id,
      name: baseballPersonLabel(sport, id).name,
      position: positionCodes(positions[id]) || fallback,
      substitute,
      tracked: true,
      line,
    })
  }
  for (const occupants of slots) {
    occupants.forEach((id, index) => {
      if (listed.has(id)) return
      const substitute = index > 0 || !starters.has(id)
      const line = projection.battingLines[id]
      add(id, substitute, substitute ? (line && line.pa > 0 ? 'PH' : 'PR') : nonFieldingStarter)
    })
  }
  // Courtesy runners score without holding a slot; they still belong in the box score.
  for (const participant of setup.participants) {
    const line = projection.battingLines[participant.id]
    if (listed.has(participant.id) || !line || !Object.values(line).some(value => value !== 0)) continue
    add(participant.id, true, 'CR')
  }
  return rows
}

function opponentBattingRows(sport: BaseballSportGameState): BaseballBoxBattingRow[] {
  const { projection, setup } = sport
  return setup.opponentSlots.map(slot => ({
    id: slot.id,
    name: baseballPersonLabel(sport, slot.id).name,
    position: projection.opponentSlotDetails[slot.id]?.position ?? '',
    substitute: false,
    tracked: false,
    line: projection.battingLines[slot.id] ?? emptyBattingLine(),
  }))
}

const BATTING_NOTES: ReadonlyArray<{ label: string; key: keyof BaseballBattingLine }> = [
  { label: '2B', key: 'doubles' },
  { label: '3B', key: 'triples' },
  { label: 'HR', key: 'hr' },
  { label: 'SB', key: 'sb' },
  { label: 'CS', key: 'cs' },
  { label: 'SF', key: 'sf' },
  { label: 'SAC', key: 'sh' },
  { label: 'HBP', key: 'hbp' },
]

function noteText(entries: Array<{ name: string; count: number }>): string {
  return entries.map(entry => (entry.count > 1 ? `${entry.name} ${entry.count}` : entry.name)).join(', ')
}

function batting(sport: BaseballSportGameState, side: BaseballTeamSide, rows: BaseballBoxBattingRow[]): BaseballBoxBatting {
  const sum = (key: keyof BaseballBattingLine) => rows.reduce((total, row) => total + row.line[key], 0)
  const notes = BATTING_NOTES.flatMap(({ label, key }) => {
    const entries = rows.filter(row => row.line[key] > 0).map(row => ({ name: row.name, count: row.line[key] }))
    return entries.length > 0 ? [{ label, text: noteText(entries) }] : []
  })
  return {
    side,
    rows,
    totals: { ab: sum('ab'), r: sum('r'), h: sum('h'), rbi: sum('rbi'), bb: sum('bb'), k: sum('k') },
    notes,
    leftOnBase: sport.projection.lineScore
      .filter(line => line.battingSide === side)
      .reduce((total, line) => total + line.leftOnBase, 0),
  }
}

function pitching(sport: BaseballSportGameState, side: BaseballTeamSide, order: readonly string[]): BaseballBoxPitching {
  const { projection } = sport
  const lines = Object.values(projection.pitchingLines).filter(line => line.side === side)
  const pitched = (line: BaseballPitchingLine) => line.bf > 0 || line.outs > 0 || line.pitches > 0
  // Mound order from the replay; anyone the replay missed keeps projection order after them.
  const ids = [...order, ...lines.map(line => line.pitcherId).filter(id => !order.includes(id))]
  let shown = ids.filter(id => projection.pitchingLines[id] && pitched(projection.pitchingLines[id]))
  if (shown.length === 0 && ids[0]) shown = [ids[0]]
  const rows = shown.map(id => {
    const line = projection.pitchingLines[id] ?? emptyPitchingLine(id, side)
    return {
      id,
      name: baseballPersonLabel(sport, id).name,
      tracked: side === 'tracked',
      ip: formatInningsPitched(line.outs),
      line,
      pitchesLowerBound: line.untrackedPlateAppearances > 0,
    }
  })
  const sum = (key: keyof Omit<BaseballPitchingLine, 'pitcherId' | 'side'>) =>
    rows.reduce((total, row) => total + row.line[key], 0)
  return {
    side,
    rows,
    totals: {
      ip: formatInningsPitched(sum('outs')),
      h: sum('h'),
      r: sum('r'),
      er: sum('er'),
      bb: sum('bb'),
      k: sum('k'),
      hr: sum('hr'),
      pitches: sum('pitches'),
      strikes: sum('strikes'),
    },
    pitchesLowerBound: rows.some(row => row.pitchesLowerBound),
    notes: PITCHING_NOTES.flatMap(({ label, key }) => {
      const entries = rows.filter(row => row.line[key] > 0).map(row => ({ name: row.name, count: row.line[key] }))
      return entries.length > 0 ? [{ label, text: noteText(entries) }] : []
    }),
  }
}

const PITCHING_NOTES: ReadonlyArray<{ label: string; key: 'hr' | 'hbp' | 'wp' | 'bk' }> = [
  { label: 'HR', key: 'hr' },
  { label: 'HBP', key: 'hbp' },
  { label: 'WP', key: 'wp' },
  { label: 'BK', key: 'bk' },
]

const FIELDING_NOTES: ReadonlyArray<{ label: string; key: keyof BaseballFieldingLine }> = [
  { label: 'DP', key: 'dp' },
  { label: 'PB', key: 'pb' },
  { label: 'SB allowed', key: 'sbAllowed' },
  { label: 'CS', key: 'cs' },
]

function fielding(
  sport: BaseballSportGameState,
  battingOrder: readonly string[],
  pitchers: readonly string[],
  positions: Record<string, number[]>
): BaseballBoxFielding {
  const { projection, setup } = sport
  const tracked = new Set(setup.participants.map(participant => participant.id))
  const candidates = [...battingOrder, ...pitchers, ...Object.keys(positions), ...Object.keys(projection.fieldingLines)]
  const ids = candidates.filter(
    (id, index) => tracked.has(id) && candidates.indexOf(id) === index && (positions[id]?.length || projection.fieldingLines[id])
  )
  const rows = ids.map(id => ({
    id,
    name: baseballPersonLabel(sport, id).name,
    position: positionCodes(positions[id]),
    line: projection.fieldingLines[id] ?? emptyFieldingLine(),
  }))
  const sum = (key: keyof BaseballFieldingLine) => rows.reduce((total, row) => total + row.line[key], 0)
  const notes = FIELDING_NOTES.flatMap(({ label, key }) => {
    const entries = rows.filter(row => row.line[key] > 0).map(row => ({ name: row.name, count: row.line[key] }))
    return entries.length > 0 ? [{ label, text: noteText(entries) }] : []
  })
  return { rows, totals: { po: sum('po'), a: sum('a'), e: sum('e') }, notes }
}
