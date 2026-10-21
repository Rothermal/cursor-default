import type { GameState } from '../../types'
import { endBaseballGame } from './commands'
import { createBaseballCanonicalSnapshot } from './finalization'
import { ctx, expectOk, startedGame } from './testFixtures'
import type { BaseballCanonicalAggregateSource } from './aggregateTypes'

export const aggregateUuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const AGGREGATE_USER = aggregateUuid(1)
export const AGGREGATE_TEAM = aggregateUuid(2)
export const AGGREGATE_PLAYER = aggregateUuid(101)
export const MAP_FINGERPRINT = 'a'.repeat(32)

export function ownedAggregateState(state: GameState): GameState {
  return { ...state, eventStream: { ...state.eventStream!, events: state.eventStream!.events.map(e => ({ ...(e as object), recorderUserId: AGGREGATE_USER })) } }
}
export function finishedAggregateState(state = startedGame()): GameState {
  return ownedAggregateState(expectOk(endBaseballGame(state, 'time_limit', ctx())))
}
export function baseballAggregateSource(state = finishedAggregateState(), n = 1): BaseballCanonicalAggregateSource {
  state = ownedAggregateState(state)
  const gameId = aggregateUuid(1000 + n)
  const setup = state.sportGameState!.setup
  const sourceTeamId = 'sourceTeamId' in setup ? setup.sourceTeamId : null
  const sourceSeasonId = 'sourceSeasonId' in setup ? setup.sourceSeasonId : null
  return { publicationId: aggregateUuid(2000 + n), publicationNumber: 1, snapshotFingerprint: `snapshot-${n}`,
    finalizedAt: new Date(Date.UTC(2026, 9, 20, 12, 0, 60 - n)).toISOString(), eventCount: state.eventStream!.events.length,
    payloadBytes: 500, game: { id: gameId, date: '2026-10-20', status: 'final', cloudScope: sourceTeamId ? 'team' : 'personal',
      teamId: sourceTeamId as string | null, seasonId: sourceSeasonId as string | null, tournamentId: null, trackedTeamName: 'Aces', opponentName: 'Visitors' },
    canonicalSnapshot: createBaseballCanonicalSnapshot(gameId, AGGREGATE_USER, state),
    participantSourceMap: Object.fromEntries(setup.participants.map((p, i) => [p.id, aggregateUuid(101 + i)])),
    participantMapFingerprint: sourceTeamId ? null : MAP_FINGERPRINT, identityStatus: 'valid', identityDiagnostic: null, canManage: true }
}
