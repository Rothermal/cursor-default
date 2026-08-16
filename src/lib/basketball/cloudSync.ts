import type { GameState } from '../../types'
import {
  assertHealthyEventGame,
  syncEventGameToCloud,
  type EventCloudParticipant,
  type EventCloudTransportAdapter,
  type SyncEventGameResult,
} from '../gameEvents/cloudTransport'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import type { BasketballSportGameState } from './types'

export interface SyncBasketballEventGameInput {
  state: GameState
  userId: string
  localGameId: string
}

export type SyncBasketballEventGameResult = SyncEventGameResult

export class BasketballCloudRecoveryError extends Error {
  recoveredState: GameState

  constructor(message: string, recoveredState: GameState) {
    super(message)
    this.name = 'BasketballCloudRecoveryError'
    this.recoveredState = recoveredState
  }
}

export function basketballCloudParticipants(
  sportState: BasketballSportGameState
): EventCloudParticipant[] {
  const setupById = new Map(
    sportState.setup.participants.map(participant => [participant.id, participant])
  )
  return Object.values(sportState.projection.participants).map(participant => {
    const origin = setupById.get(participant.participantId)
    return {
      client_participant_id: participant.participantId,
      client_player_id: participant.playerId,
      source_player_id:
        sportState.setup.sourceTeamId && participant.teamSide === 'tracked'
          ? participant.playerId
          : null,
      kind: participant.playerId ? 'player' : 'anonymous',
      display_name: participant.displayName,
      jersey_number: participant.number,
      snapshot: {
        teamSide: participant.teamSide,
        initialStatus: origin?.initialStatus ?? 'bench',
        position: origin?.position ?? participant.position,
        captain: origin?.captain ?? participant.captain,
        addedDuringMatch: origin === undefined,
      },
    }
  })
}

export function assertHealthyBasketballEventGame(
  state: GameState
): BasketballSportGameState {
  const sportState = state.sportGameState
  if (
    state.gameDataAuthority !== 'sport_events' ||
    sportState?.sportId !== 'basketball'
  ) {
    throw new Error('Basketball event game is not initialized')
  }
  assertHealthyEventGame(state, 'basketball', rebuildEventGameState)
  return sportState
}

function rebuildEventGameState(state: GameState) {
  return rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors)
}

export const basketballEventCloudTransportAdapter: EventCloudTransportAdapter = {
  sportId: 'basketball',
  sportLabel: 'Basketball',
  bindingRpc: 'bind_basketball_event_game_v4',
  registry: gameEventRegistry,
  remoteConflictRevisionPolicy: 'advance',
  prepare(state) {
    const sportState = assertHealthyBasketballEventGame(state)
    return {
      sourceTeamId: sportState.setup.sourceTeamId,
      sourceSeasonId: sportState.setup.sourceSeasonId,
      setupSnapshot: sportState.setup,
      participants: basketballCloudParticipants(sportState),
    }
  },
  createRecoveryError(message, recoveredState) {
    return new BasketballCloudRecoveryError(message, recoveredState)
  },
  rebuild: rebuildEventGameState,
}

// BKE-4B2 will route marked games here from GameContext. Keeping this callable but unrouted lets
// BKE-4B1 verify the full adapter contract without changing production sync behavior.
export function syncBasketballEventGameToCloud(
  input: SyncBasketballEventGameInput
): Promise<SyncBasketballEventGameResult> {
  return syncEventGameToCloud({ ...input, adapter: basketballEventCloudTransportAdapter })
}
