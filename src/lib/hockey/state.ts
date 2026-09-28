import { isPlainObject } from '../gameEvents/envelope'
import { normalizeHockeyMatchSetup } from './setup'
import type {
  HockeyMatchProjection,
  HockeyMatchSetup,
  HockeyPreferences,
  HockeySportGameState,
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
  return { rinkFlipped: false }
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
  // A cache from before HKY-2B lacks the capture fields; the projector rebuilds it either way.
  const cachedProjection = isPlainObject(value.projection) &&
    typeof value.projection.status === 'string' &&
    Array.isArray(value.projection.periods) &&
    isPlainObject(value.projection.goalieInNet) &&
    Array.isArray(value.projection.warnings)
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
  return { rinkFlipped: typeof value.rinkFlipped === 'boolean' ? value.rinkFlipped : defaults.rinkFlipped }
}
