import { isPlainObject } from '../gameEvents/envelope'
import { normalizeSoccerMatchRules, validateSoccerMatchRules, validateSoccerRole } from './rules'
import type {
  SoccerAttackingDirection,
  SoccerMatchParticipant,
  SoccerMatchProjection,
  SoccerMatchSetup,
  SoccerProjectedParticipant,
  SoccerSportGameState,
} from './types'
import { SOCCER_GAME_STATE_VERSION } from './types'

export function createSoccerMatchProjection(setup: SoccerMatchSetup): SoccerMatchProjection {
  return {
    status: 'not_started',
    openingLineupRecorded: false,
    currentPeriodId: null,
    startedPeriodIds: [],
    completedPeriodIds: [],
    periodEndElapsedMsById: {},
    clock: { running: false, elapsedMs: 0, anchorOccurredAt: null },
    participants: Object.fromEntries(
      setup.participants.map(participant => [participant.id, projectedParticipant(participant)])
    ),
    participantStats: Object.fromEntries(
      setup.participants.map(participant => [participant.id, emptyParticipantStats()])
    ),
    participantDiscipline: Object.fromEntries(
      setup.participants.map(participant => [participant.id, emptyParticipantDiscipline()])
    ),
    sideTotals: {
      tracked: emptySideTotals(),
      opponent: emptySideTotals(),
    },
    currentRules: structuredClone(setup.rulesSnapshot),
    firstPeriodAttackingDirection: setup.firstPeriodAttackingDirection,
    attackingDirection: setup.firstPeriodAttackingDirection,
    substitutionCount: 0,
    substitutionWindowCount: 0,
    endedAt: null,
    endReason: null,
    suspendedContext: null,
    result: 'unresolved',
    decidedStage: null,
    shootout: null,
  }
}

export function createSoccerSportGameState(setup: SoccerMatchSetup): SoccerSportGameState {
  const error = validateSoccerMatchSetup(setup)
  if (error) throw new Error(error)
  const clonedSetup = structuredClone(setup)
  return {
    sportId: 'soccer',
    version: SOCCER_GAME_STATE_VERSION,
    setup: clonedSetup,
    projection: createSoccerMatchProjection(clonedSetup),
    capturePreferences: {
      teamSide: 'tracked',
      selectedParticipantId: null,
      selectionInitialized: false,
      captureMode: 'shot',
    },
  }
}

export function normalizeSoccerSportGameState(value: unknown): SoccerSportGameState | null {
  if (
    !isPlainObject(value) ||
    value.sportId !== 'soccer' ||
    (value.version !== 1 && value.version !== SOCCER_GAME_STATE_VERSION)
  ) return null
  if (!isPlainObject(value.setup)) return null
  const normalizedRules = normalizeSoccerMatchRules(value.setup.rulesSnapshot)
  if (!normalizedRules) return null
  const setup = {
    ...value.setup,
    rulesSnapshot: normalizedRules,
  } as unknown as SoccerMatchSetup
  if (validateSoccerMatchSetup(setup)) return null
  const normalized = createSoccerSportGameState(setup)
  if (isPlainObject(value.capturePreferences)) {
    const preferences = value.capturePreferences
    if (preferences.teamSide === 'tracked' || preferences.teamSide === 'opponent') {
      normalized.capturePreferences.teamSide = preferences.teamSide
    }
    if (preferences.selectedParticipantId === null || typeof preferences.selectedParticipantId === 'string') {
      normalized.capturePreferences.selectedParticipantId = preferences.selectedParticipantId
    }
    if (typeof preferences.selectionInitialized === 'boolean') {
      normalized.capturePreferences.selectionInitialized = preferences.selectionInitialized
    }
    if (preferences.captureMode === 'shot' || preferences.captureMode === 'defense' || preferences.captureMode === 'foul') {
      normalized.capturePreferences.captureMode = preferences.captureMode
    }
  }
  return normalized
}

export function validateSoccerMatchSetup(value: unknown): string | null {
  if (!isPlainObject(value) || value.version !== 1) return 'Soccer setup version is invalid.'
  if (!['home', 'away', 'neutral'].includes(String(value.trackedTeamDesignation))) {
    return 'Tracked-team designation is invalid.'
  }
  if (!isDirection(value.firstPeriodAttackingDirection)) return 'First-period direction is invalid.'
  if (value.sourceTeamId !== null && typeof value.sourceTeamId !== 'string') {
    return 'Source team id is invalid.'
  }
  if (value.sourceSeasonId !== null && typeof value.sourceSeasonId !== 'string') {
    return 'Source season id is invalid.'
  }
  const rulesError = validateSoccerMatchRules(value.rulesSnapshot)
  if (rulesError) return rulesError
  if (!Array.isArray(value.participants) || !value.participants.every(validateParticipant)) {
    return 'Every soccer match participant must be valid.'
  }
  const ids = value.participants.map(participant => participant.id)
  if (new Set(ids).size !== ids.length) return 'Soccer participant ids must be unique.'
  const playerIds = value.participants
    .map(participant => participant.playerId)
    .filter((playerId): playerId is string => playerId !== null)
  if (new Set(playerIds).size !== playerIds.length) {
    return 'A roster player cannot appear more than once in the match roster.'
  }
  return null
}

export function isSoccerMatchParticipant(value: unknown): value is SoccerMatchParticipant {
  return validateParticipant(value)
}

export function elapsedSoccerClockMs(
  projection: SoccerMatchProjection,
  nowMs = Date.now()
): number {
  if (!projection.clock.running || !projection.clock.anchorOccurredAt) {
    return projection.clock.elapsedMs
  }
  const anchorMs = Date.parse(projection.clock.anchorOccurredAt)
  if (!Number.isFinite(anchorMs)) return projection.clock.elapsedMs
  return projection.clock.elapsedMs + Math.max(0, nowMs - anchorMs)
}

export function participantActiveMs(
  participant: SoccerProjectedParticipant,
  projection: SoccerMatchProjection,
  nowMs = Date.now()
): number {
  if (participant.activeSinceElapsedMs === null) return participant.totalActiveMs
  return participant.totalActiveMs + Math.max(
    0,
    elapsedSoccerClockMs(projection, nowMs) - participant.activeSinceElapsedMs
  )
}

function projectedParticipant(participant: SoccerMatchParticipant): SoccerProjectedParticipant {
  return {
    participantId: participant.id,
    playerId: participant.playerId,
    displayName: participant.displayName,
    number: participant.number,
    status: 'bench',
    role: structuredClone(participant.initialRole),
    started: false,
    appearances: 0,
    totalActiveMs: 0,
    activeSinceElapsedMs: null,
    onFieldIntervals: [],
    roleIntervals: [],
    hasExited: false,
  }
}

export function emptyParticipantStats(): SoccerMatchProjection['participantStats'][string] {
  return {
    goals: 0,
    ownGoals: 0,
    primaryAssists: 0,
    secondaryAssists: 0,
    shots: 0,
    shotsOnTarget: 0,
    keyPasses: 0,
    penaltyAttempts: 0,
    penaltyGoals: 0,
    directFreeKickAttempts: 0,
    directFreeKickGoals: 0,
    goalkeeperSaves: 0,
    goalkeeperGoalsAllowed: 0,
    goalkeeperShotsOnTargetFaced: 0,
    goalkeeperPenaltiesFaced: 0,
    goalkeeperPenaltySaves: 0,
    tacklesAttempted: 0,
    tacklesWon: 0,
    tacklesLost: 0,
    interceptions: 0,
    clearances: 0,
    recoveries: 0,
    blockedShots: 0,
    foulsCommitted: 0,
    foulsDrawn: 0,
    yellowCards: 0,
    redCards: 0,
  }
}

export function emptyParticipantDiscipline(): SoccerMatchProjection['participantDiscipline'][string] {
  return {
    normalYellowCards: 0,
    shootoutYellowCards: 0,
    redCards: 0,
    shootoutRedCards: 0,
    ejected: false,
  }
}

function emptySideTotals(): SoccerMatchProjection['sideTotals']['tracked'] {
  return {
    score: 0,
    shots: 0,
    shotsOnTarget: 0,
    goals: 0,
    saved: 0,
    blocked: 0,
    offTarget: 0,
    woodwork: 0,
    penaltyAttempts: 0,
    penaltyGoals: 0,
    directFreeKickAttempts: 0,
    directFreeKickGoals: 0,
    tacklesAttempted: 0,
    tacklesWon: 0,
    tacklesLost: 0,
    interceptions: 0,
    clearances: 0,
    recoveries: 0,
    blockedShots: 0,
    foulsCommitted: 0,
    foulsDrawn: 0,
    yellowCards: 0,
    redCards: 0,
    corners: 0,
    offsides: 0,
    penaltiesWon: 0,
    penaltiesConceded: 0,
    staffYellowCards: 0,
    staffRedCards: 0,
    teamAttributedDefensiveActions: 0,
    unknownAttributedDefensiveActions: 0,
    teamAttributedFouls: 0,
    unknownAttributedFouls: 0,
    teamAttributedCards: 0,
    unknownAttributedCards: 0,
  }
}

function validateParticipant(value: unknown): value is SoccerMatchParticipant {
  if (!isPlainObject(value)) return false
  if (typeof value.id !== 'string' || value.id.trim().length === 0) return false
  if (value.kind !== 'player' && value.kind !== 'anonymous') return false
  if (value.playerId !== null && (typeof value.playerId !== 'string' || value.playerId.trim().length === 0)) {
    return false
  }
  if (value.kind === 'player' && value.playerId === null) return false
  if (value.kind === 'anonymous' && value.playerId !== null) return false
  if (typeof value.displayName !== 'string' || value.displayName.trim().length === 0) return false
  if (value.number !== null && typeof value.number !== 'string') return false
  if (value.initialStatus !== 'starter' && value.initialStatus !== 'bench') return false
  return validateSoccerRole(value.initialRole)
}

function isDirection(value: unknown): value is SoccerAttackingDirection {
  return value === 'left_to_right' || value === 'right_to_left'
}
