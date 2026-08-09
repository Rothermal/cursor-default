import { isPlainObject } from '../gameEvents/envelope'
import {
  normalizeBasketballMatchRules,
  normalizeBasketballRulesSource,
} from './rules'
import type {
  BasketballCapturePreferences,
  BasketballCourtUndoReceipt,
  BasketballCourtUndoReceiptEntry,
  BasketballMatchParticipant,
  BasketballMatchProjection,
  BasketballMatchSetup,
  BasketballProjectedParticipant,
  BasketballSportGameState,
  BasketballStatTotals,
  BasketballTeamStatTotals,
} from './types'
import { BASKETBALL_GAME_STATE_VERSION } from './types'

export function createBasketballMatchProjection(
  setup: BasketballMatchSetup
): BasketballMatchProjection {
  return {
    status: 'not_started',
    currentPeriodId: null,
    periods: [],
    startedPeriodIds: [],
    completedPeriodIds: [],
    participants: Object.fromEntries(
      setup.participants.map(participant => [participant.id, projectedParticipant(participant, false)])
    ),
    sideStats: {
      tracked: emptyBasketballStatTotals(),
      opponent: emptyBasketballStatTotals(),
    },
    teamActorStats: {
      tracked: emptyBasketballTeamStatTotals(),
      opponent: emptyBasketballTeamStatTotals(),
    },
    periodTeamFouls: {},
    periodTimeouts: {},
    bonusStatusByPeriod: {},
    neutralTimeouts: 0,
    ejections: [],
    score: { tracked: 0, opponent: 0 },
    relationshipWarnings: [],
    endedAt: null,
    endReason: null,
    result: 'unresolved',
  }
}

export function createBasketballSportGameState(
  setup: BasketballMatchSetup
): BasketballSportGameState {
  const error = validateBasketballMatchSetup(setup)
  if (error) throw new Error(error)
  const clonedSetup = structuredClone(setup)
  return {
    sportId: 'basketball',
    version: BASKETBALL_GAME_STATE_VERSION,
    setup: clonedSetup,
    projection: createBasketballMatchProjection(clonedSetup),
    capturePreferences: defaultBasketballCapturePreferences(),
  }
}

export function normalizeBasketballSportGameState(value: unknown): BasketballSportGameState | null {
  if (
    !isPlainObject(value) ||
    value.sportId !== 'basketball' ||
    value.version !== BASKETBALL_GAME_STATE_VERSION ||
    !isPlainObject(value.setup)
  ) return null

  const rulesSnapshot = normalizeBasketballMatchRules(value.setup.rulesSnapshot)
  const rulesSource = normalizeBasketballRulesSource(value.setup.rulesSource)
  if (!rulesSnapshot || !rulesSource || !Array.isArray(value.setup.participants)) return null

  const setup: BasketballMatchSetup = {
    version: 1,
    trackedTeamDesignation: value.setup.trackedTeamDesignation as BasketballMatchSetup['trackedTeamDesignation'],
    sourceTeamId: value.setup.sourceTeamId as string | null,
    sourceSeasonId: value.setup.sourceSeasonId as string | null,
    rulesSource,
    rulesSnapshot,
    participants: value.setup.participants as unknown as BasketballMatchParticipant[],
  }
  if (validateBasketballMatchSetup(setup)) return null
  const clonedSetup = structuredClone(setup)
  return {
    sportId: 'basketball',
    version: BASKETBALL_GAME_STATE_VERSION,
    setup: clonedSetup,
    projection: createBasketballMatchProjection(clonedSetup),
    capturePreferences: normalizeCapturePreferences(value.capturePreferences),
  }
}

export function validateBasketballMatchSetup(value: unknown): string | null {
  if (!isPlainObject(value)) return 'Basketball setup must be an object.'
  if (value.version !== 1) return 'Basketball setup version is unsupported.'
  if (!['home', 'away', 'neutral'].includes(String(value.trackedTeamDesignation))) {
    return 'Tracked-team designation is invalid.'
  }
  if (!isNullableString(value.sourceTeamId) || !isNullableString(value.sourceSeasonId)) {
    return 'Basketball setup source ids are invalid.'
  }
  if (!normalizeBasketballRulesSource(value.rulesSource)) return 'Basketball rules source is invalid.'
  if (!normalizeBasketballMatchRules(value.rulesSnapshot)) return 'Basketball rules snapshot is invalid.'
  if (!Array.isArray(value.participants) || !value.participants.every(isBasketballMatchParticipant)) {
    return 'Basketball participants are invalid.'
  }
  const participants = value.participants as BasketballMatchParticipant[]
  if (new Set(participants.map(participant => participant.id)).size !== participants.length) {
    return 'Basketball participant ids must be unique.'
  }
  const playerIds = participants
    .map(participant => participant.playerId)
    .filter((playerId): playerId is string => playerId !== null)
  if (new Set(playerIds).size !== playerIds.length) {
    return 'Resolved Basketball player ids must be unique.'
  }
  return null
}

export function isBasketballMatchParticipant(value: unknown): value is BasketballMatchParticipant {
  return Boolean(
    isPlainObject(value) &&
      isNonEmptyString(value.id) &&
      isNullableString(value.playerId) &&
      isNonEmptyString(value.displayName) &&
      isNullableString(value.number) &&
      (value.teamSide === 'tracked' || value.teamSide === 'opponent') &&
      ['starter', 'bench', 'dnp'].includes(String(value.initialStatus)) &&
      isNullableString(value.position) &&
      typeof value.captain === 'boolean'
  )
}

export function defaultBasketballCapturePreferences(): BasketballCapturePreferences {
  return {
    teamSide: 'tracked',
    selectedParticipantId: null,
    selectionInitialized: false,
    shotValueOverride: null,
    courtOrientation: 'standard',
    lastCourtUndo: null,
  }
}

export function emptyBasketballStatTotals(): BasketballStatTotals {
  return {
    ft: 0,
    ft_miss: 0,
    '2pt': 0,
    '2pt_miss': 0,
    '3pt': 0,
    '3pt_miss': 0,
    oreb: 0,
    dreb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    to: 0,
    pf: 0,
    min: 0,
  }
}

export function emptyBasketballTeamStatTotals(): BasketballTeamStatTotals {
  return {
    ...emptyBasketballStatTotals(),
    team_turnover: 0,
    team_tech: 0,
  }
}

export function projectedBasketballParticipant(
  participant: BasketballMatchParticipant,
  lateAdded: boolean
): BasketballProjectedParticipant {
  return projectedParticipant(participant, lateAdded)
}

function normalizeCapturePreferences(value: unknown): BasketballCapturePreferences {
  const defaults = defaultBasketballCapturePreferences()
  if (!isPlainObject(value)) return defaults
  return {
    teamSide: value.teamSide === 'opponent' ? 'opponent' : 'tracked',
    selectedParticipantId:
      typeof value.selectedParticipantId === 'string' ? value.selectedParticipantId : null,
    selectionInitialized: value.selectionInitialized === true,
    shotValueOverride: value.shotValueOverride === 2 || value.shotValueOverride === 3
      ? value.shotValueOverride
      : null,
    courtOrientation: value.courtOrientation === 'flipped' ? 'flipped' : 'standard',
    lastCourtUndo: normalizeBasketballCourtUndoReceipt(value.lastCourtUndo),
  }
}

export function normalizeBasketballCourtUndoReceipt(
  value: unknown
): BasketballCourtUndoReceipt | null {
  if (
    !isPlainObject(value) ||
    (value.kind !== 'capture_undo' &&
      value.kind !== 'clear_chart' &&
      value.kind !== 'direct_decrement' &&
      value.kind !== 'administrative_decrement') ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Array.isArray(value.entries) ||
    value.entries.length === 0
  ) return null

  const entries: BasketballCourtUndoReceiptEntry[] = []
  const eventIds = new Set<string>()
  for (const candidate of value.entries) {
    if (
      !isPlainObject(candidate) ||
      !isNonEmptyString(candidate.eventId) ||
      eventIds.has(candidate.eventId) ||
      !Number.isInteger(candidate.expectedRevision) ||
      Number(candidate.expectedRevision) < 2 ||
      ![
        'restore',
        'relink_block',
        'relink_trip_foul',
        'relink_ejection_foul',
        'relink_attempt_trip',
      ].includes(String(candidate.action)) ||
      !(candidate.previousRelatedEventId === null || isNonEmptyString(candidate.previousRelatedEventId)) ||
      (candidate.action === 'restore' && candidate.previousRelatedEventId !== null) ||
      (candidate.action !== 'restore' && candidate.previousRelatedEventId === null) ||
      !(
        candidate.previousAttemptNumber === undefined ||
        candidate.previousAttemptNumber === null ||
        (Number.isInteger(candidate.previousAttemptNumber) && Number(candidate.previousAttemptNumber) > 0)
      ) ||
      (candidate.action === 'relink_attempt_trip' && !Number.isInteger(candidate.previousAttemptNumber)) ||
      (candidate.action !== 'relink_attempt_trip' && candidate.previousAttemptNumber != null)
    ) return null
    eventIds.add(candidate.eventId)
    entries.push({
      eventId: candidate.eventId,
      expectedRevision: Number(candidate.expectedRevision),
      action: candidate.action as BasketballCourtUndoReceiptEntry['action'],
      previousRelatedEventId: candidate.previousRelatedEventId,
      previousAttemptNumber: candidate.previousAttemptNumber == null
        ? null
        : Number(candidate.previousAttemptNumber),
    })
  }

  if (value.kind === 'capture_undo' && entries.some(entry => entry.action !== 'restore')) {
    return null
  }
  const restoredIds = new Set(
    entries.filter(entry => entry.action === 'restore').map(entry => entry.eventId)
  )
  if (entries.some(
    entry => entry.action !== 'restore' &&
      (!entry.previousRelatedEventId || !restoredIds.has(entry.previousRelatedEventId))
  )) return null

  return {
    kind: value.kind,
    createdAt: value.createdAt,
    entries,
  }
}

function projectedParticipant(
  participant: BasketballMatchParticipant,
  lateAdded: boolean
): BasketballProjectedParticipant {
  return {
    participantId: participant.id,
    playerId: participant.playerId,
    displayName: participant.displayName,
    number: participant.number,
    teamSide: participant.teamSide,
    openingStatus: participant.initialStatus,
    position: participant.position,
    captain: participant.captain,
    lateAdded,
    stats: emptyBasketballStatTotals(),
    disqualified: false,
    ejected: false,
  }
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
