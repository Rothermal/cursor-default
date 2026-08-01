import { isPlainObject } from '../gameEvents/envelope'
import { normalizeSoccerSportGameState } from '../soccer/state'
import type { SportGameState } from './types'

export function normalizeSportGameState(value: unknown): SportGameState | null {
  if (!isPlainObject(value) || typeof value.sportId !== 'string') return null

  switch (value.sportId) {
    case 'soccer':
      return normalizeSoccerSportGameState(value)
    default:
      return null
  }
}

export function sportGameStateForFingerprint(value: SportGameState | null): unknown {
  if (!value) return null
  return {
    sportId: value.sportId,
    version: value.version,
    setup: value.setup,
  }
}
