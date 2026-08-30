import { compareGameEventCaptureOrder } from '../gameEvents/stream'
import type { BasketballMatchEvent } from './types'

const LINEUP_EVENT_TYPES = new Set<BasketballMatchEvent['eventType']>([
  'basketball.lineup_confirmed',
  'basketball.substitution',
  'basketball.role_changed',
  'basketball.equal_play_override',
])

export function isRecordedLaterBasketballLineupEvent(event: BasketballMatchEvent): boolean {
  return LINEUP_EVENT_TYPES.has(event.eventType) && event.payload.recordedLater === true
}

export function orderBasketballEventsForProjection(
  events: BasketballMatchEvent[]
): BasketballMatchEvent[] {
  const captureOrdered = [...events].sort(compareGameEventCaptureOrder)
  const historical = captureOrdered
    .filter(isRecordedLaterBasketballLineupEvent)
    .sort(compareReplayMoment)
  if (historical.length === 0) return captureOrdered

  const result = captureOrdered.filter(event => !isRecordedLaterBasketballLineupEvent(event))
  for (const event of historical) {
    const insertionIndex = result.findIndex(candidate => compareReplayMoment(candidate, event) > 0)
    result.splice(insertionIndex < 0 ? result.length : insertionIndex, 0, event)
  }
  return result
}

function compareReplayMoment(left: BasketballMatchEvent, right: BasketballMatchEvent): number {
  if (left.period.order !== right.period.order) return left.period.order - right.period.order
  const leftElapsed = left.elapsedMs ?? replayElapsedFallback(left)
  const rightElapsed = right.elapsedMs ?? replayElapsedFallback(right)
  if (leftElapsed !== rightElapsed) return leftElapsed - rightElapsed
  const precedence = replayPrecedence(left) - replayPrecedence(right)
  return precedence || compareGameEventCaptureOrder(left, right)
}

function replayElapsedFallback(event: BasketballMatchEvent): number {
  return event.eventType === 'basketball.period_started' ? 0 : Number.MAX_SAFE_INTEGER
}

function replayPrecedence(event: BasketballMatchEvent): number {
  switch (event.eventType) {
    case 'basketball.period_started': return 0
    case 'basketball.clock_paused': return 10
    case 'basketball.stoppage': return 20
    case 'basketball.clock_adjusted': return 25
    case 'basketball.foul':
    case 'basketball.ejection': return 30
    case 'basketball.substitution': return 40
    case 'basketball.role_changed': return 50
    case 'basketball.equal_play_override': return 60
    case 'basketball.lineup_confirmed': return 70
    case 'basketball.clock_started': return 80
    case 'basketball.period_ended': return 100
    default: return 50
  }
}
