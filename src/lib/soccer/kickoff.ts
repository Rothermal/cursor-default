import type { GameState } from '../../types'
import { addGameEvents, initializeGameEventStream } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { createSoccerEvent, nextSoccerEventSequence } from './events'
import { createSoccerUuid } from './id'
import { orderedSoccerSegments } from './rules'
import { createSoccerSportGameState, validateSoccerMatchSetup } from './state'
import type { SoccerMatchSetup } from './types'

export type SoccerKickoffResult =
  | { ok: true; state: GameState }
  | { ok: false; message: string }

export interface SoccerKickoffOptions {
  recorderUserId: string | null
  occurredAt?: string
  eventIds?: [string, string, string]
}

export function prepareSoccerKickoff(
  state: GameState,
  setup: SoccerMatchSetup,
  options: SoccerKickoffOptions
): SoccerKickoffResult {
  if (state.sport?.id !== 'soccer' || !state.gameInfo) {
    return { ok: false, message: 'Soccer match information is incomplete.' }
  }
  if (state.eventStream?.events.length) {
    return { ok: false, message: 'This soccer match has already started.' }
  }
  const setupError = validateSoccerMatchSetup(setup)
  if (setupError) return { ok: false, message: setupError }

  const starters = setup.participants.filter(participant => participant.initialStatus === 'starter')
  if (starters.length === 0) return { ok: false, message: 'Select at least one starter.' }
  if (starters.length > setup.rulesSnapshot.maxOnFieldPlayers) {
    return { ok: false, message: 'The opening lineup exceeds the configured player maximum.' }
  }
  if (starters.filter(participant => participant.initialRole.group === 'goalkeeper').length !== 1) {
    return { ok: false, message: 'The opening lineup requires exactly one goalkeeper.' }
  }

  const firstPeriod = orderedSoccerSegments(setup.rulesSnapshot)[0]
  if (!firstPeriod) return { ok: false, message: 'The match requires a regulation period.' }

  const configuredState: GameState = {
    ...state,
    sportGameState: createSoccerSportGameState(setup),
  }
  const initialized = initializeGameEventStream(
    configuredState,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!initialized.ok) return { ok: false, message: initialized.error.message }

  const occurredAt = options.occurredAt ?? new Date().toISOString()
  const firstSequence = nextSoccerEventSequence(
    initialized.state.eventStream?.events ?? [],
    options.recorderUserId
  )
  const ids = options.eventIds ?? [createSoccerUuid(), createSoccerUuid(), createSoccerUuid()]
  const period = { id: firstPeriod.id, order: firstPeriod.order }
  const appended = addGameEvents(
    initialized.state,
    [
      createSoccerEvent({
        id: ids[0],
        eventType: 'soccer.opening_lineup',
        payload: {
          starters: starters.map(participant => ({
            participantId: participant.id,
            role: participant.initialRole,
          })),
        },
        recorderUserId: options.recorderUserId,
        sequence: firstSequence,
        period,
        elapsedMs: 0,
        occurredAt,
      }),
      createSoccerEvent({
        id: ids[1],
        eventType: 'soccer.period_started',
        payload: { periodId: firstPeriod.id },
        recorderUserId: options.recorderUserId,
        sequence: firstSequence + 1,
        period,
        elapsedMs: 0,
        occurredAt,
      }),
      createSoccerEvent({
        id: ids[2],
        eventType: 'soccer.clock_started',
        payload: { anchorElapsedMs: 0 },
        recorderUserId: options.recorderUserId,
        sequence: firstSequence + 2,
        period,
        elapsedMs: 0,
        occurredAt,
      }),
    ],
    gameEventRegistry,
    gameEventProjectors
  )
  return appended.ok
    ? { ok: true, state: appended.state }
    : { ok: false, message: appended.error.message }
}
