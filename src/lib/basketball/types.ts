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
  score: BasketballScoreProjection
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
