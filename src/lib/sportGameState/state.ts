import { isPlainObject } from '../gameEvents/envelope'
import { normalizeSoccerSportGameState } from '../soccer/state'
import type { SportGameState } from './types'

type SportGameStateNormalizer = (value: unknown) => SportGameState | null

const SPORT_GAME_STATE_NORMALIZERS = new Map<string, SportGameStateNormalizer>([
  ['soccer', normalizeSoccerSportGameState],
])

export function sportSupportsEventGameState(sportId: string): boolean {
  return SPORT_GAME_STATE_NORMALIZERS.has(sportId)
}

export function normalizeSportGameState(value: unknown): SportGameState | null {
  if (!isPlainObject(value) || typeof value.sportId !== 'string') return null
  return SPORT_GAME_STATE_NORMALIZERS.get(value.sportId)?.(value) ?? null
}

export function sportGameStateForFingerprint(value: SportGameState | null): unknown {
  if (!value) return null
  return {
    sportId: value.sportId,
    version: value.version,
    setup: value.setup,
  }
}
