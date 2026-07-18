import type { GameState } from '../../types'
import type { GameEventRegistry } from './registry'
import { inspectGameEventStream } from './stream'
import type {
  GameEvent,
  GameEventInspection,
  SportGameEventProjector,
} from './types'

export class GameEventProjectorRegistry<TEvent extends GameEvent = GameEvent> {
  private readonly projectors = new Map<string, SportGameEventProjector<TEvent>>()

  constructor(projectors: SportGameEventProjector<TEvent>[] = []) {
    projectors.forEach(projector => this.register(projector))
  }

  register(projector: SportGameEventProjector<TEvent>): void {
    if (this.projectors.has(projector.sportId)) {
      throw new Error(`Duplicate game event projector: ${projector.sportId}`)
    }
    this.projectors.set(projector.sportId, projector)
  }

  get(sportId: string): SportGameEventProjector<TEvent> | undefined {
    return this.projectors.get(sportId)
  }
}

export interface ProjectionRebuildResult<TEvent extends GameEvent = GameEvent> {
  state: GameState
  inspection: GameEventInspection<TEvent>
}

export function rebuildGameEventProjection<TEvent extends GameEvent>(
  state: GameState,
  registry: GameEventRegistry<TEvent>,
  projectors: GameEventProjectorRegistry<TEvent>
): ProjectionRebuildResult<TEvent> {
  if (!state.eventStream) {
    return {
      state,
      inspection: { complete: true, activeEvents: [], deletedEvents: [], diagnostics: [] },
    }
  }

  const inspection = inspectGameEventStream(state.eventStream, registry)
  const sportId = state.sport?.id
  const projector = sportId ? projectors.get(sportId) : undefined
  if (!projector) {
    return {
      state,
      inspection: {
        ...inspection,
        complete: false,
        diagnostics: [
          ...inspection.diagnostics,
          {
            code: 'missing_projector',
            message: `No event projector is registered for ${sportId ?? 'the active sport'}.`,
            eventId: null,
          },
        ],
      },
    }
  }
  if (!inspection.complete) return { state, inspection }

  const projection = projector.project(state, inspection.activeEvents)
  return {
    state: {
      ...state,
      players: state.players.map(player => ({
        ...player,
        stats: { ...(projection.playerStatsById[player.id] ?? {}) },
      })),
      opponentScore: projection.opponentScore,
      homeTeamScore: projection.homeTeamScore,
      homeScoreAdjustment: 0,
      shotChart: projection.shotChart,
      actionLog: [],
    },
    inspection,
  }
}
