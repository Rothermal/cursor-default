import type { GameEvent, JsonObject } from '../gameEvents/types'

export const BASKETBALL_GAME_STATE_VERSION = 1
export const BASKETBALL_EVENT_SCHEMA_VERSION = 1

export type BasketballTeamSide = 'tracked' | 'opponent'
export type BasketballTrackedTeamDesignation = 'home' | 'away' | 'neutral'
export type BasketballRosterStatus = 'starter' | 'bench' | 'dnp'
export type BasketballSegmentKind = 'regulation' | 'overtime'
export type BasketballClockModel = 'none' | 'anchored'
export type BasketballMatchStatus =
  | 'not_started'
  | 'in_progress'
  | 'period_break'
  | 'suspended'
  | 'ended'
export type BasketballMatchEndReason = 'completed' | 'suspended' | 'abandoned'
export type BasketballMatchResult =
  | 'tracked_win'
  | 'opponent_win'
  | 'draw'
  | 'suspended'
  | 'abandoned'
  | 'unresolved'

export interface BasketballMatchSegment extends JsonObject {
  id: string
  label: string
  kind: BasketballSegmentKind
  order: number
  durationMs: number
}

export interface BasketballOvertimeTemplate extends JsonObject {
  idPrefix: string
  label: string
  durationMs: number
}

export interface BasketballMatchRules extends JsonObject {
  periodsPerGame: number
  periodLabels: string[]
  regulationSegments: BasketballMatchSegment[]
  overtimeTemplate: BasketballOvertimeTemplate
  bonusThreshold: number
  doubleBonusThreshold: number
  hasOneAndOne: boolean
  overtimeLabel: string
  overtimeFoulsReset: boolean
  timeoutsPerPeriod: number | null
  timeoutsPerOvertime: number | null
  clockModel: BasketballClockModel
}

export interface BasketballRulesSource extends JsonObject {
  profileId: string
  profileVersion: number
  personalRevision: number | null
  teamRevision: number | null
  hasExplicitMatchOverrides: boolean
}

export interface BasketballMatchParticipant extends JsonObject {
  id: string
  playerId: string | null
  displayName: string
  number: string | null
  teamSide: BasketballTeamSide
  initialStatus: BasketballRosterStatus
  position: string | null
  captain: boolean
}

export interface BasketballMatchSetup {
  version: 1
  trackedTeamDesignation: BasketballTrackedTeamDesignation
  sourceTeamId: string | null
  sourceSeasonId: string | null
  rulesSource: BasketballRulesSource
  rulesSnapshot: BasketballMatchRules
  participants: BasketballMatchParticipant[]
}

export interface BasketballProjectedParticipant {
  participantId: string
  playerId: string | null
  displayName: string
  number: string | null
  teamSide: BasketballTeamSide
  openingStatus: BasketballRosterStatus
  position: string | null
  captain: boolean
  lateAdded: boolean
  stats: BasketballStatTotals
}

export type BasketballStatId =
  | 'ft'
  | 'ft_miss'
  | '2pt'
  | '2pt_miss'
  | '3pt'
  | '3pt_miss'
  | 'oreb'
  | 'dreb'
  | 'ast'
  | 'stl'
  | 'blk'
  | 'to'
  | 'pf'
  | 'min'

export type BasketballStatTotals = Record<BasketballStatId, number>
export type BasketballTeamStatTotals = BasketballStatTotals & {
  team_turnover: number
}

export interface BasketballRelationshipWarning {
  eventId: string
  relatedEventId: string
  message: string
}

export interface BasketballScoreProjection {
  tracked: number
  opponent: number
}

export interface BasketballMatchProjection {
  status: BasketballMatchStatus
  currentPeriodId: string | null
  periods: BasketballMatchSegment[]
  startedPeriodIds: string[]
  completedPeriodIds: string[]
  participants: Record<string, BasketballProjectedParticipant>
  sideStats: Record<BasketballTeamSide, BasketballStatTotals>
  teamActorStats: Record<BasketballTeamSide, BasketballTeamStatTotals>
  score: BasketballScoreProjection
  relationshipWarnings: BasketballRelationshipWarning[]
  endedAt: string | null
  endReason: BasketballMatchEndReason | null
  result: BasketballMatchResult
}

export interface BasketballCapturePreferences {
  teamSide: BasketballTeamSide
  selectedParticipantId: string | null
  selectionInitialized: boolean
  shotValueOverride: 2 | 3 | null
  courtOrientation: 'standard' | 'flipped'
}

export interface BasketballSportGameState {
  sportId: 'basketball'
  version: typeof BASKETBALL_GAME_STATE_VERSION
  setup: BasketballMatchSetup
  projection: BasketballMatchProjection
  capturePreferences: BasketballCapturePreferences
}

export interface BasketballCapturePayload extends JsonObject {
  captureCommandId: string | null
}

export interface BasketballPeriodPayload extends BasketballCapturePayload {
  periodId: string
}

export interface BasketballMatchRosterAddedPayload extends BasketballCapturePayload {
  participant: BasketballMatchParticipant
  destination: 'bench' | 'dnp'
}

export interface BasketballParticipantResolvedPayload extends BasketballCapturePayload {
  participantId: string
  playerId: string
  displayName: string
  number: string | null
}

export interface BasketballMatchEndedPayload extends BasketballCapturePayload {
  reason: BasketballMatchEndReason
}

export interface BasketballMatchReopenedPayload extends BasketballCapturePayload {
  reason: string | null
}

export type BasketballShotAttempt = 'field_goal' | 'free_throw'
export type BasketballShotValueSource =
  | 'court'
  | 'manual_override'
  | 'quick_entry'
  | 'free_throw'

export interface BasketballFreeThrowTripPayload extends BasketballCapturePayload {
  maximumAttempts: 1 | 2 | 3
  oneAndOne: boolean
  sourceFoulEventId: string | null
  technical: boolean
  possessionRetained: boolean
}

export interface BasketballShotPayload extends BasketballCapturePayload {
  value: 1 | 2 | 3
  made: boolean
  attempt: BasketballShotAttempt
  valueSource: BasketballShotValueSource
  freeThrowTripId: string | null
  tripAttemptNumber: number | null
}

export interface BasketballRelatedEventPayload extends BasketballCapturePayload {
  relatedEventId: string | null
}

export interface BasketballReboundPayload extends BasketballRelatedEventPayload {
  kind: 'offensive' | 'defensive'
}

export interface BasketballTurnoverPayload extends BasketballCapturePayload {
  kind: 'player' | 'team'
}

export interface BasketballScoreAdjustmentPayload extends BasketballCapturePayload {
  delta: number
  reason: 'scoreboard_control' | 'unattributed_score' | 'official_correction'
  note: string | null
}

type BasketballLifecycleGameEvent<
  TPayload extends BasketballCapturePayload,
  TEventType extends string,
> = GameEvent<TPayload, TEventType, 'basketball', 'neutral'>

export type BasketballPeriodStartedEvent = BasketballLifecycleGameEvent<
  BasketballPeriodPayload,
  'basketball.period_started'
>
export type BasketballPeriodEndedEvent = BasketballLifecycleGameEvent<
  BasketballPeriodPayload,
  'basketball.period_ended'
>
export type BasketballMatchRosterAddedEvent = BasketballLifecycleGameEvent<
  BasketballMatchRosterAddedPayload,
  'basketball.match_roster_added'
>
export type BasketballParticipantResolvedEvent = BasketballLifecycleGameEvent<
  BasketballParticipantResolvedPayload,
  'basketball.participant_resolved'
>
export type BasketballMatchEndedEvent = BasketballLifecycleGameEvent<
  BasketballMatchEndedPayload,
  'basketball.match_ended'
>
export type BasketballMatchReopenedEvent = BasketballLifecycleGameEvent<
  BasketballMatchReopenedPayload,
  'basketball.match_reopened'
>

export type BasketballLifecycleEvent =
  | BasketballPeriodStartedEvent
  | BasketballPeriodEndedEvent
  | BasketballMatchRosterAddedEvent
  | BasketballParticipantResolvedEvent
  | BasketballMatchEndedEvent
  | BasketballMatchReopenedEvent

type BasketballStatGameEvent<
  TPayload extends BasketballCapturePayload,
  TEventType extends string,
> = GameEvent<TPayload, TEventType, 'basketball', BasketballTeamSide>

export type BasketballFreeThrowTripEvent = BasketballStatGameEvent<
  BasketballFreeThrowTripPayload,
  'basketball.free_throw_trip'
>
export type BasketballShotEvent = BasketballStatGameEvent<
  BasketballShotPayload,
  'basketball.shot'
>
export type BasketballAssistEvent = BasketballStatGameEvent<
  BasketballRelatedEventPayload,
  'basketball.assist'
>
export type BasketballReboundEvent = BasketballStatGameEvent<
  BasketballReboundPayload,
  'basketball.rebound'
>
export type BasketballStealEvent = BasketballStatGameEvent<
  BasketballRelatedEventPayload,
  'basketball.steal'
>
export type BasketballBlockEvent = BasketballStatGameEvent<
  BasketballRelatedEventPayload,
  'basketball.block'
>
export type BasketballTurnoverEvent = BasketballStatGameEvent<
  BasketballTurnoverPayload,
  'basketball.turnover'
>
export type BasketballScoreAdjustmentEvent = BasketballStatGameEvent<
  BasketballScoreAdjustmentPayload,
  'basketball.score_adjustment'
>

export type BasketballStatEvent =
  | BasketballFreeThrowTripEvent
  | BasketballShotEvent
  | BasketballAssistEvent
  | BasketballReboundEvent
  | BasketballStealEvent
  | BasketballBlockEvent
  | BasketballTurnoverEvent
  | BasketballScoreAdjustmentEvent

export type BasketballMatchEvent = BasketballLifecycleEvent | BasketballStatEvent
