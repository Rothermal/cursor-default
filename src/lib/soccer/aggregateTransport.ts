import { isPlainObject } from '../gameEvents/envelope'
import { supabase } from '../supabase'
import {
  aggregateSoccerMatches,
  projectSoccerCanonicalAggregateSource,
  type SoccerAggregateExclusion,
  type SoccerAggregateMatch,
  type SoccerAggregateResult,
  type SoccerAggregateRosterPlayer,
  type SoccerAggregateScope,
  type SoccerCanonicalAggregateSource,
} from './aggregateProjection'
import type { SoccerCanonicalSnapshot } from './finalization'

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50
const DEFAULT_PROJECTION_BATCH_SIZE = 5

export type SoccerCanonicalAggregateLoadScope =
  | { type: 'team' | 'season' | 'tournament'; id: string }
  | {
      type: 'player' | 'career'
      playerId: string
      teamId?: string | null
      seasonId?: string | null
    }

export type SoccerAggregateTransportErrorCode =
  | 'aborted'
  | 'access_denied'
  | 'backend_update_required'
  | 'invalid_payload'
  | 'not_configured'
  | 'transport'

export class SoccerAggregateTransportError extends Error {
  readonly code: SoccerAggregateTransportErrorCode
  readonly causeDetail: unknown

  constructor(
    code: SoccerAggregateTransportErrorCode,
    message: string,
    causeDetail?: unknown
  ) {
    super(message)
    this.name = 'SoccerAggregateTransportError'
    this.code = code
    this.causeDetail = causeDetail
  }
}

export interface SoccerAggregateLoadProgress {
  stage: 'loading' | 'projecting' | 'complete'
  pageCount: number
  publicationCount: number
  projectedCount: number
  projectionTotal: number
}

export interface SoccerAggregateTransportMetrics {
  pageCount: number
  publicationCount: number
  /** Server-reported events across every fetched publication, including excluded sources. */
  eventCount: number
  payloadBytes: number
  networkTimeMs: number
  projectionTimeMs: number
  totalTimeMs: number
  maxProjectionBatchMs: number
  unresolvedParticipantCount: number
  excludedContributionCount: number
  malformedPublicationCount: number
}

export interface SoccerAggregateLoadResult {
  aggregate: SoccerAggregateResult
  metrics: SoccerAggregateTransportMetrics
}

interface RpcError {
  code?: string
  message: string
  details?: string
  hint?: string
}

interface RpcResponse {
  data: unknown
  error: RpcError | null
}

export interface SoccerAggregateRpcRequest extends PromiseLike<RpcResponse> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResponse>
}

export interface SoccerAggregateRpcClient {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>
  ) => SoccerAggregateRpcRequest
}

export interface SoccerAggregateLoadOptions {
  signal?: AbortSignal
  onProgress?: (progress: SoccerAggregateLoadProgress) => void
  activeRoster?: SoccerAggregateRosterPlayer[]
  pageSize?: number
  client?: SoccerAggregateRpcClient
  projectionBatchSize?: number
  yieldControl?: () => Promise<void>
  now?: () => number
}

interface AggregateCursor {
  finalizedAt: string
  publicationId: string
}

interface TransportSource extends SoccerCanonicalAggregateSource {
  transportEventCount: number
  transportPayloadBytes: number
}

interface AggregatePage {
  records: TransportRecord[]
  nextCursor: AggregateCursor | null
}

interface TransportRecord {
  dedupeKey: string
  source: TransportSource | null
  exclusion: SoccerAggregateExclusion | null
  transportEventCount: number
  transportPayloadBytes: number
}

interface SharedLoad {
  controller: AbortController
  promise: Promise<SoccerAggregateLoadResult>
  listeners: Set<(progress: SoccerAggregateLoadProgress) => void>
  latestProgress: SoccerAggregateLoadProgress | null
  consumerCount: number
}

const inFlightByClient = new WeakMap<object, Map<string, SharedLoad>>()

export function loadSoccerCanonicalAggregates(
  scope: SoccerCanonicalAggregateLoadScope,
  options: SoccerAggregateLoadOptions = {}
): Promise<SoccerAggregateLoadResult> {
  const client = options.client ??
    (supabase as unknown as SoccerAggregateRpcClient | null)
  if (!client) {
    return Promise.reject(new SoccerAggregateTransportError(
      'not_configured',
      'Supabase is not configured.'
    ))
  }

  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const projectionBatchSize =
    options.projectionBatchSize ?? DEFAULT_PROJECTION_BATCH_SIZE
  try {
    validateLoadInput(scope, pageSize, projectionBatchSize)
  } catch (error) {
    return Promise.reject(error)
  }
  if (options.signal?.aborted) return Promise.reject(abortedError())

  const clientKey = client as object
  let clientLoads = inFlightByClient.get(clientKey)
  if (!clientLoads) {
    clientLoads = new Map()
    inFlightByClient.set(clientKey, clientLoads)
  }
  const key = JSON.stringify({
    scope: normalizedScope(scope),
    pageSize,
    projectionBatchSize,
    activeRoster: normalizedRoster(options.activeRoster ?? []),
  })
  let shared = clientLoads.get(key)
  if (shared?.controller.signal.aborted) {
    clientLoads.delete(key)
    shared = undefined
  }
  if (!shared) {
    const controller = new AbortController()
    const activeRoster = normalizedRoster(options.activeRoster ?? [])
    shared = {
      controller,
      promise: Promise.resolve(null as never),
      listeners: new Set(),
      latestProgress: null,
      consumerCount: 0,
    }
    const current = shared
    current.promise = executeAggregateLoad(scope, {
      signal: controller.signal,
      activeRoster,
      pageSize,
      projectionBatchSize,
      yieldControl: options.yieldControl ?? yieldToBrowser,
      now: options.now ?? monotonicNow,
      client,
      onProgress: progress => {
        current.latestProgress = progress
        for (const listener of current.listeners) {
          try {
            listener(progress)
          } catch (error) {
            console.error('[StatKeeper] Soccer aggregate progress listener failed', error)
          }
        }
      },
    }).finally(() => {
      if (clientLoads!.get(key) === current) clientLoads!.delete(key)
      if (clientLoads!.size === 0) inFlightByClient.delete(clientKey)
    })
    clientLoads.set(key, current)
    shared = current
  }

  return consumeSharedLoad(shared, options.signal, options.onProgress)
}

interface ExecuteOptions {
  signal: AbortSignal
  activeRoster: SoccerAggregateRosterPlayer[]
  pageSize: number
  projectionBatchSize: number
  yieldControl: () => Promise<void>
  now: () => number
  client: SoccerAggregateRpcClient
  onProgress: (progress: SoccerAggregateLoadProgress) => void
}

async function executeAggregateLoad(
  scope: SoccerCanonicalAggregateLoadScope,
  options: ExecuteOptions
): Promise<SoccerAggregateLoadResult> {
  const startedAt = options.now()
  const sources: TransportSource[] = []
  const transportExclusions: SoccerAggregateExclusion[] = []
  const transportRecords: TransportRecord[] = []
  const seenPublicationIds = new Set<string>()
  const seenCursors = new Set<string>()
  let cursor: AggregateCursor | null = null
  let pageCount = 0
  let networkTimeMs = 0

  do {
    throwIfAborted(options.signal)
    const cursorKey = cursor
      ? `${cursor.finalizedAt}:${cursor.publicationId}`
      : 'first'
    if (seenCursors.has(cursorKey)) {
      throw invalidPayload('Aggregate pagination returned a repeated cursor.')
    }
    seenCursors.add(cursorKey)

    const networkStartedAt = options.now()
    const response = await requestPage(
      options.client,
      scope,
      cursor,
      options.pageSize,
      options.signal
    )
    networkTimeMs += options.now() - networkStartedAt
    const page = parseAggregatePage(response, pageCount + 1)
    pageCount += 1
    for (const record of page.records) {
      if (seenPublicationIds.has(record.dedupeKey)) continue
      seenPublicationIds.add(record.dedupeKey)
      transportRecords.push(record)
      if (record.source) sources.push(record.source)
      if (record.exclusion) transportExclusions.push(record.exclusion)
    }
    cursor = page.nextCursor
    options.onProgress({
      stage: 'loading',
      pageCount,
      publicationCount: transportRecords.length,
      projectedCount: 0,
      projectionTotal: 0,
    })
  } while (cursor)

  const matches: SoccerAggregateMatch[] = []
  const exclusions: SoccerAggregateExclusion[] = [...transportExclusions]
  const projectionStartedAt = options.now()
  let maxProjectionBatchMs = 0

  for (let offset = 0; offset < sources.length; offset += options.projectionBatchSize) {
    throwIfAborted(options.signal)
    const batchStartedAt = options.now()
    const batch = sources.slice(offset, offset + options.projectionBatchSize)
    for (const source of batch) {
      const projected = projectSoccerCanonicalAggregateSource(source)
      if (projected.ok) matches.push(projected.match)
      else exclusions.push(projected.exclusion)
    }
    const batchMs = options.now() - batchStartedAt
    maxProjectionBatchMs = Math.max(maxProjectionBatchMs, batchMs)
    const projectedCount = Math.min(offset + batch.length, sources.length)
    options.onProgress({
      stage: 'projecting',
      pageCount,
      publicationCount: transportRecords.length,
      projectedCount,
      projectionTotal: sources.length,
    })
    if (projectedCount < sources.length) {
      await options.yieldControl()
    }
  }

  throwIfAborted(options.signal)
  const aggregate = aggregateSoccerMatches(
    aggregateScope(scope),
    matches,
    exclusions,
    options.activeRoster,
    transportRecords.length
  )
  const projectionTimeMs = options.now() - projectionStartedAt
  const metrics: SoccerAggregateTransportMetrics = {
    pageCount,
    publicationCount: transportRecords.length,
    eventCount: transportRecords.reduce(
      (total, record) => total + record.transportEventCount,
      0
    ),
    payloadBytes: transportRecords.reduce(
      (total, record) => total + record.transportPayloadBytes,
      0
    ),
    networkTimeMs,
    projectionTimeMs,
    totalTimeMs: options.now() - startedAt,
    maxProjectionBatchMs,
    unresolvedParticipantCount: aggregate.metrics.unresolvedParticipantCount,
    excludedContributionCount: aggregate.metrics.excludedContributionCount,
    malformedPublicationCount: aggregate.metrics.malformedPublicationCount,
  }

  options.onProgress({
    stage: 'complete',
    pageCount,
    publicationCount: transportRecords.length,
    projectedCount: sources.length,
    projectionTotal: sources.length,
  })
  if (import.meta.env.DEV) {
    console.info('[StatKeeper] Soccer aggregate load', {
      scope: normalizedScope(scope),
      ...metrics,
    })
  }
  return { aggregate, metrics }
}

async function requestPage(
  client: SoccerAggregateRpcClient,
  scope: SoccerCanonicalAggregateLoadScope,
  cursor: AggregateCursor | null,
  pageSize: number,
  signal: AbortSignal
): Promise<unknown> {
  const playerScope = isPlayerAggregateScope(scope)
  const functionName = playerScope
    ? 'get_soccer_player_aggregate_publications'
    : 'get_soccer_scope_aggregate_publications'
  const parameters: Record<string, unknown> = playerScope
    ? {
        p_player_id: scope.playerId,
        p_team_id: scope.teamId ?? null,
        p_season_id: scope.seasonId ?? null,
        p_before_finalized_at: cursor?.finalizedAt ?? null,
        p_before_publication_id: cursor?.publicationId ?? null,
        p_limit: pageSize,
      }
    : {
        p_scope_type: scope.type,
        p_scope_id: scope.id,
        p_before_finalized_at: cursor?.finalizedAt ?? null,
        p_before_publication_id: cursor?.publicationId ?? null,
        p_limit: pageSize,
      }

  try {
    const request = client.rpc(functionName, parameters)
    const response = request.abortSignal
      ? await request.abortSignal(signal)
      : await request
    throwIfAborted(signal)
    if (response.error) throw rpcError(response.error)
    return response.data
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw abortedError()
    if (error instanceof SoccerAggregateTransportError) throw error
    throw new SoccerAggregateTransportError(
      'transport',
      'Soccer aggregate publications could not load.',
      error
    )
  }
}

function parseAggregatePage(value: unknown, pageNumber: number): AggregatePage {
  if (!isPlainObject(value) || !Array.isArray(value.items)) {
    throw invalidPayload('Aggregate publication page is invalid.')
  }
  const nextCursor = value.nextCursor === null
    ? null
    : parseCursor(value.nextCursor)
  return {
    records: value.items.map((item, index) =>
      parseTransportRecord(item, pageNumber, index)
    ),
    nextCursor,
  }
}

function parseTransportRecord(
  value: unknown,
  pageNumber: number,
  itemIndex: number
): TransportRecord {
  try {
    const source = parseTransportSource(value)
    return {
      dedupeKey: source.publicationId,
      source,
      exclusion: null,
      transportEventCount: source.transportEventCount,
      transportPayloadBytes: source.transportPayloadBytes,
    }
  } catch (error) {
    const row = isPlainObject(value) ? value : null
    const game = row && isPlainObject(row.game) ? row.game : null
    const publicationId = optionalString(row?.publicationId) ??
      `malformed-page-${pageNumber}-item-${itemIndex + 1}`
    return {
      dedupeKey: publicationId,
      source: null,
      exclusion: {
        kind: 'malformed_publication',
        publicationId,
        gameId: optionalString(game?.id) ?? 'unknown',
        gameDate: optionalString(game?.date) ?? '',
        message: error instanceof Error
          ? error.message
          : 'Aggregate publication item is invalid.',
        canManage: row?.canManage === true,
      },
      transportEventCount: optionalNonNegativeInteger(row?.eventCount),
      transportPayloadBytes: optionalNonNegativeInteger(row?.payloadBytes),
    }
  }
}

function parseCursor(value: unknown): AggregateCursor {
  if (!isPlainObject(value)) {
    throw invalidPayload('Aggregate continuation cursor is invalid.')
  }
  return {
    finalizedAt: requiredString(value.finalizedAt, 'cursor finalized time'),
    publicationId: requiredString(value.publicationId, 'cursor publication id'),
  }
}

function parseTransportSource(value: unknown): TransportSource {
  if (!isPlainObject(value) || !isPlainObject(value.game)) {
    throw invalidPayload('Aggregate publication item is invalid.')
  }
  if (!isPlainObject(value.canonicalSnapshot)) {
    throw invalidPayload('Aggregate canonical snapshot payload is invalid.')
  }
  if (!isPlainObject(value.participantSourceMap)) {
    throw invalidPayload('Aggregate participant source map is invalid.')
  }
  const participantSourceMap: Record<string, string> = {}
  for (const [key, sourcePlayerId] of Object.entries(value.participantSourceMap)) {
    participantSourceMap[key] = requiredString(
      sourcePlayerId,
      `participant source mapping ${key}`
    )
  }
  if (value.canManage !== true && value.canManage !== false) {
    throw invalidPayload('Aggregate publication management authority is invalid.')
  }
  const game = value.game
  if (game.cloudScope !== 'team') {
    throw invalidPayload('Aggregate publication game scope is invalid.')
  }
  return {
    publicationId: requiredString(value.publicationId, 'publication id'),
    publicationNumber: requiredNonNegativeInteger(
      value.publicationNumber,
      'publication number',
      1
    ),
    snapshotFingerprint: requiredString(
      value.snapshotFingerprint,
      'snapshot fingerprint'
    ),
    finalizedAt: requiredString(value.finalizedAt, 'finalized time'),
    transportEventCount: requiredNonNegativeInteger(
      value.eventCount,
      'event count'
    ),
    transportPayloadBytes: requiredNonNegativeInteger(
      value.payloadBytes,
      'payload bytes'
    ),
    game: {
      id: requiredString(game.id, 'game id'),
      date: requiredString(game.date, 'game date'),
      status: requiredString(game.status, 'game status'),
      cloudScope: 'team',
      teamId: nullableString(game.teamId, 'team id'),
      seasonId: nullableString(game.seasonId, 'season id'),
      tournamentId: nullableString(game.tournamentId, 'tournament id'),
      trackedTeamName: displayString(game.trackedTeamName, 'Tracked team'),
      opponentName: displayString(game.opponentName, 'Opponent'),
    },
    // C1 deliberately owns semantic snapshot validation and catches rebuild failures.
    canonicalSnapshot:
      value.canonicalSnapshot as unknown as SoccerCanonicalSnapshot,
    participantSourceMap,
    canManage: value.canManage,
  }
}

function consumeSharedLoad(
  shared: SharedLoad,
  signal?: AbortSignal,
  onProgress?: (progress: SoccerAggregateLoadProgress) => void
): Promise<SoccerAggregateLoadResult> {
  if (signal?.aborted) return Promise.reject(abortedError())
  shared.consumerCount += 1
  if (onProgress) {
    shared.listeners.add(onProgress)
    if (shared.latestProgress) {
      try {
        onProgress(shared.latestProgress)
      } catch (error) {
        console.error('[StatKeeper] Soccer aggregate progress listener failed', error)
      }
    }
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = () => {
      if (settled) return false
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (onProgress) shared.listeners.delete(onProgress)
      shared.consumerCount -= 1
      if (shared.consumerCount === 0 && !shared.controller.signal.aborted) {
        shared.controller.abort()
      }
      return true
    }
    const onAbort = () => {
      if (!finish()) return
      reject(abortedError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    shared.promise.then(
      result => {
        if (!finish()) return
        resolve(result)
      },
      error => {
        if (!finish()) return
        reject(error)
      }
    )
  })
}

function normalizedScope(
  scope: SoccerCanonicalAggregateLoadScope
): Record<string, string | null> {
  if (isPlayerAggregateScope(scope)) {
    return {
      type: scope.type,
      playerId: scope.playerId,
      teamId: scope.teamId ?? null,
      seasonId: scope.seasonId ?? null,
    }
  }
  return { type: scope.type, id: scope.id }
}

function aggregateScope(
  scope: SoccerCanonicalAggregateLoadScope
): SoccerAggregateScope {
  return isPlayerAggregateScope(scope)
    ? { type: scope.type, id: scope.playerId }
    : { type: scope.type, id: scope.id }
}

function normalizedRoster(
  roster: SoccerAggregateRosterPlayer[]
): SoccerAggregateRosterPlayer[] {
  return [...roster].sort((left, right) =>
    left.playerId.localeCompare(right.playerId) ||
    left.teamId.localeCompare(right.teamId) ||
    left.displayName.localeCompare(right.displayName) ||
    (left.number ?? '').localeCompare(right.number ?? '')
  )
}

function validateLoadInput(
  scope: SoccerCanonicalAggregateLoadScope,
  pageSize: number,
  projectionBatchSize: number
): void {
  const identity = isPlayerAggregateScope(scope)
    ? scope.playerId
    : scope.id
  if (!identity.trim()) {
    throw new SoccerAggregateTransportError(
      'invalid_payload',
      'Soccer aggregate scope identity is required.'
    )
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new SoccerAggregateTransportError(
      'invalid_payload',
      `Soccer aggregate page size must be between 1 and ${MAX_PAGE_SIZE}.`
    )
  }
  if (!Number.isInteger(projectionBatchSize) || projectionBatchSize < 1) {
    throw new SoccerAggregateTransportError(
      'invalid_payload',
      'Soccer aggregate projection batch size must be positive.'
    )
  }
}

function isPlayerAggregateScope(
  scope: SoccerCanonicalAggregateLoadScope
): scope is Extract<
  SoccerCanonicalAggregateLoadScope,
  { type: 'player' | 'career' }
> {
  return scope.type === 'player' || scope.type === 'career'
}

function rpcError(error: RpcError): SoccerAggregateTransportError {
  const combined = `${error.message} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
  if (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    combined.includes('schema cache') ||
    combined.includes('could not find the function')
  ) {
    return new SoccerAggregateTransportError(
      'backend_update_required',
      'Soccer aggregate data requires the latest backend update.',
      error
    )
  }
  if (
    error.code === '42501' ||
    combined.includes('permission denied') ||
    combined.includes('not authorized') ||
    combined.includes('authentication required')
  ) {
    return new SoccerAggregateTransportError(
      'access_denied',
      'You do not have access to these soccer aggregates.',
      error
    )
  }
  return new SoccerAggregateTransportError(
    'transport',
    'Soccer aggregate publications could not load.',
    error
  )
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidPayload(`Aggregate ${label} is invalid.`)
  }
  return value
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  return requiredString(value, label)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function displayString(value: unknown, fallback: string): string {
  return optionalString(value) ?? fallback
}

function optionalNonNegativeInteger(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 0
    ? value as number
    : 0
}

function requiredNonNegativeInteger(
  value: unknown,
  label: string,
  minimum = 0
): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw invalidPayload(`Aggregate ${label} is invalid.`)
  }
  return value as number
}

function invalidPayload(message: string): SoccerAggregateTransportError {
  return new SoccerAggregateTransportError('invalid_payload', message)
}

function abortedError(): SoccerAggregateTransportError {
  return new SoccerAggregateTransportError('aborted', 'Soccer aggregate load was cancelled.')
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortedError()
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function monotonicNow(): number {
  return performance.now()
}

function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}
