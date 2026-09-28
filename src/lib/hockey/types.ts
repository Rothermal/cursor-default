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

/** The HKY-1 overtime shape, still readable in stored snapshots. */
export interface HockeyOvertimeRulesV1 extends JsonObject {
  lengthMs: number
  skaters: number
  /** Repeat sudden-death periods until a goal (playoff style). */
  repeat: boolean
  endsPolicy: HockeyOvertimeEndsPolicy
}

/** Written since HKY-2: a goal ends an overtime period only when `suddenDeath` is true (Q4). */
export interface HockeyOvertimeRulesV2 extends HockeyOvertimeRulesV1 {
  suddenDeath: boolean
}

/**
 * `null` in the rules means no overtime. Read sudden death through
 * `hockeyOvertimeSuddenDeath`, which treats the HKY-1 shape as true.
 */
export type HockeyOvertimeRules = HockeyOvertimeRulesV1 | HockeyOvertimeRulesV2

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

// -- Capture events (HKY-2B) -------------------------------------------------

export type HockeyShotOutcome = 'goal' | 'saved' | 'missed' | 'blocked'
export type HockeyMissType = 'wide' | 'high' | 'post' | 'crossbar'
/** Frozen now so HKY-3B needs no schema version 2; HKY-2 always writes null. */
export type HockeyStrength = 'ev' | 'pp' | 'sh'
export type HockeyOnIceStatus = 'complete' | 'partial' | 'not_recorded'

/**
 * The tracked side's players on the ice at a goal (HKY-2 on-ice prompt). `complete` is a
 * recorder confirmation checked for structural possibility; it is never re-derived later.
 */
export interface HockeyOnIce extends JsonObject {
  status: HockeyOnIceStatus
  skaterParticipantIds: string[]
  /** A goalie participant id, `'empty_net'`, or null when unknown. */
  goalie: string | null
}

export const HOCKEY_EMPTY_NET = 'empty_net'

export interface HockeyShotPayload extends HockeyCapturePayload {
  outcome: HockeyShotOutcome
  missType: HockeyMissType | null
  /** Confirmed at capture, so a later goalie correction never silently changes it. */
  emptyNet: boolean
  penaltyShot: boolean
  strength: HockeyStrength | null
  /** Goals only; null for every other outcome. */
  onIce: HockeyOnIce | null
}

export type HockeyGoalieChangeReason = 'tactical' | 'injury' | 'pulled' | 'return' | 'penalty'

export interface HockeyGoalieChangePayload extends HockeyCapturePayload {
  /** Participant or opponent goalie id; null leaves the net empty. */
  inParticipantId: string | null
  reason: HockeyGoalieChangeReason
  /** Adds an opponent goalie identity the first time one is used. */
  newOpponentGoalie: HockeyOpponentGoalie | null
}

export interface HockeyScoreAdjustmentPayload extends HockeyCapturePayload {
  delta: 1 | -1
  reason: string
}

/** Actor roles on `hockey.shot`. */
export type HockeyShotActorRole = 'shooter' | 'assist_primary' | 'assist_secondary' | 'goalie' | 'blocker'

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
  'hockey.shot': HockeyShotPayload
  'hockey.goalie_change': HockeyGoalieChangePayload
  'hockey.score_adjustment': HockeyScoreAdjustmentPayload
}

export type HockeyEventType = keyof HockeyPayloadByType

/** Events that belong to one side; every other Hockey event is neutral. */
export const HOCKEY_SIDED_EVENT_TYPES = ['hockey.shot', 'hockey.goalie_change', 'hockey.score_adjustment'] as const
export type HockeySidedEventType = typeof HOCKEY_SIDED_EVENT_TYPES[number]
export type HockeySide = 'tracked' | 'opponent'

export type HockeyEvent<TType extends HockeyEventType = HockeyEventType> = {
  [K in TType]: GameEvent<
    HockeyPayloadByType[K],
    K,
    'hockey',
    K extends HockeySidedEventType ? HockeySide : 'neutral'
  >
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
  /** Goals and shots on goal per period id (HKY-2B). */
  periodTotals: Record<string, HockeyPeriodTotals>
  shotsOnGoal: { tracked: number; opponent: number }
  /** The goalie in each net; null is an empty net (pulled, or before the lineup). */
  goalieInNet: { tracked: string | null; opponent: string | null }
  goalieIntervals: HockeyGoalieInterval[]
  /** Opponent goalies known to the match: setup's goalie plus any added by a change. */
  opponentGoalies: HockeyOpponentGoalie[]
  /** Set when a goal decides a sudden-death overtime period. */
  decidedInPeriodId: string | null
  warnings: HockeyProjectionWarning[]
}

export interface HockeyPeriodTotals {
  goals: { tracked: number; opponent: number }
  shotsOnGoal: { tracked: number; opponent: number }
}

/** One stint of a goalie (or an empty net) in one side's net. */
export interface HockeyGoalieInterval {
  side: HockeySide
  participantId: string | null
  eventId: string
  periodId: string
  /** Clock position at the change; null for clockless games or between periods. */
  elapsedMs: number | null
}

/**
 * Raised when a shot's stamped goalie differs from the goalie replay now puts in net,
 * typically after a correction. Goalie credit follows the stamp (Baseball's actor_mismatch).
 */
export interface HockeyProjectionWarning {
  code: 'actor_mismatch'
  eventId: string
  role: 'goalie'
  recordedParticipantId: string | null
  resolvedParticipantId: string | null
  message: string
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
