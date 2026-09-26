import { isPlainObject } from '../gameEvents/envelope'
import { isBaseballFieldingNumber, normalizeBaseballPosition } from './positions'
import { normalizeBaseballMatchRules } from './rules'
import type {
  BaseballBatHand,
  BaseballCapturePreferences,
  BaseballMatchParticipant,
  BaseballMatchProjection,
  BaseballMatchRules,
  BaseballMatchSetup,
  BaseballOpponentPitcher,
  BaseballOpponentSlot,
  BaseballPitchHand,
  BaseballSideLineup,
  BaseballSportGameState,
  BaseballTrackedLineup,
} from './types'
import { BASEBALL_GAME_STATE_VERSION, BASEBALL_SETUP_VERSION } from './types'

const MAX_LABEL_LENGTH = 80

export type BaseballSetupValidation = { ok: true } | { ok: false; message: string }

export function createBaseballSportGameState(setup: BaseballMatchSetup): BaseballSportGameState {
  return {
    sportId: 'baseball',
    version: BASEBALL_GAME_STATE_VERSION,
    setup: structuredClone(setup),
    projection: createBaseballMatchProjection(setup),
    capturePreferences: defaultBaseballCapturePreferences(),
  }
}

export function defaultBaseballCapturePreferences(): BaseballCapturePreferences {
  return { trackPitchLocation: true, trackBattedBallLocation: true }
}

export function createBaseballMatchProjection(setup: BaseballMatchSetup): BaseballMatchProjection {
  const trackedBatsTop = setup.trackedSide === 'away'
  return {
    status: 'pregame',
    inning: 1,
    half: 'top',
    battingSide: trackedBatsTop ? 'tracked' : 'opponent',
    outs: 0,
    balls: setup.rulesSnapshot.startingBalls,
    strikes: setup.rulesSnapshot.startingStrikes,
    pitchesInPlateAppearance: 0,
    currentBatterId: null,
    bases: { first: null, second: null, third: null },
    lineups: {
      tracked: trackedLineupProjection(setup.trackedLineup),
      opponent: opponentLineupProjection(setup.opponentSlots, setup.opponentPitcher),
    },
    score: { tracked: 0, opponent: 0 },
    lineScore: [],
    battingLines: {},
    pitchingLines: {},
    fieldingLines: {},
    plateAppearances: [],
    opponentSlotDetails: Object.fromEntries(setup.opponentSlots.map(slot => [slot.id, { ...slot }])),
    opponentPitchers: { [setup.opponentPitcher.id]: { ...setup.opponentPitcher } },
    pendingEnd: null,
    result: null,
    warnings: [],
  }
}

function trackedLineupProjection(lineup: BaseballTrackedLineup): BaseballSideLineup {
  const starters = unique([...lineup.battingOrder, ...Object.values(lineup.defense)])
  return {
    battingOrder: [...lineup.battingOrder],
    nextBatterIndex: 0,
    defense: { ...lineup.defense },
    pitcherId: lineup.defense['1'],
    appearedIds: [...starters],
    starterIds: [...starters],
    removedIds: [],
    reenteredIds: [],
  }
}

function opponentLineupProjection(
  slots: BaseballOpponentSlot[],
  pitcher: BaseballOpponentPitcher
): BaseballSideLineup {
  return {
    battingOrder: slots.map(slot => slot.id),
    nextBatterIndex: 0,
    defense: { '1': pitcher.id },
    pitcherId: pitcher.id,
    appearedIds: [pitcher.id],
    starterIds: [pitcher.id],
    removedIds: [],
    reenteredIds: [],
  }
}

export function validateBaseballMatchSetup(setup: BaseballMatchSetup): BaseballSetupValidation {
  const rules = setup.rulesSnapshot
  const ids = new Set<string>()
  const claim = (id: string): boolean => {
    if (ids.has(id)) return false
    ids.add(id)
    return true
  }
  for (const participant of setup.participants) {
    if (!claim(participant.id)) return fail('Every participant needs a unique id.')
  }
  for (const slot of setup.opponentSlots) {
    if (!claim(slot.id)) return fail('Every opponent batting slot needs a unique id.')
  }
  if (!claim(setup.opponentPitcher.id)) return fail('The opponent pitcher needs a unique id.')
  if (setup.opponentSlots.length < 1 || setup.opponentSlots.length > 30) {
    return fail('The opponent needs between 1 and 30 batting slots.')
  }

  const participantIds = new Set(setup.participants.map(participant => participant.id))
  const order = setup.trackedLineup.battingOrder
  if (new Set(order).size !== order.length) return fail('A player can bat only once in the order.')
  if (!order.every(id => participantIds.has(id))) return fail('The batting order names an unknown player.')

  const defenseKeys = Object.keys(setup.trackedLineup.defense)
  const expectedKeys = Array.from({ length: rules.defensivePlayers }, (_, index) => String(index + 1))
  if (
    defenseKeys.length !== expectedKeys.length ||
    !expectedKeys.every(key => key in setup.trackedLineup.defense)
  ) {
    return fail(`Assign all ${rules.defensivePlayers} defensive positions.`)
  }
  const fielders = expectedKeys.map(key => setup.trackedLineup.defense[key])
  if (new Set(fielders).size !== fielders.length) return fail('A player can play only one position.')
  if (!fielders.every(id => participantIds.has(id))) return fail('The defense names an unknown player.')

  const pitcherId = setup.trackedLineup.defense['1']
  const nonFieldingBatters = order.filter(id => !fielders.includes(id))
  const fieldersNotBatting = fielders.filter(id => !order.includes(id))
  switch (rules.battingOrderFormat) {
    case 'standard':
      if (order.length !== rules.defensivePlayers || nonFieldingBatters.length > 0) {
        return fail('Every fielder bats once and nobody else bats.')
      }
      break
    case 'designated_hitter':
      if (order.length !== rules.defensivePlayers) {
        return fail(`The batting order needs ${rules.defensivePlayers} batters.`)
      }
      if (
        fieldersNotBatting.some(id => id !== pitcherId) ||
        nonFieldingBatters.length !== fieldersNotBatting.length
      ) {
        return fail('Only the pitcher may be replaced in the order by one designated hitter.')
      }
      break
    case 'extra_hitter':
      if (fieldersNotBatting.length > 0) return fail('Every fielder must bat.')
      if (nonFieldingBatters.length > rules.maxExtraHitters) {
        return fail(`At most ${rules.maxExtraHitters} extra hitters are allowed.`)
      }
      break
    case 'continuous':
      if (fieldersNotBatting.length > 0) return fail('Every fielder must bat.')
      break
  }
  return { ok: true }
}

function fail(message: string): BaseballSetupValidation {
  return { ok: false, message }
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function normalizeBaseballSportGameState(value: unknown): BaseballSportGameState | null {
  if (!isPlainObject(value)) return null
  if (value.sportId !== 'baseball' || value.version !== BASEBALL_GAME_STATE_VERSION) return null
  const setup = normalizeBaseballMatchSetup(value.setup)
  if (!setup) return null
  const preferences = normalizeCapturePreferences(value.capturePreferences)
  // The projection is always rebuilt from events; persisted copies are only a cache.
  const projection = isPlainObject(value.projection)
    ? (structuredClone(value.projection) as unknown as BaseballMatchProjection)
    : createBaseballMatchProjection(setup)
  return {
    sportId: 'baseball',
    version: BASEBALL_GAME_STATE_VERSION,
    setup,
    projection,
    capturePreferences: preferences,
  }
}

function normalizeCapturePreferences(value: unknown): BaseballCapturePreferences {
  const defaults = defaultBaseballCapturePreferences()
  if (!isPlainObject(value)) return defaults
  return {
    trackPitchLocation:
      typeof value.trackPitchLocation === 'boolean' ? value.trackPitchLocation : defaults.trackPitchLocation,
    trackBattedBallLocation:
      typeof value.trackBattedBallLocation === 'boolean'
        ? value.trackBattedBallLocation
        : defaults.trackBattedBallLocation,
  }
}

export function normalizeBaseballMatchSetup(value: unknown): BaseballMatchSetup | null {
  if (!isPlainObject(value) || value.version !== BASEBALL_SETUP_VERSION) return null
  if (!exactKeys(value, [
    'version',
    'trackedSide',
    'opponentName',
    'sourceTeamId',
    'sourceSeasonId',
    'rulesSnapshot',
    'participants',
    'trackedLineup',
    'opponentSlots',
    'opponentPitcher',
  ])) return null
  if (value.trackedSide !== 'home' && value.trackedSide !== 'away') return null
  if (!isNullableLabel(value.opponentName)) return null
  if (!isNullableId(value.sourceTeamId) || !isNullableId(value.sourceSeasonId)) return null
  const rules: BaseballMatchRules | null = normalizeBaseballMatchRules(value.rulesSnapshot)
  if (!rules) return null
  if (!Array.isArray(value.participants) || !value.participants.every(isBaseballMatchParticipant)) return null
  if (!isTrackedLineup(value.trackedLineup)) return null
  if (!Array.isArray(value.opponentSlots) || !value.opponentSlots.every(isOpponentSlot)) return null
  if (!isOpponentPitcher(value.opponentPitcher)) return null
  const setup = structuredClone(value) as unknown as BaseballMatchSetup
  return validateBaseballMatchSetup(setup).ok ? setup : null
}

export function isBaseballMatchParticipant(value: unknown): value is BaseballMatchParticipant {
  return (
    isPlainObject(value) &&
    exactKeys(value, ['id', 'playerId', 'displayName', 'number', 'position', 'bats', 'throws']) &&
    isId(value.id) &&
    isNullableId(value.playerId) &&
    isLabel(value.displayName) &&
    isNullableShortLabel(value.number) &&
    isPosition(value.position) &&
    isBatHand(value.bats) &&
    isPitchHand(value.throws)
  )
}

function isOpponentSlot(value: unknown): value is BaseballOpponentSlot {
  return (
    isPlainObject(value) &&
    exactKeys(value, ['id', 'label', 'number', 'position', 'bats']) &&
    isId(value.id) &&
    isNullableLabel(value.label) &&
    isNullableShortLabel(value.number) &&
    isPosition(value.position) &&
    isBatHand(value.bats)
  )
}

export function isOpponentPitcher(value: unknown): value is BaseballOpponentPitcher {
  return (
    isPlainObject(value) &&
    exactKeys(value, ['id', 'label', 'number', 'throws']) &&
    isId(value.id) &&
    isNullableLabel(value.label) &&
    isNullableShortLabel(value.number) &&
    isPitchHand(value.throws)
  )
}

function isTrackedLineup(value: unknown): value is BaseballTrackedLineup {
  if (!isPlainObject(value) || !exactKeys(value, ['battingOrder', 'defense'])) return false
  if (!Array.isArray(value.battingOrder) || !value.battingOrder.every(isId)) return false
  if (!isPlainObject(value.defense)) return false
  return Object.entries(value.defense).every(
    ([key, id]) => isBaseballFieldingNumber(Number(key)) && String(Number(key)) === key && isId(id)
  )
}

export function isBatHand(value: unknown): value is BaseballBatHand | null {
  return value === null || value === 'L' || value === 'R' || value === 'S'
}

export function isPitchHand(value: unknown): value is BaseballPitchHand | null {
  return value === null || value === 'L' || value === 'R'
}

function isPosition(value: unknown): boolean {
  return value === null || (typeof value === 'string' && normalizeBaseballPosition(value) === value)
}

export function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100
}

function isNullableId(value: unknown): boolean {
  return value === null || isId(value)
}

function isLabel(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_LABEL_LENGTH
}

export function isNullableLabel(value: unknown): value is string | null {
  return value === null || isLabel(value)
}

export function isNullableShortLabel(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.trim().length > 0 && value.length <= 10)
}

export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => key in value)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
