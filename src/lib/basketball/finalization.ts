import type { GameState } from '../../types'
import { eventRevisionCheckpoint, eventStreamFingerprint } from '../gameEvents/cloudTransport'
import { isPlainObject } from '../gameEvents/envelope'
import {
  confirmEventPrimaryCheckpoint,
  loadEventCanonicalPublication,
  loadEventCanonicalPublicationHistory,
  loadEventFinalizationReadiness,
  loadEventPrimaryFinalizationConflicts,
  resolveEventPrimaryFinalizationConflict,
  type EventCanonicalPublication,
  type EventCanonicalPublicationHistoryEntry,
  type EventFinalizationReadiness,
  type EventFinalizationRpcs,
  type EventPrimaryFinalizationConflict,
} from '../gameEvents/finalization'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { inspectGameEventStream, normalizeGameEventStream } from '../gameEvents/stream'
import type { GameEventStream } from '../gameEvents/types'
import { supabase } from '../supabase'
import {
  basketballAnchoredFinalizationBlockerMessage,
  evaluateBasketballAnchoredFinalization,
  isBasketballAnchoredFinalizationBlockerCode,
  type BasketballAnchoredFinalizationBlocker,
} from './anchoredFinalization'
import { authorizeBasketballAnchoredCloudMutation } from './cloudAuthorization'
import {
  loadBasketballGameRecorders,
  loadBasketballRecorderProjection,
  type BasketballRecorderProjection,
  type BasketballRecorderSummary,
} from './recorders'
import {
  BASKETBALL_GAME_STATE_VERSION,
  type BasketballMatchSetup,
  type BasketballReopenMode,
} from './types'
import { createBasketballSportGameState, normalizeBasketballSportGameState } from './state'

export const BASKETBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION = 1
export const EVENT_PLATFORM_CANONICAL_ENVELOPE_VERSION = 2

const BASKETBALL_FINALIZATION_RPCS: EventFinalizationRpcs = {
  label: 'Basketball',
  readiness: 'get_basketball_finalization_readiness',
  conflicts: 'get_basketball_primary_conflicts_for_finalization',
  resolveConflict: 'resolve_basketball_primary_conflict_for_finalization',
  confirmCheckpoint: 'confirm_basketball_primary_checkpoint_for_finalization',
  publication: 'get_basketball_canonical_publication',
  publicationHistory: 'get_basketball_canonical_publication_history_v1',
  finalize: 'finalize_basketball_event_game',
  reopen: 'reopen_basketball_event_game',
}

export interface BasketballCanonicalSnapshot {
  version: typeof EVENT_PLATFORM_CANONICAL_ENVELOPE_VERSION
  canonicalSchemaVersion: typeof BASKETBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION
  sportId: 'basketball'
  gameId: string
  primaryRecorderId: string
  eventStream: GameEventStream
  sportGameState: {
    sportId: 'basketball'
    version: typeof BASKETBALL_GAME_STATE_VERSION
    setup: BasketballMatchSetup
  }
}

export type BasketballFinalizationReadiness = EventFinalizationReadiness

export type BasketballCanonicalPublication = EventCanonicalPublication<BasketballCanonicalSnapshot>

export type BasketballPrimaryFinalizationConflict = EventPrimaryFinalizationConflict

export interface BasketballFinalizationPreview {
  gameId: string
  readiness: BasketballFinalizationReadiness
  recorder: BasketballRecorderSummary
  projection: BasketballRecorderProjection
  snapshot: BasketballCanonicalSnapshot | null
  score: { tracked: number; opponent: number } | null
  endReason: 'completed' | 'abandoned' | null
  anchored: boolean
  blockers: BasketballAnchoredFinalizationBlocker[]
}

export interface BasketballFinalizationResult {
  publicationId: string
  publicationNumber: number
  primaryRecorderId: string
  finalizedAt: string
  score: { tracked: number; opponent: number }
  endReason: 'completed' | 'abandoned'
}

export type BasketballCanonicalPublicationHistoryEntry = EventCanonicalPublicationHistoryEntry & {
  reopenMode: BasketballReopenMode | null
}

export interface BasketballReopenResult {
  gameId: string
  publicationId: string
  primaryRecorderId: string | null
  reason: string
  mode: BasketballReopenMode | null
  reopenedAt: string
}

export interface BasketballFinalizationMutationOptions {
  userId: string
  assertCurrent?: () => void
}

export function loadBasketballFinalizationReadiness(
  gameId: string
): Promise<BasketballFinalizationReadiness> {
  return loadEventFinalizationReadiness(BASKETBALL_FINALIZATION_RPCS, gameId)
}

export async function prepareBasketballFinalization(
  gameId: string,
  options?: BasketballFinalizationMutationOptions
): Promise<BasketballFinalizationPreview> {
  let readiness = await loadBasketballFinalizationReadiness(gameId)
  if (!readiness.canFinalize) {
    throw new Error('Owner, admin, or personal-game creator access is required to finalize.')
  }
  if (!readiness.primaryRecorderId) {
    throw new Error('Choose a healthy primary recorder before finalizing.')
  }
  if (readiness.primaryConflictCount > 0) {
    throw new Error('Resolve the primary recorder conflicts before finalizing.')
  }

  const recorders = await loadBasketballGameRecorders(gameId)
  const recorder = recorders.find(item => item.recorderId === readiness.primaryRecorderId)
  if (!recorder) throw new Error('Primary recorder stream is unavailable.')

  const projection = await loadBasketballRecorderProjection(gameId, recorder)
  const basketballState = projection.state.sportGameState?.sportId === 'basketball'
    ? projection.state.sportGameState
    : null
  const anchoredEvaluation = evaluateBasketballAnchoredFinalization(projection.state, {
    projectionComplete: projection.inspection.complete,
  })
  if (!anchoredEvaluation.applicable) {
    if (!projection.inspection.complete || !basketballState) {
      throw new Error(
        projection.inspection.diagnostics[0]?.message ??
          'Primary recorder projection needs attention.'
      )
    }
    const legacyEndReason = basketballState.projection.endReason
    if (
      basketballState.projection.status !== 'ended' ||
      (legacyEndReason !== 'completed' && legacyEndReason !== 'abandoned')
    ) {
      throw new Error('Complete or abandon the primary Basketball game before finalizing.')
    }
    if (
      legacyEndReason === 'completed' &&
      basketballState.projection.score.tracked === basketballState.projection.score.opponent
    ) {
      throw new Error('A tied Basketball game requires another overtime.')
    }
  }
  if (anchoredEvaluation.applicable) {
    if (!options?.userId) {
      throw new Error('Sign in again before finalizing this Basketball clock game.')
    }
    await authorizeBasketballAnchoredCloudMutation({
      state: projection.state,
      userId: options.userId,
      assertCurrent: options.assertCurrent,
    })
  }

  const endReason = basketballState?.projection.endReason
  const terminal = projection.inspection.complete &&
    basketballState?.projection.status === 'ended' &&
    (endReason === 'completed' || endReason === 'abandoned')
  if (terminal) {
    // The shared readiness check does not compare the stored fingerprint with
    // this freshly loaded projection, so exact confirmation cannot be skipped.
    await confirmPrimaryCheckpoint(gameId, recorder.recorderId, projection)
    readiness = await loadBasketballFinalizationReadiness(gameId)
    if (
      !readiness.canFinalize ||
      readiness.primaryRecorderId !== recorder.recorderId ||
      !readiness.primaryEnded ||
      !readiness.primaryCheckpointCurrent ||
      readiness.primaryConflictCount > 0
    ) {
      throw new Error('Primary recorder readiness changed. Review finalization again.')
    }
  }

  const serverBlockers = anchoredEvaluation.applicable
    ? await loadBasketballAnchoredFinalizationBlockers(
        gameId,
        recorder.recorderId
      )
    : []
  const blockers = mergeAnchoredFinalizationBlockers(
    anchoredEvaluation.blockers,
    serverBlockers
  )

  return {
    gameId,
    readiness,
    recorder,
    projection,
    snapshot: terminal
      ? createBasketballCanonicalSnapshot(gameId, recorder.recorderId, projection.state)
      : null,
    score: projection.inspection.complete && basketballState
      ? { ...basketballState.projection.score }
      : null,
    endReason: terminal ? endReason : null,
    anchored: anchoredEvaluation.applicable,
    blockers,
  }
}

export async function finalizeBasketballGame(
  preview: BasketballFinalizationPreview,
  options?: BasketballFinalizationMutationOptions
): Promise<BasketballFinalizationResult> {
  if (!supabase) throw new Error('Supabase client not configured')
  if (preview.blockers.length > 0) {
    throw new Error('Resolve every Basketball finalization blocker before publishing.')
  }
  if (!preview.snapshot || !preview.score || !preview.endReason || !preview.projection.inspection.complete) {
    throw new Error('Basketball finalization preview is not publishable.')
  }
  if (preview.anchored) {
    if (!options?.userId) {
      throw new Error('Sign in again before finalizing this Basketball clock game.')
    }
    await authorizeBasketballAnchoredCloudMutation({
      state: preview.projection.state,
      userId: options.userId,
      assertCurrent: options.assertCurrent,
    })
  }
  const snapshot = createBasketballCanonicalSnapshot(
    preview.gameId,
    preview.recorder.recorderId,
    preview.projection.state
  )
  const { data, error } = await supabase.rpc(
    preview.anchored
      ? 'finalize_basketball_anchored_event_game_v1'
      : 'finalize_basketball_event_game', {
    p_game_id: preview.gameId,
    p_primary_recorded_by: preview.recorder.recorderId,
    p_event_revisions: eventRevisionCheckpoint(preview.projection.state),
    p_stream_fingerprint: eventStreamFingerprint(preview.projection.state),
    p_canonical_snapshot: snapshot,
    }
  )
  if (error) throw new Error(`Basketball finalization failed: ${error.message}`)
  const row = objectRow(data)
  const primaryRecorderId = requiredString(row.primary_recorded_by, 'primary recorder')
  if (primaryRecorderId !== preview.recorder.recorderId) {
    throw new Error('Basketball finalization returned a different primary recorder.')
  }
  return {
    publicationId: requiredString(row.publication_id, 'publication id'),
    publicationNumber: requiredInteger(row.publication_number, 'publication number'),
    primaryRecorderId,
    finalizedAt: requiredTimestamp(row.finalized_at, 'finalized time'),
    score: { ...preview.score },
    endReason: preview.endReason,
  }
}

export async function reopenBasketballCloudGame(
  gameId: string,
  reason: string,
  options?: {
    mode?: BasketballReopenMode
    authorityState?: GameState
    userId?: string
    assertCurrent?: () => void
  }
): Promise<BasketballReopenResult> {
  if (!supabase) throw new Error('Supabase client not configured')
  const trimmedReason = reason.trim()
  if (trimmedReason.length < 3) throw new Error('A reopen reason is required.')

  if (options?.mode) {
    if (!options.authorityState || !options.userId) {
      throw new Error('Anchored Basketball reopen authority is unavailable.')
    }
    await authorizeBasketballAnchoredCloudMutation({
      state: options.authorityState,
      userId: options.userId,
      assertCurrent: options.assertCurrent,
    })
  }

  const { data, error } = await supabase.rpc(
    options?.mode
      ? 'reopen_basketball_anchored_event_game_v1'
      : 'reopen_basketball_event_game',
    options?.mode
      ? { p_game_id: gameId, p_reason: trimmedReason, p_mode: options.mode }
      : { p_game_id: gameId, p_reason: trimmedReason }
  )
  if (error) throw new Error(`Basketball game could not reopen: ${error.message}`)

  const row = objectRow(data)
  const reopenedGameId = requiredString(row.game_id, 'reopened game id')
  if (reopenedGameId !== gameId) {
    throw new Error('Basketball reopen returned a different game.')
  }
  const returnedReason = options?.mode
    ? requiredString(row.reason, 'reopen reason')
    : trimmedReason
  const returnedMode = options?.mode
    ? nullableBasketballReopenMode(row.mode)
    : null
  if (
    options?.mode &&
    (returnedMode !== options.mode || returnedReason !== trimmedReason)
  ) {
    throw new Error('Basketball reopen returned different mode or reason authority.')
  }
  return {
    gameId: reopenedGameId,
    publicationId: requiredString(row.publication_id, 'invalidated publication id'),
    primaryRecorderId: options?.mode
      ? requiredString(row.primary_recorded_by, 'primary recorder')
      : null,
    reason: returnedReason,
    mode: returnedMode,
    reopenedAt: requiredTimestamp(row.reopened_at, 'reopen time'),
  }
}

export function loadBasketballCanonicalPublication(
  gameId: string
): Promise<BasketballCanonicalPublication | null> {
  return loadEventCanonicalPublication(
    BASKETBALL_FINALIZATION_RPCS,
    gameId,
    parseBasketballCanonicalSnapshot
  )
}

export function loadBasketballCanonicalPublicationHistory(
  gameId: string
): Promise<BasketballCanonicalPublicationHistoryEntry[]> {
  return loadEventCanonicalPublicationHistory(
    BASKETBALL_FINALIZATION_RPCS,
    gameId,
    row => ({
      reopenMode: row.invalidation_mode === undefined
        ? null
        : nullableBasketballReopenMode(row.invalidation_mode),
    })
  )
}

export function basketballCanonicalAuthorityState(
  baseState: GameState,
  publication: BasketballCanonicalPublication
): GameState {
  const candidate: GameState = {
    ...baseState,
    gameDataAuthority: 'sport_events',
    eventStream: structuredClone(publication.snapshot.eventStream),
    sportGameState: createBasketballSportGameState(
      publication.snapshot.sportGameState.setup
    ),
    cloudSync: {
      ...baseState.cloudSync,
      gameId: publication.snapshot.gameId,
      gameStatus: 'final',
    },
  }
  const rebuilt = rebuildGameEventProjection(
    candidate,
    gameEventRegistry,
    gameEventProjectors
  )
  if (
    !rebuilt.inspection.complete ||
    rebuilt.state.sportGameState?.sportId !== 'basketball'
  ) {
    throw new Error('Canonical Basketball authority could not be reprojected.')
  }
  return rebuilt.state
}

export async function loadBasketballAnchoredFinalizationBlockers(
  gameId: string,
  recorderId: string
): Promise<BasketballAnchoredFinalizationBlocker[]> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { data, error } = await supabase.rpc(
    'get_basketball_anchored_finalization_readiness_v1',
    {
      p_game_id: gameId,
      p_primary_recorded_by: recorderId,
    }
  )
  if (error) {
    throw new Error(`Anchored Basketball readiness could not load: ${error.message}`)
  }
  const row = firstRow(data)
  if (!requiredBoolean(row.applicable, 'anchored readiness applicability')) {
    throw new Error('Anchored Basketball readiness returned a clockless source.')
  }
  if (!Array.isArray(row.blocker_codes)) {
    throw new Error('Anchored Basketball readiness blockers are invalid.')
  }
  const codes = row.blocker_codes.map(value => {
    if (!isBasketballAnchoredFinalizationBlockerCode(value)) {
      throw new Error('Anchored Basketball readiness returned an unknown blocker.')
    }
    return value
  })
  if (new Set(codes).size !== codes.length) {
    throw new Error('Anchored Basketball readiness returned duplicate blockers.')
  }
  return codes.map(code => ({
    code,
    message: basketballAnchoredFinalizationBlockerMessage(code),
  }))
}

export function loadBasketballPrimaryFinalizationConflicts(
  gameId: string
): Promise<BasketballPrimaryFinalizationConflict[]> {
  return loadEventPrimaryFinalizationConflicts(BASKETBALL_FINALIZATION_RPCS, gameId)
}

export function resolveBasketballPrimaryFinalizationConflict(
  conflictId: string,
  resolution: 'local' | 'remote'
): Promise<void> {
  return resolveEventPrimaryFinalizationConflict(
    BASKETBALL_FINALIZATION_RPCS,
    conflictId,
    resolution
  )
}

function confirmPrimaryCheckpoint(
  gameId: string,
  recorderId: string,
  projection: BasketballRecorderProjection
): Promise<void> {
  return confirmEventPrimaryCheckpoint(
    BASKETBALL_FINALIZATION_RPCS,
    gameId,
    recorderId,
    projection.state,
    projection.eventStream
  )
}

export function createBasketballCanonicalSnapshot(
  gameId: string,
  recorderId: string,
  state: GameState
): BasketballCanonicalSnapshot {
  if (!gameId.trim() || !recorderId.trim()) {
    throw new Error('Basketball canonical identity is invalid.')
  }
  if (
    state.gameDataAuthority !== 'sport_events' ||
    !state.eventStream ||
    state.sportGameState?.sportId !== 'basketball'
  ) {
    throw new Error('Basketball canonical source is unavailable.')
  }

  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  if (!inspection.complete) {
    throw new Error(
      inspection.diagnostics[0]?.message ?? 'Basketball canonical event stream is invalid.'
    )
  }
  assertRecorderOwnership(inspection.activeEvents, inspection.deletedEvents, recorderId)

  const rebuilt = rebuildGameEventProjection(
    state,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!rebuilt.inspection.complete || rebuilt.state.sportGameState?.sportId !== 'basketball') {
    throw new Error(
      rebuilt.inspection.diagnostics[0]?.message ??
        'Basketball canonical event stream does not project completely.'
    )
  }

  return {
    version: EVENT_PLATFORM_CANONICAL_ENVELOPE_VERSION,
    canonicalSchemaVersion: BASKETBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION,
    sportId: 'basketball',
    gameId,
    primaryRecorderId: recorderId,
    eventStream: structuredClone(state.eventStream),
    sportGameState: {
      sportId: 'basketball',
      version: state.sportGameState.version,
      setup: structuredClone(state.sportGameState.setup),
    },
  }
}

export function parseBasketballCanonicalSnapshot(
  value: unknown
): BasketballCanonicalSnapshot {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, [
      'version',
      'canonicalSchemaVersion',
      'sportId',
      'gameId',
      'primaryRecorderId',
      'eventStream',
      'sportGameState',
    ]) ||
    value.version !== EVENT_PLATFORM_CANONICAL_ENVELOPE_VERSION ||
    value.canonicalSchemaVersion !== BASKETBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION ||
    value.sportId !== 'basketball' ||
    !isNonEmptyString(value.gameId) ||
    !isNonEmptyString(value.primaryRecorderId) ||
    !isPlainObject(value.eventStream) ||
    !hasOnlyKeys(value.eventStream, ['version', 'events']) ||
    !isPlainObject(value.sportGameState) ||
    !hasOnlyKeys(value.sportGameState, ['sportId', 'version', 'setup']) ||
    value.sportGameState.sportId !== 'basketball' ||
    value.sportGameState.version !== BASKETBALL_GAME_STATE_VERSION ||
    !isPlainObject(value.sportGameState.setup)
  ) {
    throw new Error('Basketball canonical snapshot is invalid.')
  }

  const eventStream = normalizeGameEventStream(value.eventStream)
  const sportState = normalizeBasketballSportGameState({
    sportId: 'basketball',
    version: value.sportGameState.version,
    setup: value.sportGameState.setup,
  })
  if (!eventStream || !sportState) {
    throw new Error('Basketball canonical snapshot is invalid.')
  }

  const inspection = inspectGameEventStream(eventStream, gameEventRegistry)
  if (!inspection.complete) {
    throw new Error('Basketball canonical snapshot contains invalid events.')
  }
  assertRecorderOwnership(
    inspection.activeEvents,
    inspection.deletedEvents,
    value.primaryRecorderId
  )

  return {
    version: EVENT_PLATFORM_CANONICAL_ENVELOPE_VERSION,
    canonicalSchemaVersion: BASKETBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION,
    sportId: 'basketball',
    gameId: value.gameId,
    primaryRecorderId: value.primaryRecorderId,
    eventStream: structuredClone(eventStream),
    sportGameState: {
      sportId: 'basketball',
      version: BASKETBALL_GAME_STATE_VERSION,
      setup: structuredClone(sportState.setup),
    },
  }
}

function assertRecorderOwnership(
  activeEvents: Array<{ sportId: string; recorderUserId: string | null }>,
  deletedEvents: Array<{ sportId: string; recorderUserId: string | null }>,
  recorderId: string
): void {
  if (
    [...activeEvents, ...deletedEvents].some(event =>
      event.sportId !== 'basketball' || event.recorderUserId !== recorderId
    )
  ) {
    throw new Error('Basketball canonical events do not belong to the primary recorder.')
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every(key => allowedKeys.has(key))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function firstRow(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error('Basketball finalization response is invalid.')
  }
  return objectRow(value[0])
}

function objectRow(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error('Basketball finalization response is invalid.')
  }
  return value
}

function requiredString(value: unknown, label: string): string {
  if (!isNonEmptyString(value)) throw new Error(`Invalid ${label}.`)
  return value
}


function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label}.`)
  return value
}

function requiredInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}.`)
  }
  return parsed
}

function requiredTimestamp(value: unknown, label: string): string {
  const timestamp = requiredString(value, label)
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error(`Invalid ${label}.`)
  return timestamp
}


function nullableBasketballReopenMode(value: unknown): BasketballReopenMode | null {
  if (value === null) return null
  if (value !== 'correct_records' && value !== 'resume_game') {
    throw new Error('Invalid Basketball reopen mode.')
  }
  return value
}

function mergeAnchoredFinalizationBlockers(
  client: BasketballAnchoredFinalizationBlocker[],
  server: BasketballAnchoredFinalizationBlocker[]
): BasketballAnchoredFinalizationBlocker[] {
  const serverCodes = new Set(server.map(blocker => blocker.code))
  const merged = [...client]
  for (const blocker of server) {
    if (!merged.some(candidate => candidate.code === blocker.code)) merged.push(blocker)
  }
  if (client.some(blocker => (
    blocker.code !== 'source_invalid' && !serverCodes.has(blocker.code)
  ))) {
    throw new Error('Client and server Basketball readiness do not agree. Reload before finalizing.')
  }
  return merged
}
