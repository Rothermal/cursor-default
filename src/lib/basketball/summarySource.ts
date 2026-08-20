import type { GameState } from '../../types'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import type { GameEvent, GameEventInspection } from '../gameEvents/types'
import { loadBasketballCloudShell } from './cloudSync'
import { reconcileBasketballPlayerRows } from './courtCorrections'
import {
  loadBasketballCanonicalPublication,
  type BasketballCanonicalPublication,
} from './finalization'
import {
  loadBasketballGameRecorders,
  loadBasketballRecorderProjection,
  primaryBasketballRecorder,
  type BasketballRecorderProjection,
  type BasketballRecorderSummary,
} from './recorders'
import { createBasketballSportGameState } from './state'

interface BasketballSummarySourceBase {
  state: GameState
  recorder: BasketballRecorderSummary | null
  recorders: BasketballRecorderSummary[]
  publication: BasketballCanonicalPublication | null
  inspection: GameEventInspection<GameEvent>
  editable: boolean
}

export type BasketballSummarySource =
  | (BasketballSummarySourceBase & {
      kind: 'local'
      recorder: null
      publication: null
    })
  | (BasketballSummarySourceBase & {
      kind: 'cloud_primary'
      recorder: BasketballRecorderSummary
      publication: null
      editable: false
    })
  | (BasketballSummarySourceBase & {
      kind: 'cloud_recording'
      recorder: BasketballRecorderSummary
      publication: null
      editable: false
    })
  | (BasketballSummarySourceBase & {
      kind: 'canonical'
      recorder: BasketballRecorderSummary
      publication: BasketballCanonicalPublication
      editable: false
    })

export type BasketballSummaryAuthority = BasketballSummarySource['kind']

export class BasketballSummarySourceError extends Error {
  authority: BasketballSummaryAuthority

  constructor(authority: BasketballSummaryAuthority, message: string) {
    super(message)
    this.name = 'BasketballSummarySourceError'
    this.authority = authority
  }
}

export interface BasketballSummarySourceDependencies {
  loadCloudState: (gameId: string) => Promise<GameState>
  loadRecorders: (gameId: string) => Promise<BasketballRecorderSummary[]>
  loadRecorder: (
    gameId: string,
    recorder: BasketballRecorderSummary
  ) => Promise<BasketballRecorderProjection>
  loadCanonical: (gameId: string) => Promise<BasketballCanonicalPublication | null>
  projectCanonical: (
    state: GameState,
    recorder: BasketballRecorderSummary,
    publication: BasketballCanonicalPublication
  ) => BasketballRecorderProjection
}

const defaultDependencies: BasketballSummarySourceDependencies = {
  loadCloudState: async gameId => (await loadBasketballCloudShell(gameId)).state,
  loadRecorders: loadBasketballGameRecorders,
  loadRecorder: loadBasketballRecorderProjection,
  loadCanonical: loadBasketballCanonicalPublication,
  projectCanonical: projectBasketballCanonicalPublication,
}

export async function loadBasketballSummarySource(
  localState: GameState,
  gameId: string | null,
  dependencies: BasketballSummarySourceDependencies = defaultDependencies
): Promise<BasketballSummarySource> {
  if (gameId) return loadCloudSource(gameId, dependencies)
  if (!isBasketballEventState(localState)) {
    throw new BasketballSummarySourceError(
      'local',
      'Start or open an event-based Basketball game before viewing its summary.'
    )
  }
  if (localState.cloudSync.gameStatus === 'final') {
    if (!localState.cloudSync.gameId) {
      throw new BasketballSummarySourceError(
        'canonical',
        'This game is cloud-final, but its canonical game binding is unavailable.'
      )
    }
    return loadCloudSource(localState.cloudSync.gameId, dependencies)
  }

  const rebuilt = rebuildGameEventProjection(
    localState,
    gameEventRegistry,
    gameEventProjectors
  )
  return {
    kind: 'local',
    state: reconcileBasketballPlayerRows(rebuilt.state),
    recorder: null,
    recorders: [],
    publication: null,
    inspection: rebuilt.inspection,
    editable: rebuilt.inspection.complete,
  }
}

export async function loadBasketballSummaryRecordingSource(
  baseSource: BasketballSummarySource,
  recorder: BasketballRecorderSummary,
  loadRecorder: BasketballSummarySourceDependencies['loadRecorder'] =
    loadBasketballRecorderProjection
): Promise<BasketballSummarySource> {
  if (baseSource.kind === 'local') {
    throw new BasketballSummarySourceError(
      'cloud_recording',
      'Other recordings require a cloud game.'
    )
  }
  if (baseSource.kind === 'canonical') {
    throw new BasketballSummarySourceError(
      'cloud_recording',
      'Canonical finals cannot be replaced by a recorder stream.'
    )
  }
  if (!baseSource.recorders.some(item => item.canSelectPrimary)) {
    throw new BasketballSummarySourceError(
      'cloud_recording',
      'Other Basketball recordings are available only to game managers.'
    )
  }
  const available = baseSource.recorders.find(
    item => item.recorderId === recorder.recorderId
  )
  if (!available) {
    throw new BasketballSummarySourceError(
      'cloud_recording',
      'The selected recorder is no longer available for this game.'
    )
  }

  try {
    const gameId = baseSource.state.cloudSync.gameId
    if (!gameId) throw new Error('The cloud game binding is unavailable.')
    const projection = await loadRecorder(gameId, available)
    return {
      kind: available.isPrimary ? 'cloud_primary' : 'cloud_recording',
      state: projection.state,
      recorder: projection.recorder,
      recorders: baseSource.recorders,
      publication: null,
      inspection: projection.inspection,
      editable: false,
    }
  } catch (error) {
    throw sourceError(
      'cloud_recording',
      error,
      'The selected Basketball recorder stream could not load.'
    )
  }
}

async function loadCloudSource(
  gameId: string,
  dependencies: BasketballSummarySourceDependencies
): Promise<BasketballSummarySource> {
  let cloudState: GameState
  try {
    cloudState = await dependencies.loadCloudState(gameId)
  } catch (error) {
    throw sourceError(
      'cloud_primary',
      error,
      'The synced Basketball game could not load.'
    )
  }
  if (!isBasketballEventState(cloudState, false)) {
    throw new BasketballSummarySourceError(
      'cloud_primary',
      'This cloud game does not contain event-based Basketball setup.'
    )
  }

  if (cloudState.cloudSync.gameStatus === 'final') {
    try {
      const [publication, recorders] = await Promise.all([
        dependencies.loadCanonical(gameId),
        dependencies.loadRecorders(gameId),
      ])
      if (!publication) {
        throw new Error(
          'This game is final, but no healthy canonical publication is available. Reopen the game or retry after recovery.'
        )
      }
      const recorder = recorders.find(
        item => item.recorderId === publication.primaryRecorderId
      ) ?? recorderFromPublication(publication)
      const projection = dependencies.projectCanonical(cloudState, recorder, publication)
      return {
        kind: 'canonical',
        state: projection.state,
        recorder,
        recorders,
        publication,
        inspection: projection.inspection,
        editable: false,
      }
    } catch (error) {
      throw sourceError(
        'canonical',
        error,
        'The canonical Basketball result could not load.'
      )
    }
  }

  try {
    const recorders = await dependencies.loadRecorders(gameId)
    const primary = primaryBasketballRecorder(recorders)
    if (!primary) throw new Error('This game does not have a primary Basketball recorder.')
    const projection = await dependencies.loadRecorder(gameId, primary)
    return {
      kind: 'cloud_primary',
      state: projection.state,
      recorder: projection.recorder,
      recorders,
      publication: null,
      inspection: projection.inspection,
      editable: false,
    }
  } catch (error) {
    throw sourceError(
      'cloud_primary',
      error,
      'The synced primary Basketball recorder could not load.'
    )
  }
}

export function projectBasketballCanonicalPublication(
  state: GameState,
  recorder: BasketballRecorderSummary,
  publication: BasketballCanonicalPublication
): BasketballRecorderProjection {
  const snapshot = publication.snapshot
  const candidate: GameState = {
    ...state,
    gameDataAuthority: 'sport_events',
    eventStream: structuredClone(snapshot.eventStream),
    sportGameState: createBasketballSportGameState(snapshot.sportGameState.setup),
    cloudSync: { ...state.cloudSync, gameId: snapshot.gameId, gameStatus: 'final' },
  }
  const rebuilt = rebuildGameEventProjection(
    candidate,
    gameEventRegistry,
    gameEventProjectors
  )
  const sportState = rebuilt.state.sportGameState
  const terminal = sportState?.sportId === 'basketball' &&
    sportState.projection.status === 'ended' &&
    (sportState.projection.endReason === 'completed' ||
      sportState.projection.endReason === 'abandoned')
  const inspection = terminal
    ? rebuilt.inspection
    : {
        ...rebuilt.inspection,
        complete: false,
        diagnostics: [
          ...rebuilt.inspection.diagnostics,
          {
            code: 'semantic_validation_failed' as const,
            message: 'The canonical Basketball publication is not terminal.',
            eventId: null,
          },
        ],
      }
  return {
    recorder,
    state: reconcileBasketballPlayerRows(rebuilt.state),
    eventStream: snapshot.eventStream,
    inspection,
  }
}

function isBasketballEventState(state: GameState, requireStream = true): boolean {
  return Boolean(
    state.gameDataAuthority === 'sport_events' &&
      state.sport?.id === 'basketball' &&
      state.sportGameState?.sportId === 'basketball' &&
      (!requireStream || state.eventStream)
  )
}

function recorderFromPublication(
  publication: BasketballCanonicalPublication
): BasketballRecorderSummary {
  const eventCount = publication.snapshot.eventStream.events.length
  return {
    recorderId: publication.primaryRecorderId,
    displayName: publication.primaryDisplayName,
    eventCount,
    checkpointEventCount: eventCount,
    checkpointSyncedAt: publication.finalizedAt,
    checkpointCurrent: true,
    unresolvedConflictCount: 0,
    isPrimary: true,
    primarySource: 'selected',
    canSelectPrimary: false,
  }
}

function sourceError(
  authority: BasketballSummaryAuthority,
  error: unknown,
  fallback: string
): BasketballSummarySourceError {
  if (error instanceof BasketballSummarySourceError) return error
  return new BasketballSummarySourceError(
    authority,
    error instanceof Error ? error.message : fallback
  )
}
