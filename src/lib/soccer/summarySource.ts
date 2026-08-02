import type { GameState } from '../../types'
import type { GameEvent, GameEventInspection } from '../gameEvents/types'
import { requireSoccerEventGameState, type SoccerEventGameState } from './gameState'
import { inspectSoccerHistory } from './live'
import {
  loadSoccerCanonicalPublication,
  inspectSoccerCanonicalSnapshot,
  type SoccerCanonicalPublication,
} from './finalization'
import {
  loadSoccerCloudSummaryState,
  loadSoccerGameRecorders,
  loadSoccerPrimaryCloudReview,
  loadSoccerRecorderProjection,
  type SoccerRecorderProjection,
  type SoccerRecorderSummary,
} from './recorders'

interface SoccerSummarySourceBase {
  state: SoccerEventGameState
  recorder: SoccerRecorderSummary | null
  recorders: SoccerRecorderSummary[]
  publication: SoccerCanonicalPublication | null
  inspection: GameEventInspection<GameEvent>
  editable: boolean
}

export type SoccerSummarySource =
  | (SoccerSummarySourceBase & {
      kind: 'local'
      recorder: null
      publication: null
    })
  | (SoccerSummarySourceBase & {
      kind: 'cloud_primary'
      recorder: SoccerRecorderSummary
      publication: null
      editable: false
    })
  | (SoccerSummarySourceBase & {
      kind: 'cloud_recording'
      recorder: SoccerRecorderSummary
      publication: null
      editable: false
    })
  | (SoccerSummarySourceBase & {
      kind: 'canonical'
      recorder: SoccerRecorderSummary
      publication: SoccerCanonicalPublication
      editable: false
    })

export type SoccerSummaryAuthority =
  | 'local'
  | 'cloud_primary'
  | 'cloud_recording'
  | 'canonical'

export class SoccerSummarySourceError extends Error {
  authority: SoccerSummaryAuthority

  constructor(authority: SoccerSummaryAuthority, message: string) {
    super(message)
    this.name = 'SoccerSummarySourceError'
    this.authority = authority
  }
}

export interface SoccerSummarySourceDependencies {
  loadCloudState: (gameId: string) => Promise<GameState>
  loadPrimary: (gameId: string) => Promise<{
    recorders: SoccerRecorderSummary[]
    primary: SoccerRecorderProjection
  }>
  loadCanonical: (gameId: string) => Promise<SoccerCanonicalPublication | null>
  loadRecorders: (gameId: string) => Promise<SoccerRecorderSummary[]>
  projectCanonical: (
    state: GameState,
    recorder: SoccerRecorderSummary,
    publication: SoccerCanonicalPublication
  ) => SoccerRecorderProjection
}

const defaultDependencies: SoccerSummarySourceDependencies = {
  loadCloudState: loadSoccerCloudSummaryState,
  loadPrimary: loadSoccerPrimaryCloudReview,
  loadCanonical: loadSoccerCanonicalPublication,
  loadRecorders: loadSoccerGameRecorders,
  projectCanonical: (state, recorder, publication) =>
    inspectSoccerCanonicalSnapshot(
      state,
      recorder,
      publication.snapshot
    ),
}

export async function loadSoccerSummarySource(
  localState: GameState,
  gameId: string | null,
  dependencies: SoccerSummarySourceDependencies = defaultDependencies
): Promise<SoccerSummarySource> {
  if (gameId) return loadCloudSource(gameId, dependencies)
  if (
    localState.sport?.id !== 'soccer' ||
    localState.sportGameState?.sportId !== 'soccer' ||
    !localState.eventStream
  ) {
    throw new SoccerSummarySourceError(
      'local',
      'Start or open a soccer match before viewing its summary.'
    )
  }
  if (localState.cloudSync.gameStatus === 'final') {
    if (!localState.cloudSync.gameId) {
      throw new SoccerSummarySourceError(
        'canonical',
        'This match is cloud-final, but its canonical game binding is unavailable.'
      )
    }
    return loadCloudSource(localState.cloudSync.gameId, dependencies)
  }
  return {
    kind: 'local',
    state: requireSoccerEventGameState(localState),
    recorder: null,
    recorders: [],
    publication: null,
    inspection: inspectSoccerHistory(localState),
    editable: true,
  }
}

export async function loadSoccerSummaryRecordingSource(
  baseSource: SoccerSummarySource,
  recorder: SoccerRecorderSummary,
  loadRecorder: (
    baseState: GameState,
    selectedRecorder: SoccerRecorderSummary
  ) => Promise<SoccerRecorderProjection> = loadSoccerRecorderProjection
): Promise<SoccerSummarySource> {
  if (baseSource.kind === 'local') {
    throw new SoccerSummarySourceError(
      'cloud_recording',
      'Other recordings require a cloud game.'
    )
  }
  if (baseSource.kind === 'canonical') {
    throw new SoccerSummarySourceError(
      'cloud_recording',
      'Canonical finals cannot be replaced by a live recorder stream.'
    )
  }
  const available = baseSource.recorders.find(
    item => item.recorderId === recorder.recorderId
  )
  if (!available) {
    throw new SoccerSummarySourceError(
      'cloud_recording',
      'The selected recorder is no longer available for this game.'
    )
  }
  try {
    const projection = await loadRecorder(baseSource.state, available)
    return {
      kind: available.isPrimary ? 'cloud_primary' : 'cloud_recording',
      state: requireSoccerEventGameState(projection.state),
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
      'The selected recorder stream could not load.'
    )
  }
}

async function loadCloudSource(
  gameId: string,
  dependencies: SoccerSummarySourceDependencies
): Promise<SoccerSummarySource> {
  let cloudState: GameState
  try {
    cloudState = await dependencies.loadCloudState(gameId)
  } catch (error) {
    throw sourceError(
      'cloud_primary',
      error,
      'The synced soccer game could not load.'
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
      const recorder =
        recorders.find(item => item.recorderId === publication.primaryRecorderId) ??
        recorderFromPublication(publication)
      const projection = dependencies.projectCanonical(
        cloudState,
        recorder,
        publication
      )
      return {
        kind: 'canonical',
        state: requireSoccerEventGameState(projection.state),
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
        'The canonical soccer result could not load.'
      )
    }
  }

  try {
    const { primary, recorders } = await dependencies.loadPrimary(gameId)
    return {
      kind: 'cloud_primary',
      state: requireSoccerEventGameState(primary.state),
      recorder: primary.recorder,
      recorders,
      publication: null,
      inspection: primary.inspection,
      editable: false,
    }
  } catch (error) {
    throw sourceError(
      'cloud_primary',
      error,
      'The synced primary recorder could not load.'
    )
  }
}

function recorderFromPublication(
  publication: SoccerCanonicalPublication
): SoccerRecorderSummary {
  return {
    recorderId: publication.primaryRecorderId,
    displayName: publication.primaryDisplayName,
    eventCount: publication.snapshot.eventStream.events.length,
    checkpointEventCount: publication.snapshot.eventStream.events.length,
    checkpointSyncedAt: publication.finalizedAt,
    checkpointCurrent: true,
    unresolvedConflictCount: 0,
    isPrimary: true,
    primarySource: 'selected',
    canSelectPrimary: false,
  }
}

function sourceError(
  authority: SoccerSummaryAuthority,
  error: unknown,
  fallback: string
): SoccerSummarySourceError {
  if (error instanceof SoccerSummarySourceError) return error
  return new SoccerSummarySourceError(
    authority,
    error instanceof Error ? error.message : fallback
  )
}
