import type { GameEvent, JsonObject } from '../gameEvents/types'

export const SOCCER_GAME_STATE_VERSION = 1
export const SOCCER_EVENT_SCHEMA_VERSION = 1

export type SoccerTrackedTeamDesignation = 'home' | 'away' | 'neutral'
export type SoccerAttackingDirection = 'left_to_right' | 'right_to_left'
export type SoccerClockDirection = 'count_up' | 'count_down'
export type SoccerClockDisplay = 'continuous' | 'per_period'
export type SoccerParticipantKind = 'player' | 'anonymous'
export type SoccerRosterStatus = 'starter' | 'bench'
export type SoccerRoleGroup = 'goalkeeper' | 'defender' | 'midfielder' | 'forward' | 'custom'
export type SoccerSegmentKind = 'regulation' | 'extra_time'
export type SoccerShotOutcome = 'goal' | 'saved' | 'blocked' | 'off_target' | 'woodwork'
export type SoccerShotSituation =
  | 'open_play'
  | 'penalty'
  | 'direct_free_kick'
  | 'corner_sequence'
  | 'other_set_piece'

export interface SoccerRole extends JsonObject {
  group: SoccerRoleGroup
  label: string | null
}

export interface SoccerMatchSegment extends JsonObject {
  id: string
  label: string
  kind: SoccerSegmentKind
  order: number
  durationMs: number
}

export interface SoccerMatchRules extends JsonObject {
  regulationSegments: SoccerMatchSegment[]
  extraTimeSegments: SoccerMatchSegment[]
  extraTimeAvailable: boolean
  shootoutAvailable: boolean
  clockDirection: SoccerClockDirection
  clockDisplay: SoccerClockDisplay
  maxOnFieldPlayers: number
  allowReturnSubstitutions: boolean
  substitutionLimit: number | null
  substitutionWindowLimit: number | null
  maxAssistsPerGoal: number
}

export interface SoccerMatchParticipant extends JsonObject {
  id: string
  kind: SoccerParticipantKind
  playerId: string | null
  displayName: string
  number: string | null
  initialStatus: SoccerRosterStatus
  initialRole: SoccerRole
}

export interface SoccerMatchSetup {
  version: 1
  trackedTeamDesignation: SoccerTrackedTeamDesignation
  firstPeriodAttackingDirection: SoccerAttackingDirection
  sourceTeamId: string | null
  sourceSeasonId: string | null
  rulesSnapshot: SoccerMatchRules
  participants: SoccerMatchParticipant[]
}

export type SoccerMatchStatus = 'not_started' | 'in_progress' | 'period_break' | 'ended'
export type SoccerParticipantStatus = 'bench' | 'on_field' | 'left'

export interface SoccerProjectedParticipant {
  participantId: string
  playerId: string | null
  displayName: string
  number: string | null
  status: SoccerParticipantStatus
  role: SoccerRole
  started: boolean
  appearances: number
  totalActiveMs: number
  activeSinceElapsedMs: number | null
  onFieldIntervals: SoccerOnFieldInterval[]
  roleIntervals: SoccerRoleInterval[]
  hasExited: boolean
}

export interface SoccerOnFieldInterval {
  periodId: string
  startElapsedMs: number
  endElapsedMs: number | null
}

export interface SoccerRoleInterval extends SoccerOnFieldInterval {
  role: SoccerRole
}

export interface SoccerParticipantStatTotals {
  goals: number
  ownGoals: number
  primaryAssists: number
  secondaryAssists: number
  shots: number
  shotsOnTarget: number
  keyPasses: number
  penaltyAttempts: number
  penaltyGoals: number
  directFreeKickAttempts: number
  directFreeKickGoals: number
  goalkeeperSaves: number
  goalkeeperGoalsAllowed: number
  goalkeeperShotsOnTargetFaced: number
  goalkeeperPenaltiesFaced: number
  goalkeeperPenaltySaves: number
}

export interface SoccerSideAttackingTotals {
  score: number
  shots: number
  shotsOnTarget: number
  goals: number
  saved: number
  blocked: number
  offTarget: number
  woodwork: number
  penaltyAttempts: number
  penaltyGoals: number
  directFreeKickAttempts: number
  directFreeKickGoals: number
}

export interface SoccerProjectedClock {
  running: boolean
  elapsedMs: number
  anchorOccurredAt: string | null
}

export interface SoccerMatchProjection {
  status: SoccerMatchStatus
  openingLineupRecorded: boolean
  currentPeriodId: string | null
  startedPeriodIds: string[]
  completedPeriodIds: string[]
  periodEndElapsedMsById: Record<string, number>
  clock: SoccerProjectedClock
  participants: Record<string, SoccerProjectedParticipant>
  participantStats: Record<string, SoccerParticipantStatTotals>
  sideTotals: {
    tracked: SoccerSideAttackingTotals
    opponent: SoccerSideAttackingTotals
  }
  currentRules: SoccerMatchRules
  firstPeriodAttackingDirection: SoccerAttackingDirection
  attackingDirection: SoccerAttackingDirection
  substitutionCount: number
  substitutionWindowCount: number
  endedAt: string | null
}

export interface SoccerSportGameState {
  sportId: 'soccer'
  version: 1
  setup: SoccerMatchSetup
  projection: SoccerMatchProjection
}

export type SportGameState = SoccerSportGameState

export interface SoccerLineupEntry extends JsonObject {
  participantId: string
  role: SoccerRole
}

export interface SoccerOpeningLineupPayload extends JsonObject {
  starters: SoccerLineupEntry[]
}

export interface SoccerPeriodPayload extends JsonObject {
  periodId: string
}

export interface SoccerClockStartedPayload extends JsonObject {
  anchorElapsedMs: number
}

export interface SoccerClockPausedPayload extends JsonObject {
  elapsedMs: number
}

export interface SoccerClockAdjustedPayload extends JsonObject {
  fromElapsedMs: number
  toElapsedMs: number
}

export interface SoccerMatchRulesChangedPayload extends JsonObject {
  rules: SoccerMatchRules
}

export interface SoccerSubstitutionChange extends JsonObject {
  playerOutParticipantId: string | null
  playerInParticipantId: string | null
  playerInRole: SoccerRole | null
}

export interface SoccerSubstitutionWindowPayload extends JsonObject {
  changes: SoccerSubstitutionChange[]
  halftime: boolean
}

export interface SoccerRoleChange extends JsonObject {
  participantId: string
  role: SoccerRole
}

export interface SoccerRoleChangedPayload extends JsonObject {
  changes: SoccerRoleChange[]
}

export interface SoccerAttackingDirectionChangedPayload extends JsonObject {
  direction: SoccerAttackingDirection
}

export interface SoccerMatchRosterAddedPayload extends JsonObject {
  participant: SoccerMatchParticipant
  destination: 'bench' | 'on_field'
}

export interface SoccerParticipantResolvedPayload extends JsonObject {
  participantId: string
  playerId: string
  displayName: string
  number: string | null
}

export interface SoccerMatchEndedPayload extends JsonObject {
  reason: 'completed' | 'suspended' | 'abandoned'
}

export interface SoccerMatchReopenedPayload extends JsonObject {
  reason: string | null
}

export interface SoccerShotPayload extends JsonObject {
  outcome: SoccerShotOutcome
  situation: SoccerShotSituation
}

export type SoccerOwnGoalPayload = Record<string, never>

export interface SoccerScoreAdjustmentPayload extends JsonObject {
  delta: 1 | -1
  reason: string
}

export type SoccerOpeningLineupEvent = GameEvent<SoccerOpeningLineupPayload, 'soccer.opening_lineup', 'soccer'>
export type SoccerPeriodStartedEvent = GameEvent<SoccerPeriodPayload, 'soccer.period_started', 'soccer'>
export type SoccerPeriodEndedEvent = GameEvent<SoccerPeriodPayload, 'soccer.period_ended', 'soccer'>
export type SoccerClockStartedEvent = GameEvent<SoccerClockStartedPayload, 'soccer.clock_started', 'soccer'>
export type SoccerClockPausedEvent = GameEvent<SoccerClockPausedPayload, 'soccer.clock_paused', 'soccer'>
export type SoccerClockAdjustedEvent = GameEvent<SoccerClockAdjustedPayload, 'soccer.clock_adjusted', 'soccer'>
export type SoccerMatchRulesChangedEvent = GameEvent<SoccerMatchRulesChangedPayload, 'soccer.match_rules_changed', 'soccer'>
export type SoccerSubstitutionWindowEvent = GameEvent<SoccerSubstitutionWindowPayload, 'soccer.substitution_window', 'soccer'>
export type SoccerRoleChangedEvent = GameEvent<SoccerRoleChangedPayload, 'soccer.role_changed', 'soccer'>
export type SoccerAttackingDirectionChangedEvent = GameEvent<SoccerAttackingDirectionChangedPayload, 'soccer.attacking_direction_changed', 'soccer'>
export type SoccerMatchRosterAddedEvent = GameEvent<SoccerMatchRosterAddedPayload, 'soccer.match_roster_added', 'soccer'>
export type SoccerParticipantResolvedEvent = GameEvent<SoccerParticipantResolvedPayload, 'soccer.participant_resolved', 'soccer'>
export type SoccerMatchEndedEvent = GameEvent<SoccerMatchEndedPayload, 'soccer.match_ended', 'soccer'>
export type SoccerMatchReopenedEvent = GameEvent<SoccerMatchReopenedPayload, 'soccer.match_reopened', 'soccer'>
export type SoccerShotEvent = GameEvent<SoccerShotPayload, 'soccer.shot', 'soccer'>
export type SoccerOwnGoalEvent = GameEvent<SoccerOwnGoalPayload, 'soccer.own_goal', 'soccer'>
export type SoccerScoreAdjustmentEvent = GameEvent<SoccerScoreAdjustmentPayload, 'soccer.score_adjustment', 'soccer'>

export type SoccerMatchEvent =
  | SoccerOpeningLineupEvent
  | SoccerPeriodStartedEvent
  | SoccerPeriodEndedEvent
  | SoccerClockStartedEvent
  | SoccerClockPausedEvent
  | SoccerClockAdjustedEvent
  | SoccerMatchRulesChangedEvent
  | SoccerSubstitutionWindowEvent
  | SoccerRoleChangedEvent
  | SoccerAttackingDirectionChangedEvent
  | SoccerMatchRosterAddedEvent
  | SoccerParticipantResolvedEvent
  | SoccerMatchEndedEvent
  | SoccerMatchReopenedEvent
  | SoccerShotEvent
  | SoccerOwnGoalEvent
  | SoccerScoreAdjustmentEvent
