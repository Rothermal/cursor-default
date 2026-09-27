import type { GameEvent, JsonObject } from '../gameEvents/types'

export const HOCKEY_RULES_SCHEMA_VERSION = 1
export const HOCKEY_SETTINGS_SCHEMA_VERSION = 1
export const HOCKEY_SETUP_VERSION = 1

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export type HockeyProfileId =
  | 'usa_hockey_youth'
  | 'recreational'
  | 'high_school_us'
  | 'ncaa'
  | 'nhl_regular'
  | 'nhl_playoffs'
  | 'custom'

/** Timing discriminator frozen with the rules snapshot (same values as Basketball). */
export type HockeyClockModel = 'anchored' | 'none'
export type HockeyClockDisplay = 'count_down' | 'count_up'
/** Stop-time stops at every whistle; running only stops for recorder-chosen stoppages. */
export type HockeyClockMode = 'stop_time' | 'running'
export type HockeyOvertimeEndsPolicy = 'continue_alternation' | 'same_as_last_regulation'
export type HockeyShootoutRepeatShooters = 'after_all' | 'never' | 'any'
export type HockeyCoincidentalMinors = 'substitute' | 'play_short'

export interface HockeyRegulationRules extends JsonObject {
  periods: number
  periodLengthMs: number
}

/** Present only when `clockModel` is `anchored`. */
export interface HockeyClockRules extends JsonObject {
  display: HockeyClockDisplay
  mode: HockeyClockMode
}

/** `null` in the rules means no overtime. */
export interface HockeyOvertimeRules extends JsonObject {
  lengthMs: number
  skaters: number
  /** Repeat sudden-death periods until a goal (playoff style). */
  repeat: boolean
  endsPolicy: HockeyOvertimeEndsPolicy
}

/** `null` in the rules means no shootout. */
export interface HockeyShootoutRules extends JsonObject {
  rounds: number
  repeatShooters: HockeyShootoutRepeatShooters
}

export interface HockeyPenaltyRules extends JsonObject {
  minorMs: number
  doubleMinorMs: number
  majorMs: number
  misconductMs: number
  releaseMinorOnPowerPlayGoal: boolean
  coincidentalMinors: HockeyCoincidentalMinors
}

export interface HockeyMatchRules extends JsonObject {
  rulesSchemaVersion: typeof HOCKEY_RULES_SCHEMA_VERSION
  profileId: HockeyProfileId
  profileVersion: number
  regulation: HockeyRegulationRules
  clockModel: HockeyClockModel
  clock: HockeyClockRules | null
  skatersPerSide: number
  minimumSkaters: number
  overtime: HockeyOvertimeRules | null
  shootout: HockeyShootoutRules | null
  tiesAllowed: boolean
  penalties: HockeyPenaltyRules
  /** Display only: draws the goaltender trapezoid. */
  trapezoid: boolean
}

/** Fields a settings or match layer may override. Nested objects are atomic. */
export type HockeyRulesField =
  | 'regulation'
  | 'clockModel'
  | 'clock'
  | 'skatersPerSide'
  | 'minimumSkaters'
  | 'overtime'
  | 'shootout'
  | 'tiesAllowed'
  | 'penalties'
  | 'trapezoid'

export type HockeyRuleOverrides = Partial<Pick<HockeyMatchRules, HockeyRulesField>>

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface HockeyProfileRef {
  profileId: HockeyProfileId
  profileVersion: number
}

/** Shared shape for personal and team settings in schema version 1. */
export interface HockeySettingsV1 {
  settingsSchemaVersion: typeof HOCKEY_SETTINGS_SCHEMA_VERSION
  baseProfile: HockeyProfileRef
  ruleOverrides: HockeyRuleOverrides
}

/** Personal-or-team authority, following Basketball rather than Soccer's layering. */
export type HockeySettingsAuthority = 'personal' | 'team'
export type HockeyRuleSource = 'built_in' | HockeySettingsAuthority | 'match'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export type HockeyTrackedTeam = 'home' | 'away' | 'neutral'
export type HockeyAttackingDirection = 'left_to_right' | 'right_to_left'
export type HockeyDressedAs = 'skater' | 'goalie'

export interface HockeyMatchParticipant extends JsonObject {
  /** Stable match identity used by every event. */
  id: string
  playerId: string | null
  displayName: string
  number: string | null
  /** Snapshot of the roster default position; never written back. */
  position: string | null
  dressedAs: HockeyDressedAs
}

export interface HockeyOpeningLineup extends JsonObject {
  goalieParticipantId: string
  skaterParticipantIds: string[]
}

/** The opponent is simplified: one goalie identity, optional label and number. */
export interface HockeyOpponentGoalie extends JsonObject {
  id: string
  label: string | null
  number: string | null
}

export interface HockeyMatchSetup {
  version: typeof HOCKEY_SETUP_VERSION
  trackedTeam: HockeyTrackedTeam
  opponentName: string | null
  sourceTeamId: string | null
  sourceSeasonId: string | null
  rulesSnapshot: HockeyMatchRules
  rulesSource: Record<HockeyRulesField, HockeyRuleSource>
  /** Which end the tracked team attacks in period 1, in canonical rink coordinates. */
  firstPeriodAttackingDirection: HockeyAttackingDirection
  participants: HockeyMatchParticipant[]
  openingLineup: HockeyOpeningLineup
  opponentGoalie: HockeyOpponentGoalie
}

export type HockeySetupValidation = { ok: true } | { ok: false; message: string }

// ---------------------------------------------------------------------------
// Events (HKY-1C)
// ---------------------------------------------------------------------------

export const HOCKEY_EVENT_SCHEMA_VERSION = 1
export const HOCKEY_GAME_STATE_VERSION = 1

export type HockeyPeriodKind = 'regulation' | 'overtime'

export interface HockeyPeriodRef {
  kind: HockeyPeriodKind
  number: number
}

export type HockeyClockPauseSource = 'manual' | 'expiration'

interface HockeyCapturePayload extends JsonObject {
  /** Groups events appended by one command; null for single-event commands. */
  captureCommandId: string | null
}

export interface HockeyOpeningLineupPayload extends HockeyCapturePayload {
  goalieParticipantId: string
  skaterParticipantIds: string[]
  opponentGoalieId: string
}

export interface HockeyPeriodStartedPayload extends HockeyCapturePayload {
  kind: HockeyPeriodKind
  number: number
}

export interface HockeyPeriodEndedPayload extends HockeyCapturePayload {
  /** Required when an anchored period ends before its clock expires. */
  reason: string | null
}

export interface HockeyClockStartedPayload extends HockeyCapturePayload {
  anchorElapsedMs: number
}

export interface HockeyClockPausedPayload extends HockeyCapturePayload {
  elapsedMs: number
  source: HockeyClockPauseSource
}

export interface HockeyClockSetPayload extends HockeyCapturePayload {
  fromElapsedMs: number
  toElapsedMs: number
  reason: string
}

export interface HockeyMatchEndedPayload extends HockeyCapturePayload {
  /** Required when the match ends before its rules say it is complete. */
  reason: string | null
}

export interface HockeyReasonPayload extends HockeyCapturePayload {
  reason: string
}

export interface HockeyPayloadByType {
  'hockey.opening_lineup': HockeyOpeningLineupPayload
  'hockey.period_started': HockeyPeriodStartedPayload
  'hockey.period_ended': HockeyPeriodEndedPayload
  'hockey.clock_started': HockeyClockStartedPayload
  'hockey.clock_paused': HockeyClockPausedPayload
  'hockey.clock_set': HockeyClockSetPayload
  'hockey.match_ended': HockeyMatchEndedPayload
  'hockey.match_suspended': HockeyReasonPayload
  'hockey.match_abandoned': HockeyReasonPayload
  'hockey.match_reopened': HockeyReasonPayload
}

export type HockeyEventType = keyof HockeyPayloadByType

export type HockeyEvent<TType extends HockeyEventType = HockeyEventType> = {
  [K in TType]: GameEvent<HockeyPayloadByType[K], K, 'hockey', 'neutral'>
}[TType]

// ---------------------------------------------------------------------------
// Projection and sport state
// ---------------------------------------------------------------------------

export type HockeyMatchStatus = 'pregame' | 'in_progress' | 'ended' | 'suspended' | 'abandoned'

export interface HockeyPeriodRecord {
  id: string
  order: number
  kind: HockeyPeriodKind
  number: number
  durationMs: number
  trackedAttackingDirection: HockeyAttackingDirection | null
  startedEventId: string
  endedEventId: string | null
  /** Clock position at the end of an anchored period; null for clockless games. */
  endedAtElapsedMs: number | null
  earlyEndReason: string | null
}

/** Anchored clock state; `elapsedMs` counts up from the start of the active period. */
export interface HockeyClockProjection {
  periodId: string | null
  running: boolean
  elapsedMs: number
  anchorElapsedMs: number | null
  anchorOccurredAt: string | null
  expired: boolean
}

export interface HockeyMatchProjection {
  status: HockeyMatchStatus
  /** Reason recorded with the latest end, suspension, abandonment or reopen. */
  statusReason: string | null
  lineupRecorded: boolean
  periods: HockeyPeriodRecord[]
  activePeriodId: string | null
  /** The period that may start next, when no period is active. */
  nextPeriod: HockeyPeriodRef | null
  /** True when ending the match now needs no reason. */
  canEndWithoutReason: boolean
  /** Null when the frozen rules use `clockModel: 'none'`. */
  clock: HockeyClockProjection | null
  score: { tracked: number; opponent: number }
  /** Direction for the active period, or the most recent one. */
  trackedAttackingDirection: HockeyAttackingDirection | null
}

/** Device display choices; never part of fingerprints or cloud payloads. */
export interface HockeyPreferences {
  rinkFlipped: boolean
}

export interface HockeySportGameState {
  sportId: 'hockey'
  version: typeof HOCKEY_GAME_STATE_VERSION
  setup: HockeyMatchSetup
  projection: HockeyMatchProjection
  capturePreferences: HockeyPreferences
}
