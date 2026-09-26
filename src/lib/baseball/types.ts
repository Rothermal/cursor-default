import type { GameEvent, GameEventLocation, JsonObject } from '../gameEvents/types'

export const BASEBALL_GAME_STATE_VERSION = 1
export const BASEBALL_EVENT_SCHEMA_VERSION = 1
export const BASEBALL_RULES_SCHEMA_VERSION = 1
export const BASEBALL_SETUP_VERSION = 1

export type BaseballTeamSide = 'tracked' | 'opponent'
export type BaseballHomeAway = 'home' | 'away'
export type BaseballHalf = 'top' | 'bottom'
export type BaseballBase = 'first' | 'second' | 'third'
export type BaseballMovementFrom = 'batter' | BaseballBase
export type BaseballMovementTo = BaseballBase | 'home' | 'out'
export type BaseballBatHand = 'L' | 'R' | 'S'
export type BaseballPitchHand = 'L' | 'R'

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export type BaseballRulesVariant = 'baseball' | 'softball_fastpitch' | 'softball_slowpitch'

export type BaseballProfileId =
  | 'nfhs_baseball'
  | 'youth_baseball'
  | 'mlb'
  | 'ncaa_baseball'
  | 'nfhs_softball_fastpitch'
  | 'softball_slowpitch'
  | 'custom'

export type BaseballBattingOrderFormat =
  | 'standard'
  | 'designated_hitter'
  | 'extra_hitter'
  | 'continuous'

export type BaseballReentryRule = 'none' | 'starters_once' | 'unlimited'

export interface BaseballRunRule {
  /** The rule applies once this many innings are complete (or the home side leads in the bottom half). */
  afterInning: number
  lead: number
}

export interface BaseballMatchRules {
  rulesSchemaVersion: typeof BASEBALL_RULES_SCHEMA_VERSION
  profileId: BaseballProfileId
  profileVersion: number
  variant: BaseballRulesVariant
  scheduledInnings: number
  ballsForWalk: number
  strikesForStrikeout: number
  /** Slowpitch leagues commonly start every plate appearance at 1-1. */
  startingBalls: number
  startingStrikes: number
  /** Slowpitch option: a foul with two strikes is a strikeout. */
  twoStrikeFoulIsOut: boolean
  twoStrikeFoulBuntIsStrikeout: boolean
  droppedThirdStrike: boolean
  battingOrderFormat: BaseballBattingOrderFormat
  /** Extra hitters beyond the defensive players; continuous format ignores it. */
  maxExtraHitters: number
  /** Nine, or ten for slowpitch (short fielder). */
  defensivePlayers: 9 | 10
  reentry: BaseballReentryRule
  courtesyRunners: boolean
  stealing: boolean
  leadingOff: boolean
  balks: boolean
  extraInningsAllowed: boolean
  /** Extra-inning tiebreaker: runner placed at this base from `placedRunnerFromInning`. */
  placedRunnerBase: BaseballBase | null
  placedRunnerFromInning: number | null
  runRules: BaseballRunRule[]
  maxRunsPerHalfInning: number | null
  tiesAllowed: boolean
  pitchCountWarnings: number[]
  pitchCountLimit: number | null
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Fielding numbers 1 (P) through 9 (RF), and 10 for a slowpitch short fielder. */
export type BaseballFieldingNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export interface BaseballMatchParticipant {
  /** Stable match identity used by every event. */
  id: string
  playerId: string | null
  displayName: string
  number: string | null
  /** Snapshot of the roster default position; game assignments live in the lineup. */
  position: string | null
  bats: BaseballBatHand | null
  throws: BaseballPitchHand | null
}

export interface BaseballOpponentSlot extends JsonObject {
  id: string
  label: string | null
  number: string | null
  position: string | null
  bats: BaseballBatHand | null
}

export interface BaseballOpponentPitcher extends JsonObject {
  id: string
  label: string | null
  number: string | null
  throws: BaseballPitchHand | null
}

export interface BaseballTrackedLineup {
  /** Participant ids in batting order. */
  battingOrder: string[]
  /** Fielding number (as a string key) -> participant id. */
  defense: Record<string, string>
}

export interface BaseballMatchSetup {
  version: typeof BASEBALL_SETUP_VERSION
  trackedSide: BaseballHomeAway
  opponentName: string | null
  sourceTeamId: string | null
  sourceSeasonId: string | null
  rulesSnapshot: BaseballMatchRules
  participants: BaseballMatchParticipant[]
  trackedLineup: BaseballTrackedLineup
  opponentSlots: BaseballOpponentSlot[]
  opponentPitcher: BaseballOpponentPitcher
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type BaseballPitchResult =
  | 'ball'
  | 'called_strike'
  | 'swinging_strike'
  | 'foul'
  | 'foul_tip'
  | 'foul_bunt'
  | 'missed_bunt'
  | 'in_play'
  | 'hit_by_pitch'
  | 'intentional_ball'
  | 'pitchout'

export type BaseballBattedBallType = 'ground' | 'line' | 'fly' | 'popup' | 'bunt' | 'unknown'

export type BaseballInPlayResult =
  | 'single'
  | 'double'
  | 'triple'
  | 'home_run'
  | 'ground_rule_double'
  | 'out'
  | 'error'
  | 'fielders_choice'
  | 'sacrifice_bunt'
  | 'sacrifice_fly'
  | 'double_play'
  | 'triple_play'

export interface BaseballInPlay extends JsonObject {
  battedBallType: BaseballBattedBallType
  result: BaseballInPlayResult
  /** Fielding numbers of the first fielder(s) to handle the ball; outs carry their own sequence. */
  fielders: number[]
  /** Fielder charged with an error that let the batter reach, if any. */
  errorBy: number | null
  insideThePark: boolean
}

export type BaseballMovementReason =
  | 'on_play'
  | 'forced'
  | 'stolen_base'
  | 'caught_stealing'
  | 'pickoff'
  | 'wild_pitch'
  | 'passed_ball'
  | 'balk'
  | 'error'
  | 'throw'
  | 'defensive_indifference'
  | 'appeal'
  | 'interference'
  | 'obstruction'
  | 'awarded'
  | 'dropped_third_strike'

export interface BaseballRunnerMovement extends JsonObject {
  runnerId: string
  from: BaseballMovementFrom
  to: BaseballMovementTo
  reason: BaseballMovementReason
  /** Putout/assist sequence for an out (last fielder records the putout). */
  fielders: number[]
  errorBy: number | null
  /** Recorder overrides; null means the documented default applies. */
  earned: boolean | null
  rbi: boolean | null
  /** Override whether a run counts when the third out happens on the same play. */
  runCounts: boolean | null
}

export interface BaseballPitchLocation extends JsonObject {
  /** Catcher's view: 0..1 spans the plate from catcher's left to right; outside values are balls. */
  x: number
  /** 0 is the top of the zone and 1 the bottom; outside values are balls. */
  y: number
}

export interface BaseballCapturePayload extends JsonObject {
  captureCommandId: string | null
}

export interface BaseballPitchPayload extends BaseballCapturePayload {
  result: BaseballPitchResult
  pitchLocation: BaseballPitchLocation | null
  inPlay: BaseballInPlay | null
  movements: BaseballRunnerMovement[]
}

export type BaseballQuickPlateAppearanceResult =
  | 'walk'
  | 'intentional_walk'
  | 'hit_by_pitch'
  | 'strikeout_swinging'
  | 'strikeout_looking'
  | 'catcher_interference'
  | 'in_play'

export interface BaseballPlateAppearancePayload extends BaseballCapturePayload {
  result: BaseballQuickPlateAppearanceResult
  inPlay: BaseballInPlay | null
  /** Optional final count when pitches were not tracked. */
  finalBalls: number | null
  finalStrikes: number | null
  movements: BaseballRunnerMovement[]
}

export type BaseballBaserunningPlay =
  | 'stolen_base'
  | 'caught_stealing'
  | 'pickoff'
  | 'wild_pitch'
  | 'passed_ball'
  | 'balk'
  | 'error'
  | 'defensive_indifference'
  | 'appeal'
  | 'other'

export interface BaseballBaserunningPayload extends BaseballCapturePayload {
  play: BaseballBaserunningPlay
  movements: BaseballRunnerMovement[]
}

export type BaseballSubstitution =
  | { kind: 'pinch_hitter'; incomingId: string; outgoingId: string }
  | { kind: 'pinch_runner'; incomingId: string; outgoingId: string }
  | { kind: 'courtesy_runner'; incomingId: string; outgoingId: string }
  /** `outgoingId` names who leaves the game when it is not simply the player at that position. */
  | { kind: 'defensive'; position: number; incomingId: string; outgoingId: string | null }
  | { kind: 'position_change'; assignments: Array<{ participantId: string; position: number }> }
  | { kind: 'opponent_pitcher'; pitcher: BaseballOpponentPitcher }
  | {
      kind: 'opponent_slot'
      slotId: string
      label: string | null
      number: string | null
      position: string | null
      bats: BaseballBatHand | null
    }

export interface BaseballSubstitutionPayload extends BaseballCapturePayload {
  substitution: BaseballSubstitution & JsonObject
}

export type BaseballHalfInningEndReason = 'time_limit' | 'mercy' | 'other'

export interface BaseballHalfInningEndedPayload extends BaseballCapturePayload {
  reason: BaseballHalfInningEndReason
  note: string | null
}

export type BaseballGameEndOutcome =
  | 'completed'
  | 'run_rule'
  | 'time_limit'
  | 'forfeit'
  | 'suspended'
  | 'abandoned'

export interface BaseballGameEndedPayload extends BaseballCapturePayload {
  outcome: BaseballGameEndOutcome
  forfeitWinner: BaseballTeamSide | null
  note: string | null
}

export interface BaseballGameReopenedPayload extends BaseballCapturePayload {
  reason: string
}

export interface BaseballScoreAdjustmentPayload extends BaseballCapturePayload {
  delta: number
  reason: string
}

export type BaseballPayloadByType = {
  'baseball.game_started': BaseballCapturePayload
  'baseball.pitch': BaseballPitchPayload
  'baseball.plate_appearance': BaseballPlateAppearancePayload
  'baseball.baserunning': BaseballBaserunningPayload
  'baseball.substitution': BaseballSubstitutionPayload
  'baseball.half_inning_ended': BaseballHalfInningEndedPayload
  'baseball.game_ended': BaseballGameEndedPayload
  'baseball.game_reopened': BaseballGameReopenedPayload
  'baseball.score_adjustment': BaseballScoreAdjustmentPayload
}

export type BaseballEventType = keyof BaseballPayloadByType

export type BaseballEvent<TType extends BaseballEventType = BaseballEventType> = {
  [K in TType]: GameEvent<BaseballPayloadByType[K], K, 'baseball'>
}[TType]

export type BaseballEventLocation = GameEventLocation

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export type BaseballReachKind =
  | 'hit'
  | 'walk'
  | 'hit_by_pitch'
  | 'error'
  | 'fielders_choice'
  | 'dropped_third_strike'
  | 'catcher_interference'
  | 'placed_runner'
  | 'other'

export interface BaseballRunner {
  runnerId: string
  /** Pitcher charged if this runner scores. */
  responsiblePitcherId: string
  reachedBy: BaseballReachKind
  /** Default earned-run eligibility before recorder overrides. */
  unearned: boolean
}

export interface BaseballBases {
  first: BaseballRunner | null
  second: BaseballRunner | null
  third: BaseballRunner | null
}

export interface BaseballSideLineup {
  /** Current occupant of each batting slot (participant ids or opponent slot ids). */
  battingOrder: string[]
  nextBatterIndex: number
  /** Fielding number key -> participant id. Opponent defense is not tracked. */
  defense: Record<string, string>
  pitcherId: string
  /** Everyone who has appeared (started or entered). */
  appearedIds: string[]
  starterIds: string[]
  removedIds: string[]
  reenteredIds: string[]
}

export interface BaseballBattingLine {
  pa: number
  ab: number
  h: number
  singles: number
  doubles: number
  triples: number
  hr: number
  r: number
  rbi: number
  bb: number
  ibb: number
  hbp: number
  k: number
  kLooking: number
  sh: number
  sf: number
  roe: number
  fc: number
  gidp: number
  ci: number
  tb: number
  sb: number
  cs: number
  pickedOff: number
  pitchesSeen: number
}

export interface BaseballPitchingLine {
  pitcherId: string
  side: BaseballTeamSide
  outs: number
  bf: number
  pitches: number
  strikes: number
  balls: number
  firstPitchStrikes: number
  h: number
  r: number
  er: number
  bb: number
  ibb: number
  k: number
  hbp: number
  wp: number
  bk: number
  hr: number
  inheritedRunners: number
  inheritedRunnersScored: number
  /** Plate appearances whose pitches were not tracked. */
  untrackedPlateAppearances: number
}

export interface BaseballFieldingLine {
  po: number
  a: number
  e: number
  dp: number
  pb: number
  sbAllowed: number
  cs: number
}

export interface BaseballHalfInningLine {
  inning: number
  half: BaseballHalf
  battingSide: BaseballTeamSide
  runs: number
  hits: number
  /** Errors committed by the fielding side during this half. */
  errors: number
  leftOnBase: number
  complete: boolean
}

export type BaseballPlateAppearanceOutcome =
  | 'walk'
  | 'intentional_walk'
  | 'hit_by_pitch'
  | 'strikeout'
  | 'catcher_interference'
  | BaseballInPlayResult

export interface BaseballPlateAppearanceRecord {
  eventId: string
  inning: number
  half: BaseballHalf
  battingSide: BaseballTeamSide
  batterId: string
  pitcherId: string
  outcome: BaseballPlateAppearanceOutcome
  pitches: number
  pitchesTracked: boolean
  runs: number
  rbi: number
  location: GameEventLocation | null
}

export type BaseballPendingEnd = 'regulation' | 'walk_off' | 'run_rule' | null

export interface BaseballMatchResult {
  outcome: BaseballGameEndOutcome
  winner: BaseballTeamSide | 'tie' | null
  note: string | null
}

export type BaseballMatchStatus = 'pregame' | 'in_progress' | 'final' | 'suspended' | 'abandoned'

export interface BaseballMatchProjection {
  status: BaseballMatchStatus
  inning: number
  half: BaseballHalf
  battingSide: BaseballTeamSide
  outs: number
  balls: number
  strikes: number
  pitchesInPlateAppearance: number
  /** Plate appearance currently in progress, keyed to the batter who started it. */
  currentBatterId: string | null
  bases: BaseballBases
  lineups: { tracked: BaseballSideLineup; opponent: BaseballSideLineup }
  score: { tracked: number; opponent: number }
  lineScore: BaseballHalfInningLine[]
  battingLines: Record<string, BaseballBattingLine>
  pitchingLines: Record<string, BaseballPitchingLine>
  fieldingLines: Record<string, BaseballFieldingLine>
  plateAppearances: BaseballPlateAppearanceRecord[]
  /** A legal game ending is available and further play is blocked until it is recorded. */
  opponentSlotDetails: Record<string, BaseballOpponentSlot>
  opponentPitchers: Record<string, BaseballOpponentPitcher>
  pendingEnd: BaseballPendingEnd
  result: BaseballMatchResult | null
  warnings: string[]
}

export interface BaseballCapturePreferences {
  trackPitchLocation: boolean
  trackBattedBallLocation: boolean
}

export interface BaseballSportGameState {
  sportId: 'baseball'
  version: typeof BASEBALL_GAME_STATE_VERSION
  setup: BaseballMatchSetup
  projection: BaseballMatchProjection
  capturePreferences: BaseballCapturePreferences
}
