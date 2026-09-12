import type { GameState } from '../../types'
import { prepareSoccerKickoff, type SoccerKickoffOptions, type SoccerKickoffResult } from './kickoff'
import { toggleSoccerClock } from './live'
import { requireSoccerEventGameState } from './gameState'
import type { SoccerMatchSetup } from './types'

// Historical/running fixtures explicitly start after the production paused kickoff.
export function prepareRunningSoccerKickoff(
  state: GameState,
  setup: SoccerMatchSetup,
  options: Omit<SoccerKickoffOptions, 'eventIds'> & { eventIds?: [string, string, string] }
): SoccerKickoffResult {
  const occurredAt = options.occurredAt ?? new Date().toISOString()
  const kickoff = prepareSoccerKickoff(state, setup, {
    ...options, occurredAt,
    eventIds: options.eventIds ? [options.eventIds[0], options.eventIds[1]] : undefined,
  })
  if (!kickoff.ok) return kickoff
  const started = toggleSoccerClock(kickoff.state, {
    recorderUserId: options.recorderUserId,
    nowMs: Date.parse(occurredAt),
    eventIds: options.eventIds ? [options.eventIds[2]] : undefined,
  })
  return started.ok ? { ok: true, state: requireSoccerEventGameState(started.state) } : started
}
