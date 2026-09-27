import type { JsonObject } from '../gameEvents/types'

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
