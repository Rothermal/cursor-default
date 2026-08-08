import type { GameEvent, GameEventActor, JsonObject } from '../gameEvents/types'

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
  personalFoulLimit: number
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
  disqualified: boolean
  ejected: boolean
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
export type BasketballTeamStatTotals = BasketballStatTotals & Record<string, number> & {
  team_turnover: number
  team_tech: number
}

export type BasketballBonusStatus = 'none' | 'one_and_one' | 'double_bonus'

export interface BasketballEjectionProjection {
  eventId: string
  teamSide: BasketballTeamSide
  subject: GameEventActor
  reason: string
  source: BasketballEjectionSource
  relatedFoulEventId: string | null
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
  periodTeamFouls: Record<string, Record<BasketballTeamSide, number>>
  periodTimeouts: Record<string, Record<BasketballTeamSide, number>>
  bonusStatusByPeriod: Record<string, Record<BasketballTeamSide, BasketballBonusStatus>>
  neutralTimeouts: number
  ejections: BasketballEjectionProjection[]
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
  lastCourtUndo: BasketballCourtUndoReceipt | null
}

export interface BasketballCourtUndoReceiptEntry extends JsonObject {
  eventId: string
  expectedRevision: number
  action:
    | 'restore'
    | 'relink_block'
    | 'relink_trip_foul'
    | 'relink_ejection_foul'
    | 'relink_attempt_trip'
  previousRelatedEventId: string | null
  previousAttemptNumber: number | null
}

export interface BasketballCourtUndoReceipt extends JsonObject {
  kind: 'capture_undo' | 'clear_chart' | 'direct_decrement' | 'administrative_decrement'
  createdAt: string
  entries: BasketballCourtUndoReceiptEntry[]
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

export type BasketballFoulClass =
  | 'personal'
  | 'technical'
  | 'flagrant'
  | 'intentional'
  | 'double'
export type BasketballFoulContext =
  | 'common'
  | 'shooting'
  | 'offensive'
  | 'loose_ball'
  | 'away_from_play'
  | 'administrative'

export interface BasketballFoulCountingOverride extends JsonObject {
  personalFoul: boolean
  teamFoul: boolean
  technical: boolean
  reason: string
}

export interface BasketballFoulPayload extends BasketballCapturePayload {
  class: BasketballFoulClass
  context: BasketballFoulContext
  teamControlSide: BasketballTeamSide | null
  incidentId: string | null
  countingOverride: BasketballFoulCountingOverride | null
}

export type BasketballEjectionSource = 'automatic_threshold' | 'official_ruling'

export interface BasketballEjectionPayload extends BasketballCapturePayload {
  reason: string
  source: BasketballEjectionSource
  relatedFoulEventId: string | null
}

export type BasketballTimeoutKind = 'full' | 'thirty_second' | 'media' | 'official'

export interface BasketballTimeoutPayload extends BasketballCapturePayload {
  kind: BasketballTimeoutKind
  chargedSide: BasketballTeamSide | null
  label: string | null
}

export interface BasketballMinutesAdjustmentPayload extends BasketballCapturePayload {
  deltaMinutes: number
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

export type BasketballFoulEvent = BasketballStatGameEvent<
  BasketballFoulPayload,
  'basketball.foul'
>
export type BasketballEjectionEvent = BasketballStatGameEvent<
  BasketballEjectionPayload,
  'basketball.ejection'
>
export type BasketballTimeoutEvent = GameEvent<
  BasketballTimeoutPayload,
  'basketball.timeout',
  'basketball',
  BasketballTeamSide | 'neutral'
>
export type BasketballMinutesAdjustmentEvent = BasketballStatGameEvent<
  BasketballMinutesAdjustmentPayload,
  'basketball.minutes_adjustment'
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

export type BasketballAdministrativeEvent =
  | BasketballFoulEvent
  | BasketballEjectionEvent
  | BasketballTimeoutEvent
  | BasketballMinutesAdjustmentEvent

export type BasketballMatchEvent =
  | BasketballLifecycleEvent
  | BasketballStatEvent
  | BasketballAdministrativeEvent
