import type { GameState } from '../../types'
import type { GameEvent, GameEventInspection } from '../gameEvents/types'
import { soccerPeriodTimings, type SoccerPeriodTiming } from './live'
import { participantActiveMs } from './state'
import type {
  SoccerParticipantStatTotals,
  SoccerProjectedParticipant,
  SoccerRole,
} from './types'

export type SoccerPlayerCategory =
  | 'attack'
  | 'defense'
  | 'discipline'
  | 'goalkeeping'

export type SoccerPlayerReviewSide = 'tracked' | 'opponent'

export type SoccerLineupStatus = 'starter' | 'substitute' | 'dnp'

export type SoccerCleanSheetStatus =
  | 'credited'
  | 'shared'
  | 'denied'
  | 'provisional'
  | 'unavailable'
  | 'not_applicable'

export interface SoccerReviewRate {
  numerator: number
  denominator: number
  value: number
}

export interface SoccerReviewInterval {
  periodId: string
  periodLabel: string
  startElapsedMs: number
  endElapsedMs: number
  startLabel: string
  endLabel: string
  durationMs: number
}

export interface SoccerReviewRoleInterval extends SoccerReviewInterval {
  role: SoccerRole
}

export interface SoccerPlayerCleanSheet {
  status: SoccerCleanSheetStatus
  label: string
}

export interface SoccerTeamCleanSheet {
  status: Exclude<SoccerCleanSheetStatus, 'shared' | 'not_applicable'>
  label: string
}

export interface SoccerPlayerReviewRow {
  participantId: string
  playerId: string | null
  displayName: string
  number: string | null
  role: SoccerRole
  lineupStatus: SoccerLineupStatus
  appearances: number
  minutesMs: number
  stats: SoccerParticipantStatTotals
  rates: {
    shotAccuracy: SoccerReviewRate | null
    goalConversion: SoccerReviewRate | null
    tackleWin: SoccerReviewRate | null
    savePercentage: SoccerReviewRate | null
  }
  onFieldIntervals: SoccerReviewInterval[]
  roleIntervals: SoccerReviewRoleInterval[]
  cleanSheet: SoccerPlayerCleanSheet
}

export interface SoccerPlayerReview {
  tracked: {
    rows: SoccerPlayerReviewRow[]
    cleanSheet: SoccerTeamCleanSheet
  }
  opponent: {
    rows: []
    completeParticipantData: false
    cleanSheet: SoccerTeamCleanSheet
  }
}

interface GoalkeeperCleanSheetContext {
  candidates: Set<string>
  conceded: Set<string>
  unavailable: boolean
}

export function soccerPlayerReview(
  state: GameState,
  inspection: GameEventInspection<GameEvent>,
  nowMs = Date.now()
): SoccerPlayerReview {
  const sportState = state.sportGameState
  if (!sportState || sportState.sportId !== 'soccer') {
    throw new Error('Soccer player review requires a soccer match projection.')
  }

  const projection = sportState.projection
  const participants = Object.values(projection.participants)
  const timingById = new Map(
    soccerPeriodTimings(state, nowMs).map(timing => [timing.period.id, timing])
  )
  const cleanSheets = goalkeeperCleanSheetContext(participants, inspection)
  const completed = projection.status === 'ended' && projection.endReason === 'completed'
  const noFinalCredit =
    projection.status === 'suspended' ||
    projection.endReason === 'abandoned'
  const cleanQualifiers = completed && !cleanSheets.unavailable
    ? [...cleanSheets.candidates].filter(id => !cleanSheets.conceded.has(id))
    : []
  const rows = participants
    .map(participant => playerReviewRow(
      state,
      participant,
      projection.participantStats[participant.participantId] ?? emptyStats(),
      cleanSheets,
      cleanQualifiers.length,
      completed,
      noFinalCredit,
      timingById,
      nowMs
    ))
    .sort((left, right) => comparePlayerRows(left, right, state, inspection))

  return {
    tracked: {
      rows,
      cleanSheet: teamCleanSheet(
        projection.sideTotals.opponent.score,
        projection.status,
        projection.endReason
      ),
    },
    opponent: {
      rows: [],
      completeParticipantData: false,
      cleanSheet: teamCleanSheet(
        projection.sideTotals.tracked.score,
        projection.status,
        projection.endReason
      ),
    },
  }
}

export function soccerReviewRate(
  numerator: number,
  denominator: number
): SoccerReviewRate | null {
  if (denominator <= 0) return null
  return {
    numerator,
    denominator,
    value: numerator / denominator,
  }
}

export function formatSoccerReviewRate(rate: SoccerReviewRate | null): string {
  if (!rate) return '-'
  return `${Math.round(rate.value * 100)}% (${rate.numerator}/${rate.denominator})`
}

export function formatSoccerReviewDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function playerReviewRow(
  state: GameState,
  participant: SoccerProjectedParticipant,
  stats: SoccerParticipantStatTotals,
  cleanSheets: GoalkeeperCleanSheetContext,
  qualifierCount: number,
  completed: boolean,
  noFinalCredit: boolean,
  timingById: Map<string, SoccerPeriodTiming>,
  nowMs: number
): SoccerPlayerReviewRow {
  const currentElapsedMs = state.sportGameState?.sportId === 'soccer'
    ? participantActiveMs(participant, state.sportGameState.projection, nowMs)
    : participant.totalActiveMs
  const intervalBoundary = (periodId: string, startElapsedMs: number, endElapsedMs: number | null) => {
    if (endElapsedMs !== null) return endElapsedMs
    const timing = timingById.get(periodId)
    return Math.max(startElapsedMs, timing?.endElapsedMs ?? startElapsedMs)
  }
  const onFieldIntervals = participant.onFieldIntervals.map(interval =>
    reviewInterval(
      interval.periodId,
      interval.startElapsedMs,
      intervalBoundary(interval.periodId, interval.startElapsedMs, interval.endElapsedMs),
      timingById
    )
  )
  const roleIntervals = participant.roleIntervals.map(interval => ({
    ...reviewInterval(
      interval.periodId,
      interval.startElapsedMs,
      intervalBoundary(interval.periodId, interval.startElapsedMs, interval.endElapsedMs),
      timingById
    ),
    role: structuredClone(interval.role),
  }))
  const lineupStatus: SoccerLineupStatus = participant.appearances === 0
    ? 'dnp'
    : participant.started
      ? 'starter'
      : 'substitute'

  return {
    participantId: participant.participantId,
    playerId: participant.playerId,
    displayName: participant.displayName,
    number: participant.number,
    role: structuredClone(participant.role),
    lineupStatus,
    appearances: participant.appearances,
    minutesMs: currentElapsedMs,
    stats: structuredClone(stats),
    rates: {
      shotAccuracy: soccerReviewRate(stats.shotsOnTarget, stats.shots),
      goalConversion: soccerReviewRate(stats.goals, stats.shots),
      tackleWin: soccerReviewRate(stats.tacklesWon, stats.tacklesAttempted),
      savePercentage: soccerReviewRate(
        stats.goalkeeperSaves,
        stats.goalkeeperShotsOnTargetFaced
      ),
    },
    onFieldIntervals,
    roleIntervals,
    cleanSheet: playerCleanSheet(
      participant.participantId,
      cleanSheets,
      qualifierCount,
      completed,
      noFinalCredit
    ),
  }
}

function reviewInterval(
  periodId: string,
  startElapsedMs: number,
  endElapsedMs: number,
  timingById: Map<string, SoccerPeriodTiming>
): SoccerReviewInterval {
  const timing = timingById.get(periodId)
  const periodStart = timing?.startElapsedMs ?? 0
  const end = Math.max(startElapsedMs, endElapsedMs)
  return {
    periodId,
    periodLabel: timing?.label ?? periodId,
    startElapsedMs,
    endElapsedMs: end,
    startLabel: formatSoccerReviewDuration(Math.max(0, startElapsedMs - periodStart)),
    endLabel: formatSoccerReviewDuration(Math.max(0, end - periodStart)),
    durationMs: end - startElapsedMs,
  }
}

function comparePlayerRows(
  left: SoccerPlayerReviewRow,
  right: SoccerPlayerReviewRow,
  state: GameState,
  inspection: GameEventInspection<GameEvent>
): number {
  const rank = (row: SoccerPlayerReviewRow) =>
    row.lineupStatus === 'starter' ? 0 : row.lineupStatus === 'substitute' ? 1 : 2
  const rankDifference = rank(left) - rank(right)
  if (rankDifference !== 0) return rankDifference

  const openingOrder = openingLineupOrder(inspection)
  const setupOrder = new Map(
    (state.sportGameState?.sportId === 'soccer'
      ? state.sportGameState.setup.participants
      : []
    ).map((participant, index) => [participant.id, index])
  )
  if (left.lineupStatus === 'starter') {
    const orderDifference =
      orderOf(openingOrder, left.participantId) -
      orderOf(openingOrder, right.participantId)
    if (orderDifference !== 0) return orderDifference
  }
  if (left.lineupStatus === 'substitute') {
    const projection = state.sportGameState?.sportId === 'soccer'
      ? state.sportGameState.projection
      : null
    const leftStart = firstAppearance(
      projection?.participants[left.participantId]
    )
    const rightStart = firstAppearance(
      projection?.participants[right.participantId]
    )
    if (leftStart !== rightStart) return leftStart - rightStart
  }
  const setupDifference =
    orderOf(setupOrder, left.participantId) -
    orderOf(setupOrder, right.participantId)
  if (setupDifference !== 0) return setupDifference
  return left.displayName.localeCompare(right.displayName) ||
    left.participantId.localeCompare(right.participantId)
}

function openingLineupOrder(
  inspection: GameEventInspection<GameEvent>
): Map<string, number> {
  const lineup = inspection.activeEvents.find(
    event => event.eventType === 'soccer.opening_lineup_recorded'
  )
  const starters = Array.isArray(
    (lineup?.payload as { starters?: unknown } | undefined)?.starters
  )
    ? (lineup!.payload as { starters: unknown[] }).starters
    : []
  const ids = starters.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const participantId = (item as { participantId?: unknown }).participantId
    return typeof participantId === 'string' ? [participantId] : []
  })
  return new Map(ids.map((id, index) => [id, index]))
}

function firstAppearance(participant: SoccerProjectedParticipant | undefined): number {
  if (!participant || participant.onFieldIntervals.length === 0) {
    return Number.MAX_SAFE_INTEGER
  }
  return Math.min(...participant.onFieldIntervals.map(interval => interval.startElapsedMs))
}

function orderOf(order: Map<string, number>, id: string): number {
  return order.get(id) ?? Number.MAX_SAFE_INTEGER
}

function goalkeeperCleanSheetContext(
  participants: SoccerProjectedParticipant[],
  inspection: GameEventInspection<GameEvent>
): GoalkeeperCleanSheetContext {
  const candidates = new Set(
    participants
      .filter(participant =>
        participant.appearances > 0 &&
        participant.roleIntervals.some(interval => interval.role.group === 'goalkeeper')
      )
      .map(participant => participant.participantId)
  )
  const conceded = new Set<string>()
  let unavailable = inspection.activeEvents.some(event =>
    event.eventType === 'soccer.score_adjustment' &&
    event.teamSide === 'opponent'
  )

  for (const event of inspection.activeEvents) {
    if (!isTrackedConcession(event)) continue
    const linkedGoalkeeper = event.actors.find(actor =>
      actor.role === 'goalkeeper' &&
      typeof actor.participantId === 'string' &&
      candidates.has(actor.participantId)
    )?.participantId
    if (linkedGoalkeeper) {
      conceded.add(linkedGoalkeeper)
      continue
    }

    const overlapping = participants
      .filter(participant => candidates.has(participant.participantId))
      .filter(participant => participant.roleIntervals.some(interval =>
        interval.role.group === 'goalkeeper' &&
        interval.periodId === event.period.id &&
        event.elapsedMs !== null &&
        interval.startElapsedMs <= event.elapsedMs &&
        (interval.endElapsedMs === null || event.elapsedMs <= interval.endElapsedMs)
      ))
      .map(participant => participant.participantId)
    if (overlapping.length === 0) {
      unavailable = true
    } else {
      overlapping.forEach(id => conceded.add(id))
    }
  }

  return { candidates, conceded, unavailable }
}

function isTrackedConcession(event: GameEvent): boolean {
  if (event.teamSide !== 'opponent') return false
  if (event.eventType === 'soccer.own_goal') return true
  return event.eventType === 'soccer.shot' &&
    (event.payload as { outcome?: unknown }).outcome === 'goal'
}

function playerCleanSheet(
  participantId: string,
  context: GoalkeeperCleanSheetContext,
  qualifierCount: number,
  completed: boolean,
  noFinalCredit: boolean
): SoccerPlayerCleanSheet {
  if (!context.candidates.has(participantId)) {
    return { status: 'not_applicable', label: 'Not applicable' }
  }
  if (context.unavailable) {
    return {
      status: 'unavailable',
      label: 'Unavailable - score or goalkeeper attribution needs review',
    }
  }
  if (context.conceded.has(participantId)) {
    return { status: 'denied', label: 'Goal conceded while in goal' }
  }
  if (noFinalCredit) {
    return { status: 'unavailable', label: 'No final clean-sheet credit' }
  }
  if (!completed) {
    return { status: 'provisional', label: 'Currently no goals conceded' }
  }
  if (qualifierCount > 1) {
    return { status: 'shared', label: 'Shared clean sheet' }
  }
  return { status: 'credited', label: 'Clean sheet' }
}

function teamCleanSheet(
  goalsConceded: number,
  status: 'not_started' | 'in_progress' | 'period_break' | 'shootout' | 'suspended' | 'ended',
  endReason: 'completed' | 'abandoned' | null
): SoccerTeamCleanSheet {
  if (status === 'ended' && endReason === 'completed') {
    return goalsConceded === 0
      ? { status: 'credited', label: 'Clean sheet' }
      : { status: 'denied', label: `${goalsConceded} conceded` }
  }
  if (status === 'suspended' || endReason === 'abandoned') {
    return { status: 'unavailable', label: 'No final clean-sheet credit' }
  }
  return goalsConceded === 0
    ? { status: 'provisional', label: 'Currently no goals conceded' }
    : { status: 'denied', label: `${goalsConceded} conceded` }
}

function emptyStats(): SoccerParticipantStatTotals {
  return {
    goals: 0,
    ownGoals: 0,
    primaryAssists: 0,
    secondaryAssists: 0,
    shots: 0,
    shotsOnTarget: 0,
    keyPasses: 0,
    penaltyAttempts: 0,
    penaltyGoals: 0,
    directFreeKickAttempts: 0,
    directFreeKickGoals: 0,
    goalkeeperSaves: 0,
    goalkeeperGoalsAllowed: 0,
    goalkeeperShotsOnTargetFaced: 0,
    goalkeeperPenaltiesFaced: 0,
    goalkeeperPenaltySaves: 0,
    tacklesAttempted: 0,
    tacklesWon: 0,
    tacklesLost: 0,
    interceptions: 0,
    clearances: 0,
    recoveries: 0,
    blockedShots: 0,
    foulsCommitted: 0,
    foulsDrawn: 0,
    yellowCards: 0,
    redCards: 0,
  }
}
