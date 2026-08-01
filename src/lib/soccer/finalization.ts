import type { GameState } from '../../types'
import { isGameEventEnvelope, isPlainObject } from '../gameEvents/envelope'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { normalizeGameEventStream } from '../gameEvents/stream'
import type { GameEvent } from '../gameEvents/types'
import { supabase } from '../supabase'
import {
  loadSoccerGameRecorders,
  loadSoccerPrimaryCloudReview,
  loadSoccerRecorderProjection,
  type SoccerRecorderProjection,
  type SoccerRecorderSummary,
} from './recorders'
import {
  soccerEventRevisionCheckpoint,
  soccerEventStreamFingerprint,
} from './cloudSync'
import { createSoccerSportGameState, normalizeSoccerSportGameState } from './state'
import type { SoccerMatchSetup } from './types'

export interface SoccerFinalizationReadiness {
  gameStatus: string
  canFinalize: boolean
  canReopen: boolean
  primaryRecorderId: string | null
  primaryDisplayName: string | null
  primaryEnded: boolean
  primaryCheckpointCurrent: boolean
  primaryConflictCount: number
  primaryLocked: boolean
  activePublicationId: string | null
  finalizedAt: string | null
  nonPrimaryAttentionCount: number
}

export interface SoccerCanonicalSnapshot {
  version: 2
  sportId: 'soccer'
  gameId: string
  primaryRecorderId: string
  eventStream: {
    version: number
    events: unknown[]
  }
  sportGameState: {
    sportId: 'soccer'
    version: number
    setup: SoccerMatchSetup
  }
}

export interface SoccerCanonicalPublication {
  publicationId: string
  publicationNumber: number
  primaryRecorderId: string
  primaryDisplayName: string
  snapshot: SoccerCanonicalSnapshot
  snapshotFingerprint: string
  finalizedBy: string
  finalizedByDisplayName: string
  finalizedAt: string
}

export interface SoccerPrimaryFinalizationConflict {
  conflictId: string
  recorderId: string
  recorderDisplayName: string
  eventId: string
  localEvent: GameEvent
  remoteEvent: GameEvent
  detectedAt: string
}

export interface SoccerFinalizationPreview {
  readiness: SoccerFinalizationReadiness
  recorder: SoccerRecorderSummary
  projection: SoccerRecorderProjection
  snapshot: SoccerCanonicalSnapshot
}

export interface SoccerFinalizationResult {
  publicationId: string
  publicationNumber: number
  primaryRecorderId: string
  finalizedAt: string
}

export async function loadSoccerFinalizationReadiness(
  gameId: string
): Promise<SoccerFinalizationReadiness> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { data, error } = await supabase.rpc('get_soccer_finalization_readiness', {
    p_game_id: gameId,
  })
  if (error) throw new Error(`Finalization readiness could not load: ${error.message}`)
  const row = firstRow(data)
  return {
    gameStatus: requiredString(row.game_status, 'game status'),
    canFinalize: row.can_finalize === true,
    canReopen: row.can_reopen === true,
    primaryRecorderId: nullableString(row.primary_recorded_by),
    primaryDisplayName: nullableString(row.primary_display_name),
    primaryEnded: row.primary_ended === true,
    primaryCheckpointCurrent: row.primary_checkpoint_current === true,
    primaryConflictCount: requiredInteger(row.primary_conflict_count, 'primary conflict count'),
    primaryLocked: row.primary_locked === true,
    activePublicationId: nullableString(row.active_publication_id),
    finalizedAt: nullableString(row.finalized_at),
    nonPrimaryAttentionCount: requiredInteger(
      row.non_primary_attention_count,
      'non-primary attention count'
    ),
  }
}

export async function prepareSoccerFinalization(
  baseState: GameState
): Promise<SoccerFinalizationPreview> {
  const gameId = baseState.cloudSync.gameId
  if (!gameId) throw new Error('Cloud game binding is unavailable.')

  let readiness = await loadSoccerFinalizationReadiness(gameId)
  if (!readiness.canFinalize) {
    throw new Error('Owner or admin access is required to finalize this game.')
  }
  if (!readiness.primaryRecorderId) {
    throw new Error('Choose a healthy primary recorder before finalizing.')
  }
  if (readiness.primaryConflictCount > 0) {
    throw new Error('Resolve the primary recorder conflicts before finalizing.')
  }

  const recorders = await loadSoccerGameRecorders(gameId)
  const recorder = recorders.find(
    item => item.recorderId === readiness.primaryRecorderId
  )
  if (!recorder) throw new Error('Primary recorder stream is unavailable.')

  const projection = await loadSoccerRecorderProjection(baseState, recorder)
  const soccerState = projection.state.sportGameState?.sportId === 'soccer'
    ? projection.state.sportGameState
    : null
  if (!projection.inspection.complete || !soccerState) {
    throw new Error(
      projection.inspection.diagnostics[0]?.message ??
        'Primary recorder projection needs attention.'
    )
  }
  if (
    soccerState.projection.status !== 'ended' ||
    (soccerState.projection.endReason !== 'completed' &&
      soccerState.projection.endReason !== 'abandoned')
  ) {
    throw new Error('Complete or abandon the primary match before finalizing.')
  }

  if (!readiness.primaryCheckpointCurrent) {
    await confirmPrimaryCheckpoint(gameId, recorder.recorderId, projection)
    readiness = await loadSoccerFinalizationReadiness(gameId)
    if (!readiness.primaryCheckpointCurrent) {
      throw new Error('Primary recorder checkpoint is not current.')
    }
  }

  return {
    readiness,
    recorder,
    projection,
    snapshot: createSoccerCanonicalSnapshot(gameId, recorder.recorderId, projection),
  }
}

export async function finalizeSoccerGame(
  baseState: GameState
): Promise<SoccerFinalizationResult> {
  if (!supabase) throw new Error('Supabase client not configured')
  const preview = await prepareSoccerFinalization(baseState)
  const gameId = baseState.cloudSync.gameId!
  const { data, error } = await supabase.rpc('finalize_soccer_event_game', {
    p_game_id: gameId,
    p_primary_recorded_by: preview.recorder.recorderId,
    p_event_revisions: soccerEventRevisionCheckpoint(preview.projection.state),
    p_stream_fingerprint: soccerEventStreamFingerprint(preview.projection.state),
    p_canonical_snapshot: preview.snapshot,
  })
  if (error) throw new Error(`Soccer finalization failed: ${error.message}`)
  const row = objectRow(data)
  return {
    publicationId: requiredString(row.publication_id, 'publication id'),
    publicationNumber: requiredInteger(row.publication_number, 'publication number'),
    primaryRecorderId: requiredString(row.primary_recorded_by, 'primary recorder'),
    finalizedAt: requiredString(row.finalized_at, 'finalized time'),
  }
}

export async function reopenSoccerCloudGame(
  gameId: string,
  reason: string
): Promise<void> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { error } = await supabase.rpc('reopen_soccer_event_game', {
    p_game_id: gameId,
    p_reason: reason.trim(),
  })
  if (error) throw new Error(`Soccer game could not reopen: ${error.message}`)
}

export async function loadSoccerCanonicalPublication(
  gameId: string
): Promise<SoccerCanonicalPublication | null> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { data, error } = await supabase.rpc('get_soccer_canonical_publication', {
    p_game_id: gameId,
  })
  if (error) throw new Error(`Canonical soccer result could not load: ${error.message}`)
  if (!Array.isArray(data) || data.length === 0) return null
  const row = objectRow(data[0])
  return {
    publicationId: requiredString(row.publication_id, 'publication id'),
    publicationNumber: requiredInteger(row.publication_number, 'publication number'),
    primaryRecorderId: requiredString(row.primary_recorded_by, 'primary recorder'),
    primaryDisplayName: requiredString(row.primary_display_name, 'primary recorder name'),
    snapshot: parseCanonicalSnapshot(row.canonical_snapshot),
    snapshotFingerprint: requiredString(row.snapshot_fingerprint, 'snapshot fingerprint'),
    finalizedBy: requiredString(row.finalized_by, 'finalization actor'),
    finalizedByDisplayName: requiredString(
      row.finalized_by_display_name,
      'finalization actor name'
    ),
    finalizedAt: requiredString(row.finalized_at, 'finalization time'),
  }
}

export async function loadSoccerCanonicalOrPrimaryReview(gameId: string): Promise<{
  recorders: SoccerRecorderSummary[]
  primary: SoccerRecorderProjection
  publication: SoccerCanonicalPublication | null
}> {
  const [live, publication] = await Promise.all([
    loadSoccerPrimaryCloudReview(gameId),
    loadSoccerCanonicalPublication(gameId),
  ])
  if (!publication) return { ...live, publication: null }
  const recorder =
    live.recorders.find(item => item.recorderId === publication.primaryRecorderId) ??
    live.primary.recorder
  return {
    recorders: live.recorders,
    primary: soccerProjectionFromCanonicalSnapshot(
      live.primary.state,
      recorder,
      publication.snapshot
    ),
    publication,
  }
}

export async function loadSoccerPrimaryFinalizationConflicts(
  gameId: string
): Promise<SoccerPrimaryFinalizationConflict[]> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { data, error } = await supabase.rpc(
    'get_soccer_primary_conflicts_for_finalization',
    { p_game_id: gameId }
  )
  if (error) throw new Error(`Primary conflicts could not load: ${error.message}`)
  if (!Array.isArray(data)) throw new Error('Primary conflict response is invalid.')
  return data.map(raw => {
    const row = objectRow(raw)
    const localEvent = row.local_event
    const remoteEvent = row.remote_event
    if (!isGameEventEnvelope(localEvent) || !isGameEventEnvelope(remoteEvent)) {
      throw new Error('Primary conflict contains an invalid event.')
    }
    return {
      conflictId: requiredString(row.conflict_id, 'conflict id'),
      recorderId: requiredString(row.recorded_by, 'recorder id'),
      recorderDisplayName: requiredString(row.recorder_display_name, 'recorder name'),
      eventId: requiredString(row.event_id, 'event id'),
      localEvent,
      remoteEvent,
      detectedAt: requiredString(row.detected_at, 'conflict time'),
    }
  })
}

export async function resolveSoccerPrimaryFinalizationConflict(
  conflictId: string,
  resolution: 'local' | 'remote'
): Promise<void> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { error } = await supabase.rpc(
    'resolve_soccer_primary_conflict_for_finalization',
    {
      p_conflict_id: conflictId,
      p_resolution: resolution,
    }
  )
  if (error) throw new Error(`Primary conflict could not resolve: ${error.message}`)
}

export function createSoccerCanonicalSnapshot(
  gameId: string,
  recorderId: string,
  projection: SoccerRecorderProjection
): SoccerCanonicalSnapshot {
  const soccerState = projection.state.sportGameState
  if (!projection.eventStream || soccerState?.sportId !== 'soccer') {
    throw new Error('Primary soccer projection is unavailable.')
  }
  return {
    version: 2,
    sportId: 'soccer',
    gameId,
    primaryRecorderId: recorderId,
    eventStream: structuredClone(projection.eventStream),
    sportGameState: {
      sportId: 'soccer',
      version: soccerState.version,
      setup: structuredClone(soccerState.setup),
    },
  }
}

async function confirmPrimaryCheckpoint(
  gameId: string,
  recorderId: string,
  projection: SoccerRecorderProjection
): Promise<void> {
  if (!supabase) throw new Error('Supabase client not configured')
  const revisions = soccerEventRevisionCheckpoint(projection.state)
  const maxSequence = projection.eventStream.events.reduce<number>(
    (max, event) => isGameEventEnvelope(event) ? Math.max(max, event.sequence) : max,
    -1
  )
  const { error } = await supabase.rpc(
    'confirm_soccer_primary_checkpoint_for_finalization',
    {
      p_game_id: gameId,
      p_primary_recorded_by: recorderId,
      p_stream_version: projection.eventStream.version,
      p_event_revisions: revisions,
      p_event_count: revisions.length,
      p_max_sequence: maxSequence,
      p_stream_fingerprint: soccerEventStreamFingerprint(projection.state),
    }
  )
  if (error) throw new Error(`Primary checkpoint could not confirm: ${error.message}`)
}

export function soccerProjectionFromCanonicalSnapshot(
  baseState: GameState,
  recorder: SoccerRecorderSummary,
  snapshot: SoccerCanonicalSnapshot
): SoccerRecorderProjection {
  const rebuilt = rebuildSoccerCanonicalSnapshot(baseState, recorder, snapshot)
  const soccerState = rebuilt.state.sportGameState
  if (
    !rebuilt.inspection.complete ||
    soccerState?.sportId !== 'soccer' ||
    soccerState.projection.status !== 'ended' ||
    (
      soccerState.projection.endReason !== 'completed' &&
      soccerState.projection.endReason !== 'abandoned'
    )
  ) {
    throw new Error('Canonical soccer events do not reproduce a final match.')
  }
  return rebuilt
}

export function inspectSoccerCanonicalSnapshot(
  baseState: GameState,
  recorder: SoccerRecorderSummary,
  snapshot: SoccerCanonicalSnapshot
): SoccerRecorderProjection {
  const rebuilt = rebuildSoccerCanonicalSnapshot(baseState, recorder, snapshot)
  const soccerState = rebuilt.state.sportGameState
  const reproducesFinal =
    soccerState?.sportId === 'soccer' &&
    soccerState.projection.status === 'ended' &&
    (
      soccerState.projection.endReason === 'completed' ||
      soccerState.projection.endReason === 'abandoned'
    )
  if (!rebuilt.inspection.complete || reproducesFinal) return rebuilt
  return {
    ...rebuilt,
    inspection: {
      ...rebuilt.inspection,
      complete: false,
      diagnostics: [
        ...rebuilt.inspection.diagnostics,
        {
          code: 'semantic_validation_failed',
          message: 'Canonical soccer events do not reproduce a final match.',
          eventId: null,
        },
      ],
    },
  }
}

function rebuildSoccerCanonicalSnapshot(
  baseState: GameState,
  recorder: SoccerRecorderSummary,
  snapshot: SoccerCanonicalSnapshot
): SoccerRecorderProjection {
  const stream = normalizeGameEventStream(snapshot.eventStream)
  const normalized = normalizeSoccerSportGameState({
    sportId: 'soccer',
    version: snapshot.sportGameState.version,
    setup: snapshot.sportGameState.setup,
  })
  if (!stream || !normalized || normalized.sportId !== 'soccer') {
    throw new Error('Canonical soccer snapshot is invalid.')
  }
  const rebuilt = rebuildGameEventProjection(
    {
      ...baseState,
      eventStream: stream,
      sportGameState: createSoccerSportGameState(normalized.setup),
      cloudSync: {
        ...baseState.cloudSync,
        gameStatus: 'final',
      },
    },
    gameEventRegistry,
    gameEventProjectors
  )
  return {
    recorder,
    state: rebuilt.state,
    eventStream: stream,
    inspection: rebuilt.inspection,
  }
}

function parseCanonicalSnapshot(value: unknown): SoccerCanonicalSnapshot {
  if (
    !isPlainObject(value) ||
    value.version !== 2 ||
    value.sportId !== 'soccer' ||
    typeof value.gameId !== 'string' ||
    typeof value.primaryRecorderId !== 'string' ||
    !isPlainObject(value.eventStream) ||
    !isPlainObject(value.sportGameState) ||
    value.sportGameState.sportId !== 'soccer' ||
    !isPlainObject(value.sportGameState.setup) ||
    'projection' in value.sportGameState
  ) {
    throw new Error('Canonical soccer snapshot is invalid.')
  }
  return value as unknown as SoccerCanonicalSnapshot
}

function firstRow(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error('Finalization readiness response is invalid.')
  }
  return objectRow(value[0])
}

function objectRow(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Soccer finalization response is invalid.')
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Invalid ${label}.`)
  return value
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function requiredInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}.`)
  }
  return parsed
}
