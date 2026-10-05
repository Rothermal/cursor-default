import type { GameState } from '../../types'
import { isPlainObject } from '../gameEvents/envelope'
import {
  confirmEventPrimaryCheckpoint,
  finalizeEventGame,
  loadEventCanonicalPublication,
  loadEventCanonicalPublicationHistory,
  loadEventFinalizationReadiness,
  loadEventPrimaryFinalizationConflicts,
  reopenEventGame,
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
  loadHockeyGameRecorders,
  loadHockeyRecorderProjection,
  type HockeyRecorderProjection,
  type HockeyRecorderSummary,
} from './recorders'
import { normalizeHockeySportGameState } from './state'
import {
  HOCKEY_GAME_STATE_VERSION,
  type HockeyMatchProjection,
  type HockeyMatchSetup,
} from './types'

/** Migration 073 accepts only canonical payload schema 1 inside the shared version 2 envelope. */
export const HOCKEY_CANONICAL_PAYLOAD_SCHEMA_VERSION = 1
const CANONICAL_ENVELOPE_VERSION = 2

export const HOCKEY_FINALIZATION_RPCS: EventFinalizationRpcs = {
  label: 'Hockey',
  readiness: 'get_hockey_finalization_readiness',
  conflicts: 'get_hockey_primary_conflicts_for_finalization',
  resolveConflict: 'resolve_hockey_primary_conflict_for_finalization',
  confirmCheckpoint: 'confirm_hockey_primary_checkpoint_for_finalization',
  publication: 'get_hockey_canonical_publication',
  publicationHistory: 'get_hockey_canonical_publication_history',
  finalize: 'finalize_hockey_event_game',
  reopen: 'reopen_hockey_event_game',
}

export interface HockeyCanonicalSnapshot {
  version: typeof CANONICAL_ENVELOPE_VERSION
  canonicalSchemaVersion: typeof HOCKEY_CANONICAL_PAYLOAD_SCHEMA_VERSION
  sportId: 'hockey'
  gameId: string
  primaryRecorderId: string
  eventStream: GameEventStream
  /** Setup only: the server compares it with the stored setup and rejects a cached projection. */
  sportGameState: {
    sportId: 'hockey'
    version: typeof HOCKEY_GAME_STATE_VERSION
    setup: HockeyMatchSetup
  }
}

export type HockeyFinalizationReadiness = EventFinalizationReadiness
export type HockeyCanonicalPublication = EventCanonicalPublication<HockeyCanonicalSnapshot>
export type HockeyCanonicalPublicationHistoryEntry = EventCanonicalPublicationHistoryEntry
export type HockeyPrimaryFinalizationConflict = EventPrimaryFinalizationConflict
export type HockeyFinalizationEndReason = 'completed' | 'abandoned'

export interface HockeyFinalizationPreview {
  gameId: string
  readiness: HockeyFinalizationReadiness
  recorder: HockeyRecorderSummary
  projection: HockeyRecorderProjection
  snapshot: HockeyCanonicalSnapshot | null
  /** The client's reading of the score the server will publish; the server's score wins. */
  score: { tracked: number; opponent: number } | null
  endReason: HockeyFinalizationEndReason | null
}

export interface HockeyFinalizationResult {
  publicationId: string
  publicationNumber: number
  primaryRecorderId: string
  finalizedAt: string
  /** The score stored on the game by the server; the preview score only when it could not be read back. */
  score: { tracked: number; opponent: number }
  serverScoreConfirmed: boolean
  /** The score the review showed; differs from `score` only when the server counted otherwise. */
  previewScore: { tracked: number; opponent: number }
  endReason: HockeyFinalizationEndReason
}

export interface HockeyReopenResult {
  gameId: string
  publicationId: string
  reason: string
  reopenedAt: string
}

export function loadHockeyFinalizationReadiness(gameId: string): Promise<HockeyFinalizationReadiness> {
  return loadEventFinalizationReadiness(HOCKEY_FINALIZATION_RPCS, gameId)
}

export function loadHockeyCanonicalPublication(gameId: string): Promise<HockeyCanonicalPublication | null> {
  return loadEventCanonicalPublication(HOCKEY_FINALIZATION_RPCS, gameId, parseHockeyCanonicalSnapshot)
}

export function loadHockeyCanonicalPublicationHistory(
  gameId: string
): Promise<HockeyCanonicalPublicationHistoryEntry[]> {
  return loadEventCanonicalPublicationHistory(HOCKEY_FINALIZATION_RPCS, gameId)
}

export function loadHockeyPrimaryFinalizationConflicts(
  gameId: string
): Promise<HockeyPrimaryFinalizationConflict[]> {
  return loadEventPrimaryFinalizationConflicts(HOCKEY_FINALIZATION_RPCS, gameId)
}

export function resolveHockeyPrimaryFinalizationConflict(
  conflictId: string,
  resolution: 'local' | 'remote'
): Promise<void> {
  return resolveEventPrimaryFinalizationConflict(HOCKEY_FINALIZATION_RPCS, conflictId, resolution)
}

/**
 * The score the server publishes (073 `validate_hockey_finalization_policy`): goals plus score
 * adjustments, with one goal for the winner of a decided shootout. An ended match carries it as
 * `result.finalScore`; an abandoned one adds the shootout goal the same way.
 */
export function hockeyPublishedScore(projection: HockeyMatchProjection): { tracked: number; opponent: number } {
  if (projection.result) return { ...projection.result.finalScore }
  const winner = projection.shootout?.winner ?? null
  return {
    tracked: projection.score.tracked + (winner === 'tracked' ? 1 : 0),
    opponent: projection.score.opponent + (winner === 'opponent' ? 1 : 0),
  }
}

/** Ended and abandoned games publish; a suspended game must end or be abandoned first (plan Q2). */
export function hockeyFinalizationEndReason(
  projection: HockeyMatchProjection
): HockeyFinalizationEndReason | null {
  if (projection.status === 'ended') return 'completed'
  if (projection.status === 'abandoned') return 'abandoned'
  return null
}

export async function prepareHockeyFinalization(gameId: string): Promise<HockeyFinalizationPreview> {
  let readiness = await loadHockeyFinalizationReadiness(gameId)
  if (!readiness.canFinalize) {
    throw new Error('Owner, admin, or personal-game creator access is required to finalize.')
  }
  if (!readiness.primaryRecorderId) throw new Error('Choose a healthy primary recorder before finalizing.')
  if (readiness.primaryConflictCount > 0) {
    throw new Error('Resolve the primary recorder conflicts before finalizing.')
  }

  const recorders = await loadHockeyGameRecorders(gameId)
  const recorder = recorders.find(item => item.recorderId === readiness.primaryRecorderId)
  if (!recorder) throw new Error('Primary recorder stream is unavailable.')

  const projection = await loadHockeyRecorderProjection(gameId, recorder)
  const hockeyState = projection.state.sportGameState?.sportId === 'hockey'
    ? projection.state.sportGameState
    : null
  if (!projection.inspection.complete || !hockeyState) {
    throw new Error(projection.inspection.diagnostics[0]?.message ?? 'Primary recorder projection needs attention.')
  }
  const endReason = hockeyFinalizationEndReason(hockeyState.projection)
  if (!endReason) throw new Error('End or abandon the primary Hockey game before finalizing.')

  // Readiness never compares the stored fingerprint with this freshly loaded stream.
  await confirmEventPrimaryCheckpoint(
    HOCKEY_FINALIZATION_RPCS,
    gameId,
    recorder.recorderId,
    projection.state,
    projection.eventStream
  )
  readiness = await loadHockeyFinalizationReadiness(gameId)
  if (
    !readiness.canFinalize ||
    readiness.primaryRecorderId !== recorder.recorderId ||
    !readiness.primaryEnded ||
    !readiness.primaryCheckpointCurrent ||
    readiness.primaryConflictCount > 0
  ) {
    throw new Error('Primary recorder readiness changed. Review finalization again.')
  }

  return {
    gameId,
    readiness,
    recorder,
    projection,
    snapshot: createHockeyCanonicalSnapshot(gameId, recorder.recorderId, projection.state),
    score: hockeyPublishedScore(hockeyState.projection),
    endReason,
  }
}

export async function finalizeHockeyGame(preview: HockeyFinalizationPreview): Promise<HockeyFinalizationResult> {
  if (!preview.snapshot || !preview.score || !preview.endReason || !preview.projection.inspection.complete) {
    throw new Error('Hockey finalization preview is not publishable.')
  }
  const snapshot = createHockeyCanonicalSnapshot(preview.gameId, preview.recorder.recorderId, preview.projection.state)
  const published = await finalizeEventGame(HOCKEY_FINALIZATION_RPCS, {
    gameId: preview.gameId,
    recorderId: preview.recorder.recorderId,
    state: preview.projection.state,
    snapshot,
  })
  const serverScore = await loadPublishedScore(preview.gameId)
  return {
    ...published,
    score: serverScore ?? { ...preview.score },
    serverScoreConfirmed: serverScore !== null,
    previewScore: { ...preview.score },
    endReason: preview.endReason,
  }
}

export function reopenHockeyCloudGame(gameId: string, reason: string): Promise<HockeyReopenResult> {
  return reopenEventGame(HOCKEY_FINALIZATION_RPCS, gameId, reason)
}

export function createHockeyCanonicalSnapshot(
  gameId: string,
  recorderId: string,
  state: GameState
): HockeyCanonicalSnapshot {
  if (!gameId.trim() || !recorderId.trim()) throw new Error('Hockey canonical identity is invalid.')
  if (state.gameDataAuthority !== 'sport_events' || !state.eventStream || state.sportGameState?.sportId !== 'hockey') {
    throw new Error('Hockey canonical source is unavailable.')
  }
  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  if (!inspection.complete) {
    throw new Error(inspection.diagnostics[0]?.message ?? 'Hockey canonical event stream is invalid.')
  }
  assertRecorderOwnership([...inspection.activeEvents, ...inspection.deletedEvents], recorderId)
  const rebuilt = rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors)
  if (!rebuilt.inspection.complete || rebuilt.state.sportGameState?.sportId !== 'hockey') {
    throw new Error(
      rebuilt.inspection.diagnostics[0]?.message ?? 'Hockey canonical event stream does not project completely.'
    )
  }
  return {
    version: CANONICAL_ENVELOPE_VERSION,
    canonicalSchemaVersion: HOCKEY_CANONICAL_PAYLOAD_SCHEMA_VERSION,
    sportId: 'hockey',
    gameId,
    primaryRecorderId: recorderId,
    eventStream: structuredClone(state.eventStream),
    sportGameState: {
      sportId: 'hockey',
      version: HOCKEY_GAME_STATE_VERSION,
      setup: structuredClone(state.sportGameState.setup),
    },
  }
}

export function parseHockeyCanonicalSnapshot(value: unknown): HockeyCanonicalSnapshot {
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
    value.version !== CANONICAL_ENVELOPE_VERSION ||
    value.canonicalSchemaVersion !== HOCKEY_CANONICAL_PAYLOAD_SCHEMA_VERSION ||
    value.sportId !== 'hockey' ||
    !isNonEmptyString(value.gameId) ||
    !isNonEmptyString(value.primaryRecorderId) ||
    !isPlainObject(value.eventStream) ||
    !hasOnlyKeys(value.eventStream, ['version', 'events']) ||
    !isPlainObject(value.sportGameState) ||
    !hasOnlyKeys(value.sportGameState, ['sportId', 'version', 'setup']) ||
    value.sportGameState.sportId !== 'hockey' ||
    value.sportGameState.version !== HOCKEY_GAME_STATE_VERSION ||
    !isPlainObject(value.sportGameState.setup)
  ) {
    throw new Error('Hockey canonical snapshot is invalid.')
  }
  const eventStream = normalizeGameEventStream(value.eventStream)
  const sportState = normalizeHockeySportGameState({
    sportId: 'hockey',
    version: value.sportGameState.version,
    setup: value.sportGameState.setup,
  })
  if (!eventStream || !sportState) throw new Error('Hockey canonical snapshot is invalid.')
  const inspection = inspectGameEventStream(eventStream, gameEventRegistry)
  if (!inspection.complete) throw new Error('Hockey canonical snapshot contains invalid events.')
  assertRecorderOwnership([...inspection.activeEvents, ...inspection.deletedEvents], value.primaryRecorderId)
  return {
    version: CANONICAL_ENVELOPE_VERSION,
    canonicalSchemaVersion: HOCKEY_CANONICAL_PAYLOAD_SCHEMA_VERSION,
    sportId: 'hockey',
    gameId: value.gameId,
    primaryRecorderId: value.primaryRecorderId,
    eventStream: structuredClone(eventStream),
    sportGameState: { sportId: 'hockey', version: HOCKEY_GAME_STATE_VERSION, setup: structuredClone(sportState.setup) },
  }
}

/** Reads back the score the server stored on the game; null when it cannot be read. */
async function loadPublishedScore(gameId: string): Promise<{ tracked: number; opponent: number } | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .from('games')
      .select('home_team_score, opponent_score')
      .eq('id', gameId)
      .maybeSingle()
    if (error || !isPlainObject(data)) return null
    const tracked = data.home_team_score
    const opponent = data.opponent_score
    if (!Number.isSafeInteger(tracked) || !Number.isSafeInteger(opponent)) return null
    return { tracked: tracked as number, opponent: opponent as number }
  } catch {
    return null
  }
}

function assertRecorderOwnership(
  events: Array<{ sportId: string; recorderUserId: string | null }>,
  recorderId: string
): void {
  if (events.some(event => event.sportId !== 'hockey' || event.recorderUserId !== recorderId)) {
    throw new Error('Hockey canonical events do not belong to the primary recorder.')
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every(key => allowedKeys.has(key))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
