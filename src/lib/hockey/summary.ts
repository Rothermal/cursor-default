import type { GameState } from '../../types'
import { hockeyOpponentGoalieLabel, hockeyParticipantLabel } from './captureCommands'
import { hockeyGoalStrengthLabel, type HockeyGameLines, type HockeyGoalStrengthLabel } from './gameLines'
import { formatHockeyClock } from './live'
import { hockeyPenaltyBoxAt, hockeyPenaltyLabel, hockeyCurrentGameTimeMs } from './penalties'
import { formatHockeyPeriod } from './periods'
import { formatHockeyFinalScore, HOCKEY_RESULT_LABELS } from './shootout'
import type {
  HockeyEvent,
  HockeyMatchParticipant,
  HockeyMatchProjection,
  HockeyMatchSetup,
  HockeySide,
  HockeySportGameState,
} from './types'
import type { GameEvent } from '../gameEvents/types'

/**
 * Read-only Summary models for a Hockey event game (HKY-6A1). Everything is derived from a
 * fresh replay of the selected source; nothing here writes events.
 */

export type HockeySummaryTab = 'overview' | 'skaters' | 'goalies'

export const HOCKEY_SUMMARY_TABS: ReadonlyArray<{ tab: HockeySummaryTab; label: string }> = [
  { tab: 'overview', label: 'Overview' },
  { tab: 'skaters', label: 'Skaters' },
  { tab: 'goalies', label: 'Goalies' },
]

export type HockeySummaryFrom = 'tracker' | 'sport' | 'games' | 'game-info'

export interface HockeySummaryQuery {
  gameId: string | null
  tab: HockeySummaryTab
  from: HockeySummaryFrom | null
  teamId: string | null
}

/**
 * Hockey event games open the Hockey Summary: a cloud game by `gameId` with `sport=hockey`,
 * otherwise the active local event game. Stat-grid Hockey games keep the generic Summary.
 */
export function isHockeySummaryRoute(
  state: Pick<GameState, 'gameDataAuthority' | 'sport' | 'sportGameState'>,
  params: URLSearchParams
): boolean {
  if (params.get('gameId')) return params.get('sport') === 'hockey'
  return state.gameDataAuthority === 'sport_events' && state.sport?.id === 'hockey' && state.sportGameState?.sportId === 'hockey'
}

export function parseHockeySummaryQuery(params: URLSearchParams): HockeySummaryQuery {
  const tab = params.get('tab')
  const from = params.get('from')
  return {
    gameId: params.get('gameId') || null,
    tab: HOCKEY_SUMMARY_TABS.some(entry => entry.tab === tab) ? (tab as HockeySummaryTab) : 'overview',
    from: from === 'tracker' || from === 'sport' || from === 'games' || from === 'game-info' ? from : null,
    teamId: params.get('teamId') || null,
  }
}

export function hockeySummaryPath(options: Partial<HockeySummaryQuery> = {}): string {
  const params = new URLSearchParams({ sport: 'hockey' })
  if (options.gameId) params.set('gameId', options.gameId)
  params.set('tab', options.tab ?? 'overview')
  if (options.from) params.set('from', options.from)
  if (options.teamId) params.set('teamId', options.teamId)
  return `/summary?${params.toString()}`
}

export function hockeySummaryBackPath(query: HockeySummaryQuery): string {
  switch (query.from) {
    case 'tracker':
      return '/game'
    case 'games':
      return '/games?sport=hockey'
    case 'game-info': {
      if (!query.gameId) return '/sport/hockey'
      const params = new URLSearchParams({ gameId: query.gameId })
      if (query.teamId) params.set('teamId', query.teamId)
      return `/game-info?${params.toString()}`
    }
    default:
      return '/sport/hockey'
  }
}

// ---------------------------------------------------------------------------
// Result

export interface HockeySummaryResult {
  /** `3-2`, `3-2 (OT)`, `3-2 (SO)`, or the running score. */
  scoreText: string
  /** Win, Loss, Tie, In progress, Suspended, Abandoned or Not started. */
  label: string
  /** The reason recorded with a suspension, abandonment or an early end. */
  reason: string | null
}

export function hockeySummaryResult(projection: HockeyMatchProjection): HockeySummaryResult {
  const running = `${projection.score.tracked}-${projection.score.opponent}`
  switch (projection.status) {
    case 'ended':
      return {
        scoreText: projection.result ? formatHockeyFinalScore(projection.result) : running,
        label: projection.result ? HOCKEY_RESULT_LABELS[projection.result.outcome] : 'Ended',
        reason: projection.statusReason,
      }
    case 'suspended':
      return { scoreText: running, label: 'Suspended', reason: projection.statusReason }
    case 'abandoned':
      return { scoreText: running, label: 'Abandoned', reason: projection.statusReason }
    case 'in_progress':
      return { scoreText: running, label: 'In progress', reason: null }
    default:
      return { scoreText: running, label: 'Not started', reason: null }
  }
}

// ---------------------------------------------------------------------------
// Overview

export interface HockeyPeriodRow {
  periodId: string
  label: string
  goals: Record<HockeySide, number>
  shotsOnGoal: Record<HockeySide, number>
}

/** Goals and shots on goal by period, with a total row. */
export function hockeyPeriodRows(projection: HockeyMatchProjection): { periods: HockeyPeriodRow[]; total: HockeyPeriodRow } {
  const periods = projection.periods.map(period => {
    const totals = projection.periodTotals[period.id]
    return {
      periodId: period.id,
      label: formatHockeyPeriod(period),
      goals: { ...(totals?.goals ?? { tracked: 0, opponent: 0 }) },
      shotsOnGoal: { ...(totals?.shotsOnGoal ?? { tracked: 0, opponent: 0 }) },
    }
  })
  return {
    periods,
    total: {
      periodId: 'total',
      label: 'Total',
      goals: { ...projection.score },
      shotsOnGoal: { ...projection.shotsOnGoal },
    },
  }
}

export interface HockeyTeamStatRow {
  label: string
  values: Record<HockeySide, string>
  /** Why a value is shown without its ratio. */
  note?: string
}

/** Both sides' team totals. Power plays need the clock; a clockless game shows goals only. */
export function hockeyTeamStatRows(
  sport: HockeySportGameState,
  events: readonly GameEvent[]
): HockeyTeamStatRow[] {
  const { setup, projection } = sport
  const both = (value: (side: HockeySide) => string): Record<HockeySide, string> => ({
    tracked: value('tracked'),
    opponent: value('opponent'),
  })
  const other = (side: HockeySide): HockeySide => (side === 'tracked' ? 'opponent' : 'tracked')
  const ppGoals = (side: HockeySide) => projection.goalsByStrength[side].pp
  const chances = powerPlayOpportunities(setup, projection)
  const blocks = { tracked: 0, opponent: 0 }
  for (const event of events) {
    if (event.eventType !== 'hockey.shot') continue
    const shot = event as HockeyEvent<'hockey.shot'>
    if (shot.payload.outcome === 'blocked') blocks[other(shot.teamSide)] += 1
  }
  const faceoffs = (side: HockeySide) => {
    const won = side === 'tracked' ? projection.faceoffs.won : projection.faceoffs.lost
    const lost = side === 'tracked' ? projection.faceoffs.lost : projection.faceoffs.won
    return won + lost === 0 ? '0-0' : `${won}-${lost} (${percent(won, won + lost)})`
  }
  // Confirmed goal strength is kept as recorded (HKY-0), so a power-play goal can exceed the
  // chances the recorded penalties give. Then the ratio is not known: the goals stay shown.
  const ratioKnown = (side: HockeySide) => chances !== null && ppGoals(side) <= chances[side]
  const incompleteNote = 'More power-play goals than recorded power plays, so chances are incomplete.'
  const rows: HockeyTeamStatRow[] = [
    { label: 'Shots on goal', values: both(side => String(projection.shotsOnGoal[side])) },
  ]
  if (chances) {
    const complete = ratioKnown('tracked') && ratioKnown('opponent')
    rows.push({
      label: 'Power play',
      values: both(side => (ratioKnown(side) ? `${ppGoals(side)}/${chances[side]}` : `${ppGoals(side)} PPG`)),
      ...(complete ? {} : { note: incompleteNote }),
    })
    rows.push({
      label: 'Penalty kill',
      values: both(side => {
        const against = chances[other(side)]
        return ratioKnown(other(side)) ? `${against - ppGoals(other(side))}/${against}` : '–'
      }),
      ...(complete ? {} : { note: incompleteNote }),
    })
  } else {
    rows.push({ label: 'Power-play goals', values: both(side => String(ppGoals(side))) })
  }
  rows.push(
    { label: 'Short-handed goals', values: both(side => String(projection.goalsByStrength[side].sh)) },
    { label: 'Faceoffs', values: both(faceoffs) },
    { label: 'Hits', values: both(side => String(projection.hits[side])) },
    { label: 'Blocked shots', values: both(side => String(blocks[side])) },
    { label: 'Takeaways', values: both(side => String(projection.takeaways[side])) },
    { label: 'Giveaways', values: both(side => String(projection.giveaways[side])) },
    { label: 'Penalty minutes', values: both(side => formatMinutes(projection.penaltyTotals[side].pimMs)) },
    { label: 'Icing', values: both(side => String(projection.icings[side])) },
    { label: 'Offside', values: both(side => String(projection.offsides[side])) },
    { label: 'Timeouts', values: both(side => String(projection.timeouts[side])) },
  )
  return rows
}

/** Power-play opportunities over the whole game, from the penalty box at its last recorded time. */
function powerPlayOpportunities(setup: HockeyMatchSetup, projection: HockeyMatchProjection): Record<HockeySide, number> | null {
  if (!projection.clock) return null
  const latest = Math.max(
    hockeyCurrentGameTimeMs(projection, null) ?? 0,
    ...projection.penalties.map(record => record.gameTimeMs ?? 0),
    ...projection.penaltyReleases.map(record => record.gameTimeMs),
    ...projection.powerPlayGoals.map(record => record.gameTimeMs)
  )
  return hockeyPenaltyBoxAt(setup, projection, latest).powerPlayOpportunities
}

export interface HockeyNames {
  tracked: string
  opponent: string
}

export interface HockeyScoringRow {
  eventId: string
  period: string
  /** Time in the period (`12:34`), anchored games only. */
  time: string | null
  side: HockeySide
  team: string
  scorer: string
  assists: string[]
  strength: HockeyGoalStrengthLabel
  score: string
  gameWinning: boolean
}

export function hockeyScoringRows(sport: HockeySportGameState, lines: HockeyGameLines, names: HockeyNames): HockeyScoringRow[] {
  const { setup, projection } = sport
  return lines.goals.map(goal => ({
    eventId: goal.eventId,
    period: periodLabel(projection, goal.periodId),
    time: goal.elapsedMs === null ? null : formatHockeyClock(goal.elapsedMs),
    side: goal.side,
    team: names[goal.side],
    scorer: goal.side === 'tracked'
      ? participantName(setup, goal.shooterParticipantId) ?? 'Unattributed'
      : goal.shooterLabel ?? 'Unattributed',
    assists: goal.assists.map(assist =>
      (goal.side === 'tracked' ? participantName(setup, assist.participantId) : null) ?? assist.label ?? 'Unknown'),
    strength: hockeyGoalStrengthLabel(goal),
    score: `${goal.scoreAfter.tracked}-${goal.scoreAfter.opponent}`,
    gameWinning: goal.gameWinning,
  }))
}

export interface HockeyPenaltyRow {
  eventId: string
  period: string
  time: string | null
  side: HockeySide
  team: string
  player: string
  /** `minor, tripping (2 min)`. */
  penalty: string
  servedBy: string | null
}

export function hockeyPenaltyRows(sport: HockeySportGameState, names: HockeyNames): HockeyPenaltyRow[] {
  const { setup, projection } = sport
  return projection.penalties.map(record => {
    const offender = record.side === 'tracked'
      ? participantName(setup, record.offenderParticipantId) ?? record.offenderLabel
      : record.offenderLabel
    const server = record.side === 'tracked'
      ? participantName(setup, record.serverParticipantId) ?? record.serverLabel
      : record.serverLabel
    return {
      eventId: record.eventId,
      period: periodLabel(projection, record.periodId),
      time: record.elapsedMs === null ? null : formatHockeyClock(record.elapsedMs),
      side: record.side,
      team: names[record.side],
      player: offender ?? (record.offenderKind === 'bench' ? 'Bench' : record.offenderKind === 'staff' ? 'Staff' : 'Unknown'),
      penalty: hockeyPenaltyLabel(record),
      servedBy: server ?? null,
    }
  })
}

export interface HockeyDecisionSummary {
  goalie: string
  /** W, L, OTL or T. */
  decision: string
}

/** The tracked goalie credited with the decision, from the per-game lines. */
export function hockeyDecisionSummary(sport: HockeySportGameState, lines: HockeyGameLines): HockeyDecisionSummary | null {
  for (const participant of sport.setup.participants) {
    const decision = goalieDecision(lines.participants[participant.id])
    if (decision) return { goalie: hockeyParticipantLabel(participant), decision }
  }
  return null
}

// ---------------------------------------------------------------------------
// Skaters and goalies

export interface HockeySkaterRow {
  participantId: string
  name: string
  position: string | null
  removed: boolean
  goals: number
  assists: number
  points: number
  plusMinus: number
  pim: string
  shotsOnGoal: number
  shotAttempts: number
  faceoffs: string
  faceoffPercent: string | null
  hits: number
  blocks: number
  takeaways: number
  giveaways: number
  powerPlayPoints: number
  shortHandedPoints: number
  gameWinningGoals: number
  emptyNetGoals: number
}

/** Dressed tracked skaters in roster order: jersey number, then name. */
export function hockeySkaterRows(sport: HockeySportGameState, lines: HockeyGameLines): HockeySkaterRow[] {
  return rosterOrder(sport.setup.participants.filter(participant => participant.dressedAs === 'skater')).map(participant => {
    const line = lines.participants[participant.id] ?? {}
    const stat = (id: string) => line[id] ?? 0
    const won = stat('hky_fow')
    const lost = stat('hky_fol')
    return {
      participantId: participant.id,
      name: hockeyParticipantLabel(participant),
      position: participant.position,
      removed: sport.projection.removedParticipantIds.includes(participant.id),
      goals: stat('hky_g'),
      assists: stat('hky_a'),
      points: stat('hky_pts'),
      plusMinus: stat('hky_pm'),
      pim: formatMinutes(stat('hky_pim') * 60_000),
      shotsOnGoal: stat('hky_sog'),
      shotAttempts: stat('hky_sat'),
      faceoffs: `${won}-${lost}`,
      faceoffPercent: won + lost === 0 ? null : percent(won, won + lost),
      hits: stat('hky_hit'),
      blocks: stat('hky_blk'),
      takeaways: stat('hky_tk'),
      giveaways: stat('hky_gv'),
      powerPlayPoints: stat('hky_ppg') + stat('hky_ppa'),
      shortHandedPoints: stat('hky_shg') + stat('hky_sha'),
      gameWinningGoals: stat('hky_gwg'),
      emptyNetGoals: stat('hky_eng'),
    }
  })
}

export interface HockeyGoalieRow {
  id: string
  side: HockeySide
  name: string
  played: boolean
  shotsAgainst: number
  saves: number
  goalsAgainst: number
  savePercent: string | null
  decision: string | null
  /** `null` when the game has no clock: time in net is not recorded. */
  timeInNet: string | null
  timeInNetComplete: boolean
  /** Goals against per regulation-length game; only with complete time in net. */
  goalsAgainstAverage: string | null
}

/**
 * Tracked goalies (every dressed goalie, so a backup who never played shows no GP) and the
 * opponent goalies who were in net, as team context from the tracked side's shots.
 */
export function hockeyGoalieRows(
  sport: HockeySportGameState,
  lines: HockeyGameLines,
  events: readonly GameEvent[]
): HockeyGoalieRow[] {
  const { setup, projection } = sport
  const regulationMs = setup.rulesSnapshot.regulation.periods * setup.rulesSnapshot.regulation.periodLengthMs
  const timeFields = (id: string, goalsAgainst: number) => {
    const time = lines.goalieTime?.[id] ?? null
    if (!lines.goalieTime) return { timeInNet: null, timeInNetComplete: false, goalsAgainstAverage: null }
    const ms = time?.ms ?? 0
    const complete = time ? time.coverage === 'complete' : true
    return {
      timeInNet: formatHockeyClock(ms),
      timeInNetComplete: complete,
      goalsAgainstAverage: complete && ms > 0 ? (goalsAgainst * regulationMs / ms).toFixed(2) : null,
    }
  }
  const tracked = rosterOrder(setup.participants.filter(participant => participant.dressedAs === 'goalie')).map(participant => {
    const line = lines.participants[participant.id] ?? {}
    const shotsAgainst = line.hky_sa ?? 0
    const saves = line.hky_sv ?? 0
    const goalsAgainst = line.hky_ga ?? 0
    return {
      id: participant.id,
      side: 'tracked' as const,
      name: hockeyParticipantLabel(participant),
      played: (line.hky_gp ?? 0) > 0,
      shotsAgainst,
      saves,
      goalsAgainst,
      savePercent: shotsAgainst === 0 ? null : savePercent(saves, shotsAgainst),
      decision: goalieDecision(line),
      ...timeFields(participant.id, goalsAgainst),
    }
  })

  const faced: Record<string, { shotsAgainst: number; saves: number; goalsAgainst: number }> = {}
  for (const event of events) {
    if (event.eventType !== 'hockey.shot' || event.teamSide !== 'tracked') continue
    const shot = event as HockeyEvent<'hockey.shot'>
    if (shot.payload.emptyNet || (shot.payload.outcome !== 'goal' && shot.payload.outcome !== 'saved')) continue
    const goalieId = shot.actors.find(entry => entry.role === 'goalie')?.participantId
    if (!goalieId) continue
    const totals = faced[goalieId] ?? { shotsAgainst: 0, saves: 0, goalsAgainst: 0 }
    totals.shotsAgainst += 1
    if (shot.payload.outcome === 'saved') totals.saves += 1
    else totals.goalsAgainst += 1
    faced[goalieId] = totals
  }
  const opponentIds = [...lines.goaliesInNet.opponent, ...Object.keys(faced).filter(id => !lines.goaliesInNet.opponent.includes(id))]
  const opponent = opponentIds.map(id => {
    const goalie = projection.opponentGoalies.find(entry => entry.id === id)
    const totals = faced[id] ?? { shotsAgainst: 0, saves: 0, goalsAgainst: 0 }
    return {
      id,
      side: 'opponent' as const,
      name: goalie ? hockeyOpponentGoalieLabel(goalie) : 'Opponent goalie',
      played: true,
      ...totals,
      savePercent: totals.shotsAgainst === 0 ? null : savePercent(totals.saves, totals.shotsAgainst),
      decision: null,
      ...timeFields(id, totals.goalsAgainst),
    }
  })
  return [...tracked, ...opponent]
}

// ---------------------------------------------------------------------------
// Helpers

export function hockeySummaryNames(state: Pick<GameState, 'gameInfo'>, setup: HockeyMatchSetup): HockeyNames {
  return {
    tracked: state.gameInfo?.teamName || 'Tracked',
    opponent: state.gameInfo?.opponentName || setup.opponentName || 'Opponent',
  }
}

function goalieDecision(line: Record<string, number> | undefined): string | null {
  if (!line) return null
  if (line.hky_w) return 'W'
  if (line.hky_l) return 'L'
  if (line.hky_otl) return 'OTL'
  if (line.hky_t) return 'T'
  return null
}

function rosterOrder(participants: HockeyMatchParticipant[]): HockeyMatchParticipant[] {
  const jersey = (participant: HockeyMatchParticipant) => {
    const value = participant.number === null ? NaN : Number(participant.number)
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
  }
  return [...participants].sort((a, b) =>
    jersey(a) - jersey(b) || a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id))
}

function participantName(setup: HockeyMatchSetup, participantId: string | null): string | null {
  if (!participantId) return null
  const participant = setup.participants.find(entry => entry.id === participantId)
  return participant ? hockeyParticipantLabel(participant) : null
}

function periodLabel(projection: HockeyMatchProjection, periodId: string): string {
  const period = projection.periods.find(entry => entry.id === periodId)
  return period ? formatHockeyPeriod(period) : periodId
}

function percent(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`
}

/** `.917`, or `1.000` for a perfect game. */
function savePercent(saves: number, shots: number): string {
  const value = (saves / shots).toFixed(3)
  return value.startsWith('0') ? value.slice(1) : value
}

function formatMinutes(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds % 60 === 0) return String(seconds / 60)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
