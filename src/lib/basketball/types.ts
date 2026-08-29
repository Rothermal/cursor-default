import type { GameEvent, GameEventActor, JsonObject } from '../gameEvents/types'

export const BASKETBALL_GAME_STATE_VERSION = 1
export const BASKETBALL_EVENT_SCHEMA_VERSION = 1

export type BasketballTeamSide = 'tracked' | 'opponent'
export type BasketballTrackedTeamDesignation = 'home' | 'away' | 'neutral'
export type BasketballRosterStatus = 'starter' | 'bench' | 'dnp'
export type BasketballSegmentKind = 'regulation' | 'overtime'
export type BasketballClockModel = 'none' | 'anchored'
export type BasketballClockDisplayDirection = 'count_down' | 'count_up'
export type BasketballClockExpiration = 'stop_at_zero'
export type BasketballStoppageMode = 'explicit'
export type BasketballEqualPlayMode = 'off' | 'advisory' | 'enforced'
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
export type BasketballClockPauseSource = 'manual' | 'expiration' | 'period_end'
export type BasketballStoppageCategory =
  | 'timeout'
  | 'foul_free_throw'
  | 'out_of_bounds'
  | 'substitution'
  | 'injury'
  | 'official_review'
  | 'other'
export type BasketballSubstitutionMode =
  | 'balanced'
  | 'exit_only'
  | 'entry_only'
  | 'mixed'
  | 'boundary'
  | 'current_lineup_recovery'
export type BasketballSubstitutionReasonCode =
  | 'injury'
  | 'eligibility'
  | 'short_handed'
  | 'recovery'
  | 'other'
export type BasketballEqualPlayViolationCode =
  | 'minimum_periods'
  | 'maximum_consecutive_periods'
  | 'maximum_period_imbalance'

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

export interface BasketballMatchRulesV1 extends JsonObject {
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

export interface BasketballMatchSegmentV2 extends BasketballMatchSegment {
  foulWindowId: string
  timeoutPoolId: string
  lineupChangeBoundary: boolean
}

export interface BasketballFoulWindowRule extends JsonObject {
  id: string
  label: string
  segmentIds: string[]
  bonusThreshold: number | null
  doubleBonusThreshold: number | null
  hasOneAndOne: boolean
}

export interface BasketballTimeoutPoolRule extends JsonObject {
  id: string
  label: string
  segmentIds: string[]
  totalLimit: number | null
  fullLimit: number | null
  shortLimit: number | null
  carryoverToPoolId: string | null
}

export interface BasketballFoulWindowTemplate extends JsonObject {
  label: string
  bonusThreshold: number | null
  doubleBonusThreshold: number | null
  hasOneAndOne: boolean
}

export interface BasketballTimeoutPoolTemplate extends JsonObject {
  label: string
  totalLimit: number | null
  fullLimit: number | null
  shortLimit: number | null
}

export interface BasketballTimeoutLimitAddition extends JsonObject {
  total: number
  full: number
  short: number
}

export type BasketballOvertimeWindowMode = 'continue' | 'new_each' | 'shared_overtimes'

export interface BasketballOvertimeFoulPolicy extends JsonObject {
  mode: BasketballOvertimeWindowMode
  regulationWindowId: string | null
  window: BasketballFoulWindowTemplate | null
}

export interface BasketballOvertimeTimeoutPolicy extends JsonObject {
  mode: BasketballOvertimeWindowMode
  regulationPoolId: string | null
  pool: BasketballTimeoutPoolTemplate | null
  additionsPerOvertime: BasketballTimeoutLimitAddition
}

export interface BasketballOvertimeTemplateV2 extends BasketballOvertimeTemplate {
  foulPolicy: BasketballOvertimeFoulPolicy
  timeoutPolicy: BasketballOvertimeTimeoutPolicy
  lineupChangeBoundary: boolean
}

export interface BasketballMatchRulesV2 extends JsonObject {
  rulesSchemaVersion: 2
  regulationSegments: BasketballMatchSegmentV2[]
  overtimeTemplate: BasketballOvertimeTemplateV2
  foulWindows: BasketballFoulWindowRule[]
  timeoutPools: BasketballTimeoutPoolRule[]
  personalFoulLimit: number
  clockModel: 'none'
}

export interface BasketballEqualPlayPolicy extends JsonObject {
  mode: BasketballEqualPlayMode
  minimumPeriods: number | null
  maximumConsecutivePeriods: number | null
  maximumPeriodImbalance: number | null
}

export interface BasketballMatchRulesV3 extends JsonObject {
  rulesSchemaVersion: 3
  regulationSegments: BasketballMatchSegmentV2[]
  overtimeTemplate: BasketballOvertimeTemplateV2
  foulWindows: BasketballFoulWindowRule[]
  timeoutPools: BasketballTimeoutPoolRule[]
  personalFoulLimit: number
  clockModel: BasketballClockModel
  clockDisplayDirection: BasketballClockDisplayDirection
  clockExpiration: BasketballClockExpiration
  stoppageMode: BasketballStoppageMode
  equalPlayPolicy: BasketballEqualPlayPolicy
}

export type BasketballMatchRules =
  | BasketballMatchRulesV1
  | BasketballMatchRulesV2
  | BasketballMatchRulesV3

export type BasketballRulesV2Field =
  | 'regulationSegments'
  | 'overtimeTemplate'
  | 'foulWindows'
  | 'timeoutPools'
  | 'personalFoulLimit'
  | 'clockModel'

export type BasketballRulesField =
  | BasketballRulesV2Field
  | 'clockDisplayDirection'
  | 'clockExpiration'
  | 'stoppageMode'
  | 'equalPlayPolicy'

export interface BasketballRuleOverridesV2 {
  regulationSegments?: BasketballMatchSegmentV2[]
  overtimeTemplate?: BasketballOvertimeTemplateV2
  foulWindows?: BasketballFoulWindowRule[]
  timeoutPools?: BasketballTimeoutPoolRule[]
  personalFoulLimit?: number
  clockModel?: 'none'
}

export interface BasketballRuleOverrides {
  regulationSegments?: BasketballMatchSegmentV2[]
  overtimeTemplate?: BasketballOvertimeTemplateV2
  foulWindows?: BasketballFoulWindowRule[]
  timeoutPools?: BasketballTimeoutPoolRule[]
  personalFoulLimit?: number
  clockModel?: BasketballClockModel
  clockDisplayDirection?: BasketballClockDisplayDirection
  clockExpiration?: BasketballClockExpiration
  stoppageMode?: BasketballStoppageMode
  equalPlayPolicy?: BasketballEqualPlayPolicy
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

export interface BasketballMatchSetupV1 {
  version: 1
  trackedTeamDesignation: BasketballTrackedTeamDesignation
  sourceTeamId: string | null
  sourceSeasonId: string | null
  rulesSource: BasketballRulesSource
  rulesSnapshot: BasketballMatchRulesV1 | BasketballMatchRulesV2
  participants: BasketballMatchParticipant[]
}

export interface BasketballOpeningLineupSide extends JsonObject {
  participantIds: string[]
  shortHandedReason: string | null
}

export interface BasketballOpeningLineups extends JsonObject {
  tracked: BasketballOpeningLineupSide
  opponent: BasketballOpeningLineupSide | null
}

export interface BasketballMatchSetupV2 {
  version: 2
  trackedTeamDesignation: BasketballTrackedTeamDesignation
  sourceTeamId: string | null
  sourceSeasonId: string | null
  rulesSource: BasketballRulesSource
  rulesSnapshot: BasketballMatchRulesV3
  participants: BasketballMatchParticipant[]
  openingLineups: BasketballOpeningLineups | null
}

export type BasketballMatchSetup = BasketballMatchSetupV1 | BasketballMatchSetupV2

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

export interface BasketballAnchoredClockProjection {
  periodId: string | null
  running: boolean
  elapsedMs: number
  anchorElapsedMs: number | null
  anchorOccurredAt: string | null
  lastRunningElapsedMs: number | null
  expired: boolean
  lastStartEventId: string | null
  lastPauseEventId: string | null
  lastAdjustmentEventId: string | null
  lastStoppageEventId: string | null
  pendingStoppagePauseEventId: string | null
  pendingStoppageCaptureCommandId: string | null
}

export interface BasketballOnCourtInterval {
  periodId: string
  participantIds: string[]
  startElapsedMs: number
  endElapsedMs: number | null
  startEventId: string
  endEventId: string | null
  complete: boolean
}

export interface BasketballRunningClockInterval {
  periodId: string
  startElapsedMs: number
  endElapsedMs: number | null
  startEventId: string
  endEventId: string | null
}

export interface BasketballParticipationInterval {
  periodId: string
  startElapsedMs: number
  endElapsedMs: number
  durationMs: number
  startEventId: string
  endEventId: string
}

export interface BasketballParticipantParticipation {
  participantId: string
  started: boolean
  appeared: boolean
  participationMs: number
  participationSeconds: number
  periodParticipationMs: Record<string, number>
  creditedPeriodIds: string[]
  intervals: BasketballParticipationInterval[]
  complete: boolean
}

export interface BasketballRoleHistoryEntry {
  eventId: string
  periodId: string
  elapsedMs: number
  position: string | null
  captain: boolean
}

export interface BasketballLineupSideProjection {
  teamSide: BasketballTeamSide
  currentParticipantIds: string[]
  currentShortHandedReasonCode: BasketballSubstitutionReasonCode | null
  currentShortHandedReasonNote: string | null
  boundaryConfirmationRequired: boolean
  boundaryConfirmedPeriodId: string | null
  clockStartedInPeriod: boolean
  replacementRequiredParticipantIds: string[]
  incompletePeriodIds: string[]
  onCourtIntervals: BasketballOnCourtInterval[]
  participationByParticipantId: Record<string, BasketballParticipantParticipation>
  roleHistoryByParticipantId: Record<string, BasketballRoleHistoryEntry[]>
}

export interface BasketballEqualPlayViolation {
  code: BasketballEqualPlayViolationCode
  participantIds: string[]
}

export interface BasketballEqualPlayBoundaryReview {
  periodId: string
  candidateParticipantIds: string[]
  violations: BasketballEqualPlayViolation[]
  confirmationEventId: string
  overrideEventId: string | null
}

export interface BasketballPendingEqualPlayOverride {
  eventId: string
  captureCommandId: string
  boundaryPeriodId: string
  candidateParticipantIds: string[]
  violationCodes: BasketballEqualPlayViolationCode[]
}

export interface BasketballLineupProjection {
  sides: Record<BasketballTeamSide, BasketballLineupSideProjection | null>
  runningClockIntervals: BasketballRunningClockInterval[]
  equalPlayReviews: BasketballEqualPlayBoundaryReview[]
  equalPlayCompliant: boolean
  enforcedOverridesComplete: boolean
  pendingEqualPlayOverride: BasketballPendingEqualPlayOverride | null
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
  clock: BasketballAnchoredClockProjection | null
  lineup?: BasketballLineupProjection
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

export interface BasketballClockStartedPayload extends BasketballCapturePayload {
  anchorElapsedMs: number
}

export interface BasketballClockPausedPayload extends BasketballCapturePayload {
  elapsedMs: number
  source: BasketballClockPauseSource
}

export interface BasketballClockAdjustedPayload extends BasketballCapturePayload {
  fromElapsedMs: number
  toElapsedMs: number
  reason: string
}

export interface BasketballStoppagePayload extends BasketballCapturePayload {
  pauseEventId: string
  category: BasketballStoppageCategory
  note: string | null
}

export interface BasketballLineupConfirmedPayload extends BasketballCapturePayload {
  captureCommandId: string
  participantIds: string[]
  boundaryPeriodId: string
}

export interface BasketballSubstitutionPayload extends BasketballCapturePayload {
  captureCommandId: string
  participantIds: string[]
  mode: BasketballSubstitutionMode
  reasonCode: BasketballSubstitutionReasonCode | null
  reasonNote: string | null
}

export interface BasketballRoleChange extends JsonObject {
  participantId: string
  position: string | null
  captain: boolean
}

export interface BasketballRoleChangedPayload extends BasketballCapturePayload {
  captureCommandId: string
  changes: BasketballRoleChange[]
}

export interface BasketballEqualPlayOverridePayload extends BasketballCapturePayload {
  captureCommandId: string
  boundaryPeriodId: string
  candidateParticipantIds: string[]
  violationCodes: BasketballEqualPlayViolationCode[]
  reason: string
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

type BasketballClockGameEvent<
  TPayload extends BasketballCapturePayload,
  TEventType extends string,
> = GameEvent<TPayload, TEventType, 'basketball', 'neutral'>

export type BasketballClockStartedEvent = BasketballClockGameEvent<
  BasketballClockStartedPayload,
  'basketball.clock_started'
>
export type BasketballClockPausedEvent = BasketballClockGameEvent<
  BasketballClockPausedPayload,
  'basketball.clock_paused'
>
export type BasketballClockAdjustedEvent = BasketballClockGameEvent<
  BasketballClockAdjustedPayload,
  'basketball.clock_adjusted'
>
export type BasketballStoppageEvent = BasketballClockGameEvent<
  BasketballStoppagePayload,
  'basketball.stoppage'
>

export type BasketballClockEvent =
  | BasketballClockStartedEvent
  | BasketballClockPausedEvent
  | BasketballClockAdjustedEvent
  | BasketballStoppageEvent

type BasketballLineupGameEvent<
  TPayload extends BasketballCapturePayload & { captureCommandId: string },
  TEventType extends string,
  TSide extends BasketballTeamSide = BasketballTeamSide,
> = GameEvent<TPayload, TEventType, 'basketball', TSide>

export type BasketballLineupConfirmedEvent = BasketballLineupGameEvent<
  BasketballLineupConfirmedPayload,
  'basketball.lineup_confirmed'
>
export type BasketballSubstitutionEvent = BasketballLineupGameEvent<
  BasketballSubstitutionPayload,
  'basketball.substitution'
>
export type BasketballRoleChangedEvent = BasketballLineupGameEvent<
  BasketballRoleChangedPayload,
  'basketball.role_changed'
>
export type BasketballEqualPlayOverrideEvent = BasketballLineupGameEvent<
  BasketballEqualPlayOverridePayload,
  'basketball.equal_play_override',
  'tracked'
>

export type BasketballLineupEvent =
  | BasketballLineupConfirmedEvent
  | BasketballSubstitutionEvent
  | BasketballRoleChangedEvent
  | BasketballEqualPlayOverrideEvent

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
  | BasketballClockEvent
  | BasketballLineupEvent
  | BasketballStatEvent
  | BasketballAdministrativeEvent
