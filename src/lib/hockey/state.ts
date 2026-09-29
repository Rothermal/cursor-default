import { isPlainObject } from '../gameEvents/envelope'
import { normalizeHockeyMatchSetup } from './setup'
import type {
  HockeyFaceoffTotals,
  HockeyMatchProjection,
  HockeyMatchSetup,
  HockeyPreferences,
  HockeySportGameState,
  HockeyUndoReceipt,
} from './types'
import { HOCKEY_GAME_STATE_VERSION } from './types'

export function createHockeySportGameState(setup: HockeyMatchSetup): HockeySportGameState {
  return {
    sportId: 'hockey',
    version: HOCKEY_GAME_STATE_VERSION,
    setup: structuredClone(setup),
    projection: createHockeyMatchProjection(setup),
    capturePreferences: defaultHockeyPreferences(),
  }
}

export function defaultHockeyPreferences(): HockeyPreferences {
  return { rinkFlipped: false, lastUndo: null }
}

export function createHockeyMatchProjection(setup: HockeyMatchSetup): HockeyMatchProjection {
  return {
    status: 'pregame',
    statusReason: null,
    lineupRecorded: false,
    periods: [],
    activePeriodId: null,
    nextPeriod: null,
    canEndWithoutReason: false,
    clock: setup.rulesSnapshot.clockModel === 'anchored'
      ? {
          periodId: null,
          running: false,
          elapsedMs: 0,
          anchorElapsedMs: null,
          anchorOccurredAt: null,
          expired: false,
        }
      : null,
    score: { tracked: 0, opponent: 0 },
    trackedAttackingDirection: null,
    periodTotals: {},
    shotsOnGoal: { tracked: 0, opponent: 0 },
    goalieInNet: { tracked: null, opponent: null },
    goalieIntervals: [],
    opponentGoalies: [structuredClone(setup.opponentGoalie)],
    decidedInPeriodId: null,
    warnings: [],
    faceoffs: emptyHockeyFaceoffTotals(),
    lastTrackedFaceoffTakerId: null,
    hits: { tracked: 0, opponent: 0 },
    takeaways: { tracked: 0, opponent: 0 },
    giveaways: { tracked: 0, opponent: 0 },
    penalties: [],
    penaltyReleases: [],
    penaltyTotals: { tracked: { penalties: 0, pimMs: 0 }, opponent: { penalties: 0, pimMs: 0 } },
    removedParticipantIds: [],
  }
}

export function emptyHockeyFaceoffTotals(): HockeyFaceoffTotals {
  return {
    won: 0,
    lost: 0,
    byZone: {
      offensive: { won: 0, lost: 0 },
      neutral: { won: 0, lost: 0 },
      defensive: { won: 0, lost: 0 },
    },
  }
}

/**
 * Strict on sport id, version and setup. The persisted projection is only a cache that
 * the event projector rebuilds; a missing or malformed copy falls back to pregame.
 */
export function normalizeHockeySportGameState(value: unknown): HockeySportGameState | null {
  if (!isPlainObject(value)) return null
  if (value.sportId !== 'hockey' || value.version !== HOCKEY_GAME_STATE_VERSION) return null
  const setup = normalizeHockeyMatchSetup(value.setup)
  if (!setup) return null
  // A cache from before HKY-2B, HKY-2C or HKY-3A lacks the capture fields; the projector rebuilds it either way.
  const cachedProjection = isPlainObject(value.projection) &&
    typeof value.projection.status === 'string' &&
    Array.isArray(value.projection.periods) &&
    isPlainObject(value.projection.goalieInNet) &&
    Array.isArray(value.projection.warnings) &&
    isPlainObject(value.projection.faceoffs) &&
    Array.isArray(value.projection.penalties) &&
    Array.isArray(value.projection.removedParticipantIds)
  return {
    sportId: 'hockey',
    version: HOCKEY_GAME_STATE_VERSION,
    setup,
    projection: cachedProjection
      ? (structuredClone(value.projection) as unknown as HockeyMatchProjection)
      : createHockeyMatchProjection(setup),
    capturePreferences: normalizePreferences(value.capturePreferences),
  }
}

function normalizePreferences(value: unknown): HockeyPreferences {
  const defaults = defaultHockeyPreferences()
  if (!isPlainObject(value)) return defaults
  return {
    rinkFlipped: typeof value.rinkFlipped === 'boolean' ? value.rinkFlipped : defaults.rinkFlipped,
    lastUndo: normalizeUndoReceipt(value.lastUndo),
  }
}

/** A malformed receipt is dropped rather than trusted; Restore re-checks each event anyway. */
function normalizeUndoReceipt(value: unknown): HockeyUndoReceipt | null {
  if (!isPlainObject(value) || typeof value.createdAt !== 'string' || !Array.isArray(value.entries)) return null
  if (value.entries.length === 0) return null
  const entries: HockeyUndoReceipt['entries'] = []
  for (const entry of value.entries) {
    if (
      !isPlainObject(entry) ||
      typeof entry.eventId !== 'string' ||
      typeof entry.expectedRevision !== 'number' ||
      !Number.isInteger(entry.expectedRevision)
    ) return null
    entries.push({ eventId: entry.eventId, expectedRevision: entry.expectedRevision })
  }
  return { createdAt: value.createdAt, entries }
}
