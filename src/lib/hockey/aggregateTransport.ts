import { createReleaseCapabilityChecker, type ReleaseCapabilityClient } from '../eventReleaseCapabilities'
import { isPlainObject } from '../gameEvents/envelope'
import { supabase } from '../supabase'
import {
  aggregateHockeyMatches,
  projectHockeyCanonicalAggregateSource,
  type HockeyAggregateExclusion,
  type HockeyAggregateMatch,
  type HockeyAggregateResult,
  type HockeyAggregateRosterPlayer,
  type HockeyAggregateScope,
  type HockeyCanonicalAggregateSource,
} from './aggregateProjection'

/**
 * Loads Hockey season totals (HKY-6B2) from the 075 pages: the aggregate handshake first,
 * then every page by keyset, then a cooperative projection. Loads with the same scope share
 * one request; each caller can cancel without stopping the others. Hockey has no legacy page.
 */

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50
const DEFAULT_PROJECTION_BATCH_SIZE = 5

export type HockeyAggregateLoadScope =
  | { type: 'team' | 'season' | 'tournament'; id: string }
  | { type: 'player' | 'career'; playerId: string; teamId?: string | null; seasonId?: string | null }

export type HockeyAggregateTransportErrorCode =
  | 'aborted'
  | 'access_denied'
  | 'backend_update_required'
  | 'client_update_required'
  | 'invalid_payload'
  | 'not_configured'
  | 'transport'

export class HockeyAggregateTransportError extends Error {
  constructor(readonly code: HockeyAggregateTransportErrorCode, message: string, readonly causeDetail?: unknown) {
    super(message)
    this.name = 'HockeyAggregateTransportError'
  }
}

export interface HockeyAggregateLoadProgress {
  stage: 'checking' | 'loading' | 'projecting' | 'complete'
  pageCount: number
  sourceCount: number
  projectedCount: number
}

export interface HockeyAggregateLoadResult {
  aggregate: HockeyAggregateResult
  pageCount: number
}

interface RpcResponse {
  data: unknown
  error: { code?: string; message: string; details?: string; hint?: string } | null
}

export interface HockeyAggregateRpcRequest extends PromiseLike<RpcResponse> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResponse>
}

export interface HockeyAggregateRpcClient {
  rpc: (functionName: string, parameters?: Record<string, unknown>) => HockeyAggregateRpcRequest
}

export interface HockeyAggregateLoadOptions {
  signal?: AbortSignal
  onProgress?: (progress: HockeyAggregateLoadProgress) => void
  activeRoster?: HockeyAggregateRosterPlayer[]
  pageSize?: number
  projectionBatchSize?: number
  client?: HockeyAggregateRpcClient
  yieldControl?: () => Promise<void>
}

/** `get_hockey_aggregate_capabilities` (075), separate from the release contract. */
export const hockeyAggregateCapabilityChecker = createReleaseCapabilityChecker({
  rpcName: 'get_hockey_aggregate_capabilities',
  subject: 'Hockey season stats',
  expected: { contractVersion: 1, sportId: 'hockey', aggregateContractVersion: 1, migration: 75 },
})

interface Cursor {
  finalizedAt: string
  publicationId: string
}

interface SharedLoad {
  controller: AbortController
  promise: Promise<HockeyAggregateLoadResult>
  listeners: Set<(progress: HockeyAggregateLoadProgress) => void>
  latest: HockeyAggregateLoadProgress | null
  consumers: number
}

const inFlightByClient = new WeakMap<object, Map<string, SharedLoad>>()

export function loadHockeyAggregates(
  scope: HockeyAggregateLoadScope,
  options: HockeyAggregateLoadOptions = {}
): Promise<HockeyAggregateLoadResult> {
  const client = options.client ?? (supabase as unknown as HockeyAggregateRpcClient | null)
  if (!client) return Promise.reject(new HockeyAggregateTransportError('not_configured', 'Supabase is not configured.'))
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const batchSize = options.projectionBatchSize ?? DEFAULT_PROJECTION_BATCH_SIZE
  const identity = isPlayerScope(scope) ? scope.playerId : scope.id
  if (!identity.trim()) return Promise.reject(invalid('A Hockey season-stat scope needs an id.'))
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    return Promise.reject(invalid(`Hockey season-stat pages hold 1 to ${MAX_PAGE_SIZE} games.`))
  }
  if (!Number.isInteger(batchSize) || batchSize < 1) return Promise.reject(invalid('The projection batch size must be positive.'))
  if (options.signal?.aborted) return Promise.reject(aborted())

  const roster = [...(options.activeRoster ?? [])].sort((a, b) =>
    a.playerId.localeCompare(b.playerId) || a.teamId.localeCompare(b.teamId)
  )
  let loads = inFlightByClient.get(client)
  if (!loads) {
    loads = new Map()
    inFlightByClient.set(client, loads)
  }
  const key = JSON.stringify({ scope: normalizedScope(scope), pageSize, batchSize, roster })
  let shared = loads.get(key)
  if (shared?.controller.signal.aborted) {
    loads.delete(key)
    shared = undefined
  }
  if (!shared) {
    const controller = new AbortController()
    const current: SharedLoad = { controller, promise: Promise.resolve(null as never), listeners: new Set(), latest: null, consumers: 0 }
    const clientLoads = loads
    current.promise = execute(scope, client, {
      signal: controller.signal,
      roster,
      pageSize,
      batchSize,
      yieldControl: options.yieldControl ?? (() => new Promise(resolve => setTimeout(resolve, 0))),
      onProgress: progress => {
        current.latest = progress
        for (const listener of current.listeners) listener(progress)
      },
    }).finally(() => {
      if (clientLoads.get(key) === current) clientLoads.delete(key)
    })
    loads.set(key, current)
    shared = current
  }
  return consume(shared, options.signal, options.onProgress)
}

interface ExecuteOptions {
  signal: AbortSignal
  roster: HockeyAggregateRosterPlayer[]
  pageSize: number
  batchSize: number
  yieldControl: () => Promise<void>
  onProgress: (progress: HockeyAggregateLoadProgress) => void
}

async function execute(
  scope: HockeyAggregateLoadScope,
  client: HockeyAggregateRpcClient,
  options: ExecuteOptions
): Promise<HockeyAggregateLoadResult> {
  options.onProgress({ stage: 'checking', pageCount: 0, sourceCount: 0, projectedCount: 0 })
  const capabilities = await hockeyAggregateCapabilityChecker.load(client as unknown as ReleaseCapabilityClient)
  throwIfAborted(options.signal)
  if (capabilities.status !== 'ready') {
    const code: HockeyAggregateTransportErrorCode =
      capabilities.status === 'backend_update_required' || capabilities.status === 'client_update_required'
        ? capabilities.status
        : capabilities.status === 'access_denied' || capabilities.status === 'authentication_required'
          ? 'access_denied'
          : capabilities.status === 'invalid_response'
            ? 'invalid_payload'
            : capabilities.status === 'not_configured'
              ? 'not_configured'
              : 'transport'
    throw new HockeyAggregateTransportError(code, capabilities.error)
  }

  const sources: HockeyCanonicalAggregateSource[] = []
  const exclusions: HockeyAggregateExclusion[] = []
  const seenIds = new Set<string>()
  const seenCursors = new Set<string>()
  let cursor: Cursor | null = null
  let pageCount = 0
  do {
    throwIfAborted(options.signal)
    const cursorKey = cursor ? JSON.stringify(cursor) : 'first'
    if (seenCursors.has(cursorKey)) throw invalid('Hockey season-stat paging returned a repeated cursor.')
    seenCursors.add(cursorKey)
    const page = parsePage(await requestPage(client, scope, cursor, options.pageSize, options.signal), pageCount + 1)
    pageCount += 1
    for (const item of page.items) {
      const id = 'source' in item ? item.source.publicationId : item.exclusion.sourceId
      if (seenIds.has(id)) continue
      seenIds.add(id)
      if ('source' in item) sources.push(item.source)
      else exclusions.push(item.exclusion)
    }
    cursor = page.nextCursor
    options.onProgress({ stage: 'loading', pageCount, sourceCount: seenIds.size, projectedCount: 0 })
  } while (cursor)

  const matches: HockeyAggregateMatch[] = []
  for (let offset = 0; offset < sources.length; offset += options.batchSize) {
    throwIfAborted(options.signal)
    for (const source of sources.slice(offset, offset + options.batchSize)) {
      const projected = projectHockeyCanonicalAggregateSource(source)
      if (projected.ok) matches.push(projected.match)
      else exclusions.push(projected.exclusion)
    }
    const projectedCount = Math.min(offset + options.batchSize, sources.length)
    options.onProgress({ stage: 'projecting', pageCount, sourceCount: seenIds.size, projectedCount })
    if (projectedCount < sources.length) await options.yieldControl()
  }
  throwIfAborted(options.signal)
  const aggregate = aggregateHockeyMatches(aggregateScope(scope), matches, exclusions, options.roster, seenIds.size)
  options.onProgress({ stage: 'complete', pageCount, sourceCount: seenIds.size, projectedCount: sources.length })
  return { aggregate, pageCount }
}

async function requestPage(
  client: HockeyAggregateRpcClient,
  scope: HockeyAggregateLoadScope,
  cursor: Cursor | null,
  pageSize: number,
  signal: AbortSignal
): Promise<unknown> {
  const player = isPlayerScope(scope)
  const parameters = {
    ...(player
      ? { p_player_id: scope.playerId, p_team_id: scope.teamId ?? null, p_season_id: scope.seasonId ?? null }
      : { p_scope_type: scope.type, p_scope_id: scope.id }),
    p_before_finalized_at: cursor?.finalizedAt ?? null,
    p_before_publication_id: cursor?.publicationId ?? null,
    p_limit: pageSize,
  }
  try {
    const request = client.rpc(player ? 'get_hockey_player_aggregate_publications' : 'get_hockey_scope_aggregate_publications', parameters)
    const response = request.abortSignal ? await request.abortSignal(signal) : await request
    throwIfAborted(signal)
    if (response.error) throw rpcError(response.error)
    return response.data
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw aborted()
    if (error instanceof HockeyAggregateTransportError) throw error
    throw new HockeyAggregateTransportError('transport', 'Hockey season stats could not load.', error)
  }
}

type PageItem = { source: HockeyCanonicalAggregateSource } | { exclusion: HockeyAggregateExclusion }

function parsePage(value: unknown, pageNumber: number): { items: PageItem[]; nextCursor: Cursor | null } {
  if (!isPlainObject(value) || !Array.isArray(value.items)) throw invalid('A Hockey season-stat page is invalid.')
  let nextCursor: Cursor | null = null
  if (value.nextCursor !== null) {
    if (!isPlainObject(value.nextCursor)) throw invalid('The Hockey season-stat cursor is invalid.')
    nextCursor = {
      finalizedAt: requiredString(value.nextCursor.finalizedAt, 'cursor time'),
      publicationId: requiredString(value.nextCursor.publicationId, 'cursor publication'),
    }
  }
  return {
    items: value.items.map((item, index): PageItem => {
      try {
        return { source: parseSource(item) }
      } catch (error) {
        const row = isPlainObject(item) ? item : null
        const game = row && isPlainObject(row.game) ? row.game : null
        return {
          exclusion: {
            kind: 'malformed_source',
            sourceId: optionalString(row?.publicationId) ?? `malformed-page-${pageNumber}-item-${index + 1}`,
            gameId: optionalString(game?.id) ?? 'unknown',
            gameDate: optionalString(game?.date) ?? '',
            message: error instanceof Error ? error.message : 'A Hockey season-stat item is invalid.',
            canManage: row?.canManage === true,
          },
        }
      }
    }),
    nextCursor,
  }
}

function parseSource(value: unknown): HockeyCanonicalAggregateSource {
  if (!isPlainObject(value) || !isPlainObject(value.game)) throw invalid('A Hockey season-stat item is invalid.')
  if (!isPlainObject(value.participantSourceMap)) throw invalid('The Hockey participant source map is invalid.')
  const participantSourceMap: Record<string, string> = {}
  for (const [key, playerId] of Object.entries(value.participantSourceMap)) {
    participantSourceMap[key] = requiredString(playerId, `participant mapping ${key}`)
  }
  const game = value.game
  const cloudScope = game.cloudScope
  if (cloudScope !== 'team' && cloudScope !== 'personal') throw invalid('The Hockey game scope is invalid.')
  const teamId = nullableString(game.teamId, 'team id')
  if ((cloudScope === 'team') !== (teamId !== null)) throw invalid('The Hockey game team is invalid.')
  const publicationNumber = value.publicationNumber
  if (!Number.isInteger(publicationNumber) || (publicationNumber as number) < 1) throw invalid('The Hockey publication number is invalid.')
  if (typeof value.canManage !== 'boolean') throw invalid('The Hockey management flag is invalid.')
  return {
    publicationId: requiredString(value.publicationId, 'publication id'),
    publicationNumber: publicationNumber as number,
    snapshotFingerprint: requiredString(value.snapshotFingerprint, 'snapshot fingerprint'),
    finalizedAt: requiredString(value.finalizedAt, 'finalized time'),
    game: {
      id: requiredString(game.id, 'game id'),
      date: requiredString(game.date, 'game date'),
      status: requiredString(game.status, 'game status'),
      cloudScope,
      teamId,
      seasonId: nullableString(game.seasonId, 'season id'),
      tournamentId: nullableString(game.tournamentId, 'tournament id'),
      trackedTeamName: optionalString(game.trackedTeamName) ?? 'Tracked team',
      opponentName: optionalString(game.opponentName) ?? 'Opponent',
    },
    canonicalSnapshot: value.canonicalSnapshot,
    participantSourceMap,
    canManage: value.canManage,
  }
}

function consume(
  shared: SharedLoad,
  signal?: AbortSignal,
  onProgress?: (progress: HockeyAggregateLoadProgress) => void
): Promise<HockeyAggregateLoadResult> {
  if (signal?.aborted) return Promise.reject(aborted())
  shared.consumers += 1
  if (onProgress) {
    shared.listeners.add(onProgress)
    if (shared.latest) onProgress(shared.latest)
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = () => {
      if (settled) return false
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (onProgress) shared.listeners.delete(onProgress)
      shared.consumers -= 1
      if (shared.consumers === 0 && !shared.controller.signal.aborted) shared.controller.abort()
      return true
    }
    const onAbort = () => {
      if (finish()) reject(aborted())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    shared.promise.then(
      result => { if (finish()) resolve(result) },
      error => { if (finish()) reject(error) }
    )
  })
}

function isPlayerScope(scope: HockeyAggregateLoadScope): scope is Extract<HockeyAggregateLoadScope, { type: 'player' | 'career' }> {
  return scope.type === 'player' || scope.type === 'career'
}

function normalizedScope(scope: HockeyAggregateLoadScope): Record<string, string | null> {
  return isPlayerScope(scope)
    ? { type: scope.type, playerId: scope.playerId, teamId: scope.teamId ?? null, seasonId: scope.seasonId ?? null }
    : { type: scope.type, id: scope.id }
}

function aggregateScope(scope: HockeyAggregateLoadScope): HockeyAggregateScope {
  return isPlayerScope(scope) ? { type: scope.type, id: scope.playerId } : { type: scope.type, id: scope.id }
}

function rpcError(error: NonNullable<RpcResponse['error']>): HockeyAggregateTransportError {
  const text = `${error.message} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
  if (error.code === 'PGRST202' || error.code === '42883' || text.includes('schema cache') || text.includes('could not find the function')) {
    return new HockeyAggregateTransportError('backend_update_required', 'Hockey season stats require the latest backend update.', error)
  }
  if (error.code === '42501' || text.includes('permission denied') || text.includes('authentication required') || text.includes('app_access_')) {
    return new HockeyAggregateTransportError('access_denied', 'You do not have access to these Hockey season stats.', error)
  }
  return new HockeyAggregateTransportError('transport', 'Hockey season stats could not load.', error)
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`The Hockey ${label} is invalid.`)
  return value
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : requiredString(value, label)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function invalid(message: string): HockeyAggregateTransportError {
  return new HockeyAggregateTransportError('invalid_payload', message)
}

function aborted(): HockeyAggregateTransportError {
  return new HockeyAggregateTransportError('aborted', 'The Hockey season-stat load was cancelled.')
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw aborted()
}
