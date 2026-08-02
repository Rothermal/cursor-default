import type { GameState } from '../../types'
import type { GameEventDiagnostic } from './types'

export const SPORT_EVENTS_AUTHORITY = 'sport_events' as const
export type GameDataAuthority = typeof SPORT_EVENTS_AUTHORITY

export function normalizeGameDataAuthority(value: unknown): GameDataAuthority | null {
  return value === SPORT_EVENTS_AUTHORITY ? SPORT_EVENTS_AUTHORITY : null
}

export function authoritativeGameDataDiagnostics(
  state: GameState,
  requiresSportGameState: boolean
): GameEventDiagnostic[] {
  if (state.gameDataAuthority !== SPORT_EVENTS_AUTHORITY) return []
  const diagnostics: GameEventDiagnostic[] = []
  if (!state.eventStream) {
    diagnostics.push({
      code: 'missing_authoritative_data',
      message: 'This event-owned game is missing a valid event stream and is quarantined.',
      eventId: null,
    })
  }
  if (
    !state.sport ||
    (requiresSportGameState && state.sportGameState?.sportId !== state.sport.id)
  ) {
    diagnostics.push({
      code: 'missing_authoritative_data',
      message: 'This event-owned game is missing valid sport setup and is quarantined.',
      eventId: null,
    })
  }
  return diagnostics
}
