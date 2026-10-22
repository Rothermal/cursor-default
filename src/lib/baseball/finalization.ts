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
  loadBaseballGameRecorders,
  loadBaseballRecorderProjection,
  type BaseballRecorderProjection,
  type BaseballRecorderSummary,
} from './recorders'
import { normalizeBaseballSportGameState } from './state'
import { baseballDecisionsView } from './decisions'
import { assertBaseballCloudAccount } from './cloudPolicy'
import { BASEBALL_GAME_END_LABELS } from './recentPlays'
import type { BaseballPersonalLinkReview } from './personalIdentity'
import {
  BASEBALL_GAME_STATE_VERSION,
  type BaseballGameEndOutcome,
  type BaseballMatchProjection,
  type BaseballMatchSetup,
} from './types'

/** Migration 077 accepts only canonical payload schema 1 inside the shared version 2 envelope. */
export const BASEBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION = 1
const CANONICAL_ENVELOPE_VERSION = 2

export const BASEBALL_FINALIZATION_RPCS: EventFinalizationRpcs = {
  label: 'Baseball',
  readiness: 'get_baseball_finalization_readiness',
  conflicts: 'get_baseball_primary_conflicts_for_finalization',
  resolveConflict: 'resolve_baseball_primary_conflict_for_finalization',
  confirmCheckpoint: 'confirm_baseball_primary_checkpoint_for_finalization',
  publication: 'get_baseball_canonical_publication',
  publicationHistory: 'get_baseball_canonical_publication_history',
  finalize: 'finalize_baseball_event_game',
  reopen: 'reopen_baseball_event_game',
}

export interface BaseballCanonicalSnapshot {
  version: typeof CANONICAL_ENVELOPE_VERSION
  canonicalSchemaVersion: typeof BASEBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION
  sportId: 'baseball'
  gameId: string
  primaryRecorderId: string
  eventStream: GameEventStream
  /** Setup only: the server compares it with the stored setup and rejects a cached projection. */
  sportGameState: {
    sportId: 'baseball'
    version: typeof BASEBALL_GAME_STATE_VERSION
    setup: BaseballMatchSetup
  }
}

export type BaseballFinalizationReadiness = EventFinalizationReadiness
export type BaseballCanonicalPublication = EventCanonicalPublication<BaseballCanonicalSnapshot>
export type BaseballCanonicalPublicationHistoryEntry = EventCanonicalPublicationHistoryEntry
export type BaseballPrimaryFinalizationConflict = EventPrimaryFinalizationConflict
export type BaseballFinalizationEndReason = Exclude<BaseballGameEndOutcome, 'suspended'>

export interface BaseballFinalizationPreview {
  gameId: string
  readiness: BaseballFinalizationReadiness
  recorder: BaseballRecorderSummary
  projection: BaseballRecorderProjection
  snapshot: BaseballCanonicalSnapshot | null
  /** The client's reading of the score the server will publish; the server's score wins. */
  score: { tracked: number; opponent: number } | null
  endReason: BaseballFinalizationEndReason | null
  pitcherDecisionsMissing: boolean
  endReasonLabel: string | null
  personalLinkReview?: BaseballPersonalLinkReview
}

export interface BaseballFinalizationResult {
  publicationId: string
  publicationNumber: number
  primaryRecorderId: string
  finalizedAt: string
  /** The score stored on the game by the server; the preview score only when it could not be read back. */
  score: { tracked: number; opponent: number }
  serverScoreConfirmed: boolean
  /** The score the review showed; differs from `score` only when the server counted otherwise. */
  previewScore: { tracked: number; opponent: number }
  endReason: BaseballFinalizationEndReason
}

export interface BaseballReopenResult {
  gameId: string
  publicationId: string
  reason: string
  reopenedAt: string
}

export function loadBaseballFinalizationReadiness(gameId: string): Promise<BaseballFinalizationReadiness> {
  return loadEventFinalizationReadiness(BASEBALL_FINALIZATION_RPCS, gameId)
}

export function loadBaseballCanonicalPublication(gameId: string): Promise<BaseballCanonicalPublication | null> {
  return loadEventCanonicalPublication(BASEBALL_FINALIZATION_RPCS, gameId, parseBaseballCanonicalSnapshot)
}

export function loadBaseballCanonicalPublicationHistory(
  gameId: string
): Promise<BaseballCanonicalPublicationHistoryEntry[]> {
  return loadEventCanonicalPublicationHistory(BASEBALL_FINALIZATION_RPCS, gameId)
}

export function loadBaseballPrimaryFinalizationConflicts(
  gameId: string
): Promise<BaseballPrimaryFinalizationConflict[]> {
  return loadEventPrimaryFinalizationConflicts(BASEBALL_FINALIZATION_RPCS, gameId)
}

export function resolveBaseballPrimaryFinalizationConflict(
  conflictId: string,
  resolution: 'local' | 'remote'
): Promise<void> {
  return resolveEventPrimaryFinalizationConflict(BASEBALL_FINALIZATION_RPCS, conflictId, resolution)
}

/**
 * The preview reads the replayed runs. The server independently replays runner movements
 * and score adjustments; its stored score remains authoritative.
 */
export function baseballPublishedScore(projection: BaseballMatchProjection): { tracked: number; opponent: number } {
  return { ...projection.score }
}

/** Every recorded end except suspension may publish (BSB-6 Q1). */
export function baseballFinalizationEndReason(
  projection: BaseballMatchProjection
): BaseballFinalizationEndReason | null {
  if (projection.status !== 'final' && projection.status !== 'abandoned') return null
  const outcome = projection.result?.outcome
  return outcome && outcome !== 'suspended' ? outcome : null
}

export async function prepareBaseballFinalization(gameId: string, userId?: string | null, options: { assertCurrent?: () => void; reviewPersonalLinks?: boolean } = {}): Promise<BaseballFinalizationPreview> {
  const assertCurrent = () => { options.assertCurrent?.(); if (userId !== undefined) assertBaseballCloudAccount(userId) }
  assertCurrent()
  let readiness = await loadBaseballFinalizationReadiness(gameId)
  assertCurrent()
  if (!readiness.canFinalize) {
    throw new Error('Owner, admin, or personal-game creator access is required to finalize.')
  }
  if (!readiness.primaryRecorderId) throw new Error('Choose a healthy primary recorder before finalizing.')
  if (readiness.primaryConflictCount > 0) {
    throw new Error('Resolve the primary recorder conflicts before finalizing.')
  }

  const recorders = await loadBaseballGameRecorders(gameId)
  assertCurrent()
  const recorder = recorders.find(item => item.recorderId === readiness.primaryRecorderId)
  if (!recorder) throw new Error('Primary recorder stream is unavailable.')

  const projection = await loadBaseballRecorderProjection(gameId, recorder, assertCurrent)
  assertCurrent()
  const baseballState = projection.state.sportGameState?.sportId === 'baseball'
    ? projection.state.sportGameState
    : null
  if (!projection.inspection.complete || !baseballState) {
    throw new Error(projection.inspection.diagnostics[0]?.message ?? 'Primary recorder projection needs attention.')
  }
  const endReason = baseballFinalizationEndReason(baseballState.projection)
  if (!endReason) throw new Error('End the primary Baseball game before finalizing. Suspended games must resume first.')

  // Readiness never compares the stored fingerprint with this freshly loaded stream.
  await confirmEventPrimaryCheckpoint(
    BASEBALL_FINALIZATION_RPCS,
    gameId,
    recorder.recorderId,
    projection.state,
    projection.eventStream
  )
  assertCurrent()
  readiness = await loadBaseballFinalizationReadiness(gameId)
  assertCurrent()
  if (
    !readiness.canFinalize ||
    readiness.primaryRecorderId !== recorder.recorderId ||
    !readiness.primaryEnded ||
    !readiness.primaryCheckpointCurrent ||
    readiness.primaryConflictCount > 0
  ) {
    throw new Error('Primary recorder readiness changed. Review finalization again.')
  }

  let personalLinkReview: BaseballPersonalLinkReview | undefined
  if (options.reviewPersonalLinks && baseballState.setup.sourceTeamId === null) {
    if (!userId || recorder.recorderId !== userId) throw Error('Review personal links as the game creator and primary recorder.')
    const { createBaseballPersonalIdentityClient } = await import('./personalIdentity')
    assertCurrent()
    personalLinkReview = await createBaseballPersonalIdentityClient(userId).review(gameId, baseballState.setup.participants.map(player => player.id))
    assertCurrent()
  }
  return {
    gameId,
    readiness,
    recorder,
    projection,
    snapshot: createBaseballCanonicalSnapshot(gameId, recorder.recorderId, projection.state),
    score: baseballPublishedScore(baseballState.projection),
    endReason,
    endReasonLabel: BASEBALL_GAME_END_LABELS[endReason],
    pitcherDecisionsMissing: baseballDecisionsView(baseballState, projection.inspection.activeEvents).current === null,
    ...(personalLinkReview ? { personalLinkReview } : {}),
  }
}

export async function finalizeBaseballGame(preview: BaseballFinalizationPreview, userId?: string | null, options: { assertCurrent?: () => void; reviewPersonalLinks?: boolean } = {}): Promise<BaseballFinalizationResult> {
  const assertCurrent = () => { options.assertCurrent?.(); if (userId !== undefined) assertBaseballCloudAccount(userId) }
  assertCurrent()
  if (!preview.snapshot || !preview.score || !preview.endReason || !preview.projection.inspection.complete) {
    throw new Error('Baseball finalization preview is not publishable.')
  }
  const snapshot = createBaseballCanonicalSnapshot(preview.gameId, preview.recorder.recorderId, preview.projection.state)
  const personal = preview.projection.state.sportGameState?.sportId === 'baseball' && preview.projection.state.sportGameState.setup.sourceTeamId === null
  if (options.reviewPersonalLinks && personal && !preview.personalLinkReview) throw Error('Review the personal player links before finalizing.')
  let published: { publicationId: string; publicationNumber: number; primaryRecorderId: string; finalizedAt: string }
  if (preview.personalLinkReview) {
    if (!personal || !userId) throw Error('Reviewed player links require the personal game creator.')
    const { createBaseballPersonalIdentityClient } = await import('./personalIdentity')
    assertCurrent()
    published = await createBaseballPersonalIdentityClient(userId).finalizeReviewed({ state: preview.projection.state, review: preview.personalLinkReview, assertReviewCurrent: assertCurrent })
  } else published = await finalizeEventGame(BASEBALL_FINALIZATION_RPCS, {
    gameId: preview.gameId,
    recorderId: preview.recorder.recorderId,
    state: preview.projection.state,
    snapshot,
  })
  assertCurrent()
  const serverScore = await loadPublishedScore(preview.gameId)
  assertCurrent()
  return {
    ...published,
    score: serverScore ?? { ...preview.score },
    serverScoreConfirmed: serverScore !== null,
    previewScore: { ...preview.score },
    endReason: preview.endReason,
  }
}

export async function reopenBaseballCloudGame(gameId: string, reason: string, userId?: string | null): Promise<BaseballReopenResult> {
  if (userId !== undefined) assertBaseballCloudAccount(userId)
  const result = await reopenEventGame(BASEBALL_FINALIZATION_RPCS, gameId, reason)
  if (userId !== undefined) assertBaseballCloudAccount(userId)
  return result
}

export function createBaseballCanonicalSnapshot(
  gameId: string,
  recorderId: string,
  state: GameState
): BaseballCanonicalSnapshot {
  if (!gameId.trim() || !recorderId.trim()) throw new Error('Baseball canonical identity is invalid.')
  if (state.gameDataAuthority !== 'sport_events' || !state.eventStream || state.sportGameState?.sportId !== 'baseball') {
    throw new Error('Baseball canonical source is unavailable.')
  }
  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  if (!inspection.complete) {
    throw new Error(inspection.diagnostics[0]?.message ?? 'Baseball canonical event stream is invalid.')
  }
  assertRecorderOwnership([...inspection.activeEvents, ...inspection.deletedEvents], recorderId)
  const rebuilt = rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors)
  if (!rebuilt.inspection.complete || rebuilt.state.sportGameState?.sportId !== 'baseball') {
    throw new Error(
      rebuilt.inspection.diagnostics[0]?.message ?? 'Baseball canonical event stream does not project completely.'
    )
  }
  return {
    version: CANONICAL_ENVELOPE_VERSION,
    canonicalSchemaVersion: BASEBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION,
    sportId: 'baseball',
    gameId,
    primaryRecorderId: recorderId,
    eventStream: structuredClone(state.eventStream),
    sportGameState: {
      sportId: 'baseball',
      version: BASEBALL_GAME_STATE_VERSION,
      setup: structuredClone(state.sportGameState.setup),
    },
  }
}

export function parseBaseballCanonicalSnapshot(value: unknown): BaseballCanonicalSnapshot {
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
    value.canonicalSchemaVersion !== BASEBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION ||
    value.sportId !== 'baseball' ||
    !isNonEmptyString(value.gameId) ||
    !isNonEmptyString(value.primaryRecorderId) ||
    !isPlainObject(value.eventStream) ||
    !hasOnlyKeys(value.eventStream, ['version', 'events']) ||
    !isPlainObject(value.sportGameState) ||
    !hasOnlyKeys(value.sportGameState, ['sportId', 'version', 'setup']) ||
    value.sportGameState.sportId !== 'baseball' ||
    value.sportGameState.version !== BASEBALL_GAME_STATE_VERSION ||
    !isPlainObject(value.sportGameState.setup)
  ) {
    throw new Error('Baseball canonical snapshot is invalid.')
  }
  const eventStream = normalizeGameEventStream(value.eventStream)
  const sportState = normalizeBaseballSportGameState({
    sportId: 'baseball',
    version: value.sportGameState.version,
    setup: value.sportGameState.setup,
  })
  if (!eventStream || !sportState) throw new Error('Baseball canonical snapshot is invalid.')
  const inspection = inspectGameEventStream(eventStream, gameEventRegistry)
  if (!inspection.complete) throw new Error('Baseball canonical snapshot contains invalid events.')
  assertRecorderOwnership([...inspection.activeEvents, ...inspection.deletedEvents], value.primaryRecorderId)
  return {
    version: CANONICAL_ENVELOPE_VERSION,
    canonicalSchemaVersion: BASEBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION,
    sportId: 'baseball',
    gameId: value.gameId,
    primaryRecorderId: value.primaryRecorderId,
    eventStream: structuredClone(eventStream),
    sportGameState: { sportId: 'baseball', version: BASEBALL_GAME_STATE_VERSION, setup: structuredClone(sportState.setup) },
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
  if (events.some(event => event.sportId !== 'baseball' || event.recorderUserId !== recorderId)) {
    throw new Error('Baseball canonical events do not belong to the primary recorder.')
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every(key => allowedKeys.has(key))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
