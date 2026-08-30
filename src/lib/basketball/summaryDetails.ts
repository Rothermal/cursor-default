import type { GameState } from '../../types'
import type { GameEvent, GameEventInspection } from '../gameEvents/types'
import { basketballPeriodScoring } from './summary'
import { formatBasketballDurationMs } from './duration'
import { isBasketballMatchRulesV3 } from './rules'
import type {
  BasketballBonusStatus,
  BasketballMatchEvent,
  BasketballMatchProjection,
  BasketballProjectedParticipant,
  BasketballRoleHistoryEntry,
  BasketballStatTotals,
  BasketballTeamSide,
} from './types'

export interface BasketballReviewRate {
  numerator: number
  denominator: number
  value: number
}

export interface BasketballReviewStatLine {
  points: number
  fieldGoalsMade: number
  fieldGoalsAttempted: number
  twoPointMade: number
  twoPointAttempted: number
  threePointMade: number
  threePointAttempted: number
  freeThrowsMade: number
  freeThrowsAttempted: number
  offensiveRebounds: number
  defensiveRebounds: number
  rebounds: number
  assists: number
  steals: number
  blocks: number
  turnovers: number
  personalFouls: number
  manualMinutes: number
  fieldGoalPercentage: BasketballReviewRate | null
  twoPointPercentage: BasketballReviewRate | null
  threePointPercentage: BasketballReviewRate | null
  freeThrowPercentage: BasketballReviewRate | null
  effectiveFieldGoalPercentage: BasketballReviewRate | null
  trueShootingPercentage: BasketballReviewRate | null
  assistToTurnoverRatio: BasketballReviewRate | null
}

export interface BasketballPlayerReviewRow {
  participantId: string
  playerId: string | null
  displayName: string
  number: string | null
  teamSide: BasketballTeamSide
  rosterStatus: 'starter' | 'bench' | 'dnp'
  position: string | null
  captain: boolean
  lateAdded: boolean
  disqualified: boolean
  ejected: boolean
  stats: BasketballStatTotals
  line: BasketballReviewStatLine
  participation: BasketballParticipationReview
  roleHistory: BasketballRoleHistoryReview[]
}

export interface BasketballParticipationReview {
  basis: 'interval_derived' | 'recorded_manual'
  started: boolean
  appeared: boolean | null
  dnp: boolean | null
  participationMs: number
  displayTime: string
  complete: boolean
  stintCount: number
  intervals: BasketballParticipationIntervalReview[]
  plusMinus: number | null
  plusMinusUnavailableReason: string | null
  qualityReason: string | null
}

export interface BasketballParticipationIntervalReview {
  periodId: string
  periodLabel: string
  startElapsedMs: number
  endElapsedMs: number
  durationMs: number
  displayDuration: string
}

export interface BasketballRoleHistoryReview {
  eventId: string
  periodId: string
  periodLabel: string
  elapsedMs: number
  position: string | null
  captain: boolean
}

export interface BasketballPlayerReview {
  tracked: BasketballPlayerReviewRow[]
  opponent: BasketballPlayerReviewRow[]
}

export interface BasketballTeamPeriodReview {
  periodId: string
  label: string
  order: number
  score: Record<BasketballTeamSide, number>
  fouls: Record<BasketballTeamSide, number>
  bonus: Record<BasketballTeamSide, BasketballBonusStatus>
  chargedTimeouts: Record<BasketballTeamSide, number>
}

export interface BasketballTeamAttributionReview {
  participant: Record<BasketballTeamSide, BasketballReviewStatLine>
  unattributed: Record<BasketballTeamSide, BasketballReviewStatLine>
  technicalFouls: Record<BasketballTeamSide, number>
}

export interface BasketballEjectionReview {
  eventId: string
  teamSide: BasketballTeamSide
  subjectLabel: string
  reason: string
  source: 'official_ruling' | 'automatic_threshold'
}

export interface BasketballTeamReview {
  totals: Record<BasketballTeamSide, BasketballReviewStatLine>
  periods: BasketballTeamPeriodReview[]
  attribution: BasketballTeamAttributionReview
  neutralTimeouts: number
  ejections: BasketballEjectionReview[]
  lineups: Record<BasketballTeamSide, BasketballLineupReviewRow[]>
}

export interface BasketballLineupReviewRow {
  key: string
  teamSide: BasketballTeamSide
  participantIds: string[]
  participantLabels: string[]
  participationMs: number
  displayTime: string
  plusMinus: number | null
  plusMinusUnavailableReason: string | null
  complete: boolean
}

export interface BasketballSummaryQualityReview {
  clockModel: 'clockless' | 'anchored'
  clockRunning: boolean
  currentPeriodLabel: string | null
  tracked: BasketballLineupQualitySide | null
  opponent: BasketballLineupQualitySide | null
  equalPlayCompliant: boolean | null
  enforcedOverridesComplete: boolean | null
  warnings: string[]
}

export interface BasketballLineupQualitySide {
  complete: boolean
  incompletePeriodLabels: string[]
  replacementParticipantLabels: string[]
  boundaryConfirmationRequired: boolean
  plusMinusComplete: boolean
  plusMinusUnavailableReason: string | null
}

const STAT_IDS: Array<keyof BasketballStatTotals> = [
  'ft', 'ft_miss', '2pt', '2pt_miss', '3pt', '3pt_miss',
  'oreb', 'dreb', 'ast', 'stl', 'blk', 'to', 'pf', 'min',
]

export function basketballPlayerReview(
  state: GameState,
  inspection: GameEventInspection<GameEvent>
): BasketballPlayerReview {
  const sportState = requireBasketballState(state)
  const setupOrder = new Map(
    sportState.setup.participants.map((participant, index) => [participant.id, index])
  )
  const lateOrder = new Map<string, number>()
  for (const event of basketballEvents(inspection)) {
    if (event.eventType !== 'basketball.match_roster_added') continue
    if (!lateOrder.has(event.payload.participant.id)) {
      lateOrder.set(event.payload.participant.id, lateOrder.size)
    }
  }
  const rows = Object.values(sportState.projection.participants)
    .map(participant => playerReviewRow(participant, sportState.projection))
    .sort((left, right) => comparePlayers(left, right, setupOrder, lateOrder))
  return {
    tracked: rows.filter(row => row.teamSide === 'tracked'),
    opponent: rows.filter(row => row.teamSide === 'opponent'),
  }
}

export function basketballTeamReview(
  state: GameState,
  inspection: GameEventInspection<GameEvent>
): BasketballTeamReview {
  const sportState = requireBasketballState(state)
  const projection = sportState.projection
  const events = basketballEvents(inspection)
  const periodScores = basketballPeriodScoring(projection, events)
  const scoreByPeriod = new Map(periodScores.map(period => [period.periodId, period]))
  const participantStats = {
    tracked: emptyStats(),
    opponent: emptyStats(),
  }
  for (const participant of Object.values(projection.participants)) {
    addStats(participantStats[participant.teamSide], participant.stats)
  }
  const unattributedStats = {
    tracked: subtractStats(projection.sideStats.tracked, participantStats.tracked),
    opponent: subtractStats(projection.sideStats.opponent, participantStats.opponent),
  }

  return {
    totals: {
      tracked: basketballReviewStatLine(projection.sideStats.tracked),
      opponent: basketballReviewStatLine(projection.sideStats.opponent),
    },
    periods: projection.periods.map(period => {
      const score = scoreByPeriod.get(period.id)
      return {
        periodId: period.id,
        label: period.label,
        order: period.order,
        score: {
          tracked: score?.tracked ?? 0,
          opponent: score?.opponent ?? 0,
        },
        fouls: projection.periodTeamFouls[period.id] ?? { tracked: 0, opponent: 0 },
        bonus: projection.bonusStatusByPeriod[period.id] ?? {
          tracked: 'none', opponent: 'none',
        },
        chargedTimeouts: projection.periodTimeouts[period.id] ?? {
          tracked: 0, opponent: 0,
        },
      }
    }),
    attribution: {
      participant: {
        tracked: basketballReviewStatLine(participantStats.tracked),
        opponent: basketballReviewStatLine(participantStats.opponent),
      },
      unattributed: {
        tracked: basketballReviewStatLine(unattributedStats.tracked),
        opponent: basketballReviewStatLine(unattributedStats.opponent),
      },
      technicalFouls: {
        tracked: projection.teamActorStats.tracked.team_tech,
        opponent: projection.teamActorStats.opponent.team_tech,
      },
    },
    neutralTimeouts: projection.neutralTimeouts,
    ejections: projection.ejections.map(ejection => ({
      eventId: ejection.eventId,
      teamSide: ejection.teamSide,
      subjectLabel: ejectionSubjectLabel(
        ejection.subject,
        projection.participants
      ),
      reason: ejection.reason,
      source: ejection.source,
    })),
    lineups: {
      tracked: lineupReviewRows(projection, 'tracked'),
      opponent: lineupReviewRows(projection, 'opponent'),
    },
  }
}

export function basketballSummaryQualityReview(
  state: GameState
): BasketballSummaryQualityReview {
  const sportState = requireBasketballState(state)
  const projection = sportState.projection
  const anchored = Boolean(
    isBasketballMatchRulesV3(sportState.setup.rulesSnapshot) &&
    sportState.setup.rulesSnapshot.clockModel === 'anchored' &&
    projection.clock &&
    projection.lineup
  )
  if (!anchored || !projection.lineup) {
    return {
      clockModel: 'clockless',
      clockRunning: false,
      currentPeriodLabel: projection.periods.find(period =>
        period.id === projection.currentPeriodId
      )?.label ?? null,
      tracked: null,
      opponent: null,
      equalPlayCompliant: null,
      enforcedOverridesComplete: null,
      warnings: [],
    }
  }
  const tracked = lineupQualitySide(projection, 'tracked')
  const opponent = lineupQualitySide(projection, 'opponent')
  const warnings = [
    ...lineupQualityWarnings('Tracked', tracked),
    ...lineupQualityWarnings('Opponent', opponent),
  ]
  if (!projection.lineup.enforcedOverridesComplete) {
    warnings.push('An enforced equal-play override is incomplete.')
  }
  return {
    clockModel: 'anchored',
    clockRunning: projection.clock?.running === true,
    currentPeriodLabel: projection.periods.find(period =>
      period.id === projection.currentPeriodId
    )?.label ?? null,
    tracked,
    opponent,
    equalPlayCompliant: projection.lineup.equalPlayCompliant,
    enforcedOverridesComplete: projection.lineup.enforcedOverridesComplete,
    warnings: [...new Set(warnings)],
  }
}

export function basketballReviewStatLine(
  stats: BasketballStatTotals
): BasketballReviewStatLine {
  const twoPointAttempted = stats['2pt'] + stats['2pt_miss']
  const threePointAttempted = stats['3pt'] + stats['3pt_miss']
  const fieldGoalsMade = stats['2pt'] + stats['3pt']
  const fieldGoalsAttempted = twoPointAttempted + threePointAttempted
  const freeThrowsAttempted = stats.ft + stats.ft_miss
  const points = stats.ft + stats['2pt'] * 2 + stats['3pt'] * 3
  return {
    points,
    fieldGoalsMade,
    fieldGoalsAttempted,
    twoPointMade: stats['2pt'],
    twoPointAttempted,
    threePointMade: stats['3pt'],
    threePointAttempted,
    freeThrowsMade: stats.ft,
    freeThrowsAttempted,
    offensiveRebounds: stats.oreb,
    defensiveRebounds: stats.dreb,
    rebounds: stats.oreb + stats.dreb,
    assists: stats.ast,
    steals: stats.stl,
    blocks: stats.blk,
    turnovers: stats.to,
    personalFouls: stats.pf,
    manualMinutes: stats.min,
    fieldGoalPercentage: reviewRate(fieldGoalsMade, fieldGoalsAttempted),
    twoPointPercentage: reviewRate(stats['2pt'], twoPointAttempted),
    threePointPercentage: reviewRate(stats['3pt'], threePointAttempted),
    freeThrowPercentage: reviewRate(stats.ft, freeThrowsAttempted),
    effectiveFieldGoalPercentage: reviewRate(
      fieldGoalsMade + 0.5 * stats['3pt'],
      fieldGoalsAttempted
    ),
    trueShootingPercentage: reviewRate(
      points,
      2 * (fieldGoalsAttempted + 0.44 * freeThrowsAttempted)
    ),
    assistToTurnoverRatio: reviewRate(stats.ast, stats.to),
  }
}

export function formatBasketballPercentage(rate: BasketballReviewRate | null): string {
  return rate ? `${Math.round(rate.value * 100)}%` : '-'
}

export function formatBasketballRatio(rate: BasketballReviewRate | null): string {
  return rate ? rate.value.toFixed(2) : '-'
}

function playerReviewRow(
  participant: BasketballProjectedParticipant,
  projection: BasketballMatchProjection
): BasketballPlayerReviewRow {
  const side = projection.lineup?.sides[participant.teamSide] ?? null
  const participation = side?.participationByParticipantId[participant.participantId] ?? null
  const periods = new Map(projection.periods.map(period => [period.id, period.label]))
  return {
    participantId: participant.participantId,
    playerId: participant.playerId,
    displayName: participant.displayName,
    number: participant.number,
    teamSide: participant.teamSide,
    rosterStatus: participant.openingStatus,
    position: participant.position,
    captain: participant.captain,
    lateAdded: participant.lateAdded,
    disqualified: participant.disqualified,
    ejected: participant.ejected,
    stats: structuredClone(participant.stats),
    line: basketballReviewStatLine(participant.stats),
    participation: participation
      ? {
          basis: 'interval_derived',
          started: participation.started,
          appeared: participation.appeared,
          dnp: !participation.appeared,
          participationMs: participation.participationMs,
          displayTime: formatBasketballDurationMs(participation.participationMs),
          complete: participation.complete,
          stintCount: participation.intervals.length,
          intervals: participation.intervals.map(interval => ({
            periodId: interval.periodId,
            periodLabel: periods.get(interval.periodId) ?? interval.periodId,
            startElapsedMs: interval.startElapsedMs,
            endElapsedMs: interval.endElapsedMs,
            durationMs: interval.durationMs,
            displayDuration: formatBasketballDurationMs(interval.durationMs),
          })),
          plusMinus: participation.plusMinus,
          plusMinusUnavailableReason: participation.plusMinus === null
            ? participation.appeared
              ? side?.plusMinusUnavailableReason ?? 'Plus-minus authority is incomplete.'
              : 'Player did not appear.'
            : null,
          qualityReason: participation.complete
            ? null
            : 'Playing time is incomplete because lineup history has a recovery gap.',
        }
      : {
          basis: 'recorded_manual',
          started: participant.openingStatus === 'starter',
          appeared: null,
          dnp: null,
          participationMs: Math.max(0, participant.stats.min) * 60_000,
          displayTime: formatBasketballDurationMs(Math.max(0, participant.stats.min) * 60_000),
          complete: true,
          stintCount: 0,
          intervals: [],
          plusMinus: null,
          plusMinusUnavailableReason: 'Plus-minus requires anchored lineup authority.',
          qualityReason: null,
        },
    roleHistory: (side?.roleHistoryByParticipantId[participant.participantId] ?? [])
      .map(entry => roleHistoryReview(entry, periods)),
  }
}

function roleHistoryReview(
  entry: BasketballRoleHistoryEntry,
  periods: Map<string, string>
): BasketballRoleHistoryReview {
  return {
    eventId: entry.eventId,
    periodId: entry.periodId,
    periodLabel: periods.get(entry.periodId) ?? entry.periodId,
    elapsedMs: entry.elapsedMs,
    position: entry.position,
    captain: entry.captain,
  }
}

function lineupReviewRows(
  projection: BasketballMatchProjection,
  teamSide: BasketballTeamSide
): BasketballLineupReviewRow[] {
  const side = projection.lineup?.sides[teamSide]
  if (!side) return []
  return side.lineupCombinations.map(combination => ({
    key: [...combination.participantIds].sort().join(':'),
    teamSide,
    participantIds: [...combination.participantIds],
    participantLabels: combination.participantIds.map(participantId => {
      const participant = projection.participants[participantId]
      return participant
        ? `${participant.number ? `#${participant.number} ` : ''}${participant.displayName}`
        : 'Unknown participant'
    }),
    participationMs: combination.participationMs,
    displayTime: formatBasketballDurationMs(combination.participationMs),
    plusMinus: combination.plusMinus,
    plusMinusUnavailableReason: combination.plusMinus === null
      ? side.plusMinusUnavailableReason ?? 'Lineup plus-minus authority is incomplete.'
      : null,
    complete: combination.complete,
  }))
}

function lineupQualitySide(
  projection: BasketballMatchProjection,
  teamSide: BasketballTeamSide
): BasketballLineupQualitySide | null {
  const side = projection.lineup?.sides[teamSide]
  if (!side) return null
  return {
    complete: side.incompletePeriodIds.length === 0 &&
      side.replacementRequiredParticipantIds.length === 0,
    incompletePeriodLabels: side.incompletePeriodIds.map(periodId =>
      projection.periods.find(period => period.id === periodId)?.label ?? periodId
    ),
    replacementParticipantLabels: side.replacementRequiredParticipantIds.map(participantId =>
      projection.participants[participantId]?.displayName ?? 'Unknown participant'
    ),
    boundaryConfirmationRequired: side.boundaryConfirmationRequired,
    plusMinusComplete: side.plusMinusComplete,
    plusMinusUnavailableReason: side.plusMinusUnavailableReason,
  }
}

function lineupQualityWarnings(
  label: string,
  side: BasketballLineupQualitySide | null
): string[] {
  if (!side) return []
  const warnings: string[] = []
  if (side.incompletePeriodLabels.length > 0) {
    warnings.push(`${label} lineup history is incomplete in ${side.incompletePeriodLabels.join(', ')}.`)
  }
  if (side.replacementParticipantLabels.length > 0) {
    warnings.push(`${label} lineup still requires a replacement for ${side.replacementParticipantLabels.join(', ')}.`)
  }
  if (side.boundaryConfirmationRequired) warnings.push(`${label} lineup requires boundary review.`)
  if (!side.plusMinusComplete && side.plusMinusUnavailableReason) {
    warnings.push(side.plusMinusUnavailableReason)
  }
  return warnings
}

function comparePlayers(
  left: BasketballPlayerReviewRow,
  right: BasketballPlayerReviewRow,
  setupOrder: Map<string, number>,
  lateOrder: Map<string, number>
): number {
  const setupFallback = Number.MAX_SAFE_INTEGER
  const leftSetup = setupOrder.get(left.participantId) ?? setupFallback
  const rightSetup = setupOrder.get(right.participantId) ?? setupFallback
  if (leftSetup !== rightSetup) return leftSetup - rightSetup
  const lateFallback = Number.MAX_SAFE_INTEGER
  const leftLate = lateOrder.get(left.participantId) ?? lateFallback
  const rightLate = lateOrder.get(right.participantId) ?? lateFallback
  return leftLate - rightLate ||
    left.displayName.localeCompare(right.displayName) ||
    left.participantId.localeCompare(right.participantId)
}

function basketballEvents(
  inspection: GameEventInspection<GameEvent>
): BasketballMatchEvent[] {
  return inspection.activeEvents.filter(
    (event): event is BasketballMatchEvent => event.sportId === 'basketball'
  )
}

function reviewRate(numerator: number, denominator: number): BasketballReviewRate | null {
  if (denominator <= 0) return null
  return { numerator, denominator, value: numerator / denominator }
}

function emptyStats(): BasketballStatTotals {
  return {
    ft: 0, ft_miss: 0, '2pt': 0, '2pt_miss': 0, '3pt': 0, '3pt_miss': 0,
    oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0, min: 0,
  }
}

function addStats(target: BasketballStatTotals, source: BasketballStatTotals): void {
  for (const statId of STAT_IDS) target[statId] += source[statId]
}

function subtractStats(
  total: BasketballStatTotals,
  participant: BasketballStatTotals
): BasketballStatTotals {
  const result = emptyStats()
  for (const statId of STAT_IDS) {
    result[statId] = Math.max(0, total[statId] - participant[statId])
  }
  return result
}

function requireBasketballState(state: GameState) {
  if (state.sportGameState?.sportId !== 'basketball') {
    throw new Error('Basketball summary detail requires a Basketball projection.')
  }
  return state.sportGameState
}

function ejectionSubjectLabel(
  subject: { participantId?: string; label?: string; kind: string },
  participants: Record<string, BasketballProjectedParticipant>
): string {
  if (subject.participantId && participants[subject.participantId]) {
    return participants[subject.participantId].displayName
  }
  return subject.label?.trim() || (subject.kind === 'staff' ? 'Staff member' : 'Team member')
}
