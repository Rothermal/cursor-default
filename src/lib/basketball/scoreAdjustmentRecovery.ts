import type { GameState } from '../../types'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { inspectGameEventStream } from '../gameEvents/stream'
import type { GameEventDiagnostic } from '../gameEvents/types'
import { isFinalBasketballCloudGame } from './cloudPolicy'
import type { BasketballMatchEvent } from './types'

export const BASKETBALL_NEGATIVE_SCORE_DIAGNOSTIC = 'Basketball score cannot project below zero.'
export const BASKETBALL_NEGATIVE_SCORE_RECOVERY_MESSAGE =
  'Basketball score history is below zero. Edit or remove the flagged score adjustment to repair this game.'

export function isBasketballNegativeScoreDiagnostic(
  diagnostic: GameEventDiagnostic
): boolean {
  return diagnostic.code === 'semantic_validation_failed' &&
    diagnostic.message === BASKETBALL_NEGATIVE_SCORE_DIAGNOSTIC &&
    diagnostic.eventId !== null
}

export function basketballRecoverableScoreAdjustmentId(
  state: GameState,
  diagnostics?: readonly GameEventDiagnostic[]
): string | null {
  if (
    state.sport?.id !== 'basketball' ||
    state.gameDataAuthority !== 'sport_events' ||
    state.sportGameState?.sportId !== 'basketball' ||
    !state.eventStream ||
    isFinalBasketballCloudGame(state)
  ) return null

  const streamInspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  if (!streamInspection.complete) return null
  const projectionDiagnostics = diagnostics ??
    rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors).inspection.diagnostics
  const failure = projectionDiagnostics.find(isBasketballNegativeScoreDiagnostic)
  if (!failure?.eventId) return null
  const event = streamInspection.activeEvents
    .filter(isBasketballMatchEvent)
    .find(candidate => candidate.id === failure.eventId)
  return event?.eventType === 'basketball.score_adjustment' ? event.id : null
}

function isBasketballMatchEvent(event: { sportId: string }): event is BasketballMatchEvent {
  return event.sportId === 'basketball'
}
