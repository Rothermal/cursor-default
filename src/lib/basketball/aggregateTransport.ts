import { isPlainObject } from '../gameEvents/envelope'
import { supabase } from '../supabase'
import {
  BasketballAggregateAuthorityCollisionError,
  aggregateBasketballMatches,
  projectBasketballLegacyAggregateSource,
  type BasketballAggregateResult,
  type BasketballAggregateRosterPlayer,
  type BasketballLegacyAggregateSource,
} from './aggregateComposition'
import {
  projectBasketballCanonicalAggregateSource,
  type BasketballAggregateExclusion,
  type BasketballAggregateMatch,
  type BasketballAggregatePeriodScore,
  type BasketballAggregateScope,
  type BasketballCanonicalAggregateSource,
} from './aggregateProjection'
import type { BasketballCanonicalSnapshot } from './finalization'
import type { BasketballStatId, BasketballStatTotals } from './types'

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50
const DEFAULT_PROJECTION_BATCH_SIZE = 5

const STAT_IDS: BasketballStatId[] = [
  'ft', 'ft_miss', '2pt', '2pt_miss', '3pt', '3pt_miss',
  'oreb', 'dreb', 'ast', 'stl', 'blk', 'to', 'pf', 'min',
]

export type BasketballAggregateLoadScope =
  | { type: 'team' | 'season' | 'tournament'; id: string }
  | {
      type: 'player' | 'career'
      playerId: string
      teamId?: string | null
      seasonId?: string | null
    }

export type BasketballAggregateTransportErrorCode =
  | 'aborted'
  | 'access_denied'
  | 'backend_update_required'
  | 'invalid_payload'
  | 'not_configured'
  | 'transport'

export class BasketballAggregateTransportError extends Error {
  readonly code: BasketballAggregateTransportErrorCode
  readonly causeDetail: unknown

  constructor(
    code: BasketballAggregateTransportErrorCode,
    message: string,
    causeDetail?: unknown
  ) {
    super(message)
    this.name = 'BasketballAggregateTransportError'
    this.code = code
    this.causeDetail = causeDetail
  }
}

export interface BasketballAggregateLoadProgress {
  stage: 'loading' | 'projecting' | 'complete'
  canonicalPageCount: number
  legacyPageCount: number
  canonicalSourceCount: number
  legacySourceCount: number
  projectedCount: number
  projectionTotal: number
}

export interface BasketballAggregateTransportMetrics {
  canonicalPageCount: number
  legacyPageCount: number
  canonicalSourceCount: number
  legacySourceCount: number
  eventCount: number
  payloadBytes: number
  networkTimeMs: number
  projectionTimeMs: number
  totalTimeMs: number
  maxProjectionBatchMs: number
  unresolvedParticipantCount: number
  excludedContributionCount: number
  malformedSourceCount: number
}

export interface BasketballAggregateLoadResult {
  aggregate: BasketballAggregateResult
  metrics: BasketballAggregateTransportMetrics
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

export interface BasketballAggregateRpcRequest extends PromiseLike<RpcResponse> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResponse>
}

export interface BasketballAggregateRpcClient {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>
  ) => BasketballAggregateRpcRequest
}

export interface BasketballAggregateLoadOptions {
  signal?: AbortSignal
  onProgress?: (progress: BasketballAggregateLoadProgress) => void
  activeRoster?: BasketballAggregateRosterPlayer[]
  pageSize?: number
  client?: BasketballAggregateRpcClient
  projectionBatchSize?: number
  yieldControl?: () => Promise<void>
  now?: () => number
}

type Authority = 'canonical' | 'legacy'

interface CanonicalCursor {
  finalizedAt: string
  publicationId: string
}

interface LegacyCursor {
  gameDate: string
  gameId: string
}

interface CanonicalTransportSource extends BasketballCanonicalAggregateSource {
  transportEventCount: number
  transportPayloadBytes: number
}

interface LegacyTransportSource extends BasketballLegacyAggregateSource {
  transportPayloadBytes: number
}

interface TransportRecord {
  authority: Authority
  dedupeKey: string
  gameId: string
  source: CanonicalTransportSource | LegacyTransportSource | null
  exclusion: BasketballAggregateExclusion | null
  transportEventCount: number
  transportPayloadBytes: number
}

interface DrainedFamily {
  pageCount: number
  records: TransportRecord[]
  networkTimeMs: number
}

interface SharedLoad {
  controller: AbortController
  promise: Promise<BasketballAggregateLoadResult>
  listeners: Set<(progress: BasketballAggregateLoadProgress) => void>
  latestProgress: BasketballAggregateLoadProgress | null
  consumerCount: number
}

const inFlightByClient = new WeakMap<object, Map<string, SharedLoad>>()

export function loadBasketballAggregates(
  scope: BasketballAggregateLoadScope,
  options: BasketballAggregateLoadOptions = {}
): Promise<BasketballAggregateLoadResult> {
  const client = options.client ??
    (supabase as unknown as BasketballAggregateRpcClient | null)
  if (!client) {
    return Promise.reject(new BasketballAggregateTransportError(
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
    const current: SharedLoad = {
      controller,
      promise: Promise.resolve(null as never),
      listeners: new Set(),
      latestProgress: null,
      consumerCount: 0,
    }
    current.promise = executeAggregateLoad(scope, {
      signal: controller.signal,
      activeRoster: normalizedRoster(options.activeRoster ?? []),
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
            console.error('[StatKeeper] Basketball aggregate progress listener failed', error)
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
  activeRoster: BasketballAggregateRosterPlayer[]
  pageSize: number
  projectionBatchSize: number
  yieldControl: () => Promise<void>
  now: () => number
  client: BasketballAggregateRpcClient
  onProgress: (progress: BasketballAggregateLoadProgress) => void
}

async function executeAggregateLoad(
  scope: BasketballAggregateLoadScope,
  options: ExecuteOptions
): Promise<BasketballAggregateLoadResult> {
  const startedAt = options.now()
  let canonicalPageCount = 0
  let legacyPageCount = 0
  let canonicalSourceCount = 0
  let legacySourceCount = 0
  const reportLoading = (authority: Authority, pageCount: number, sourceCount: number) => {
    if (authority === 'canonical') {
      canonicalPageCount = pageCount
      canonicalSourceCount = sourceCount
    } else {
      legacyPageCount = pageCount
      legacySourceCount = sourceCount
    }
    options.onProgress(progress('loading'))
  }

  const canonical = await drainFamily('canonical', scope, options, reportLoading)
  const legacy = await drainFamily('legacy', scope, options, reportLoading)
  const records = [...canonical.records, ...legacy.records]
  rejectCrossAuthorityCollisions(records)

  const matches: BasketballAggregateMatch[] = []
  const exclusions = records.flatMap(record => record.exclusion ? [record.exclusion] : [])
  const sources = records.flatMap(record => record.source ? [record.source] : [])
  const projectionStartedAt = options.now()
  let maxProjectionBatchMs = 0

  for (let offset = 0; offset < sources.length; offset += options.projectionBatchSize) {
    throwIfAborted(options.signal)
    const batchStartedAt = options.now()
    const batch = sources.slice(offset, offset + options.projectionBatchSize)
    for (const source of batch) {
      const projected = source.authority === 'canonical'
        ? projectBasketballCanonicalAggregateSource(source)
        : projectBasketballLegacyAggregateSource(source)
      if (projected.ok) matches.push(projected.match)
      else exclusions.push(projected.exclusion)
    }
    maxProjectionBatchMs = Math.max(
      maxProjectionBatchMs,
      options.now() - batchStartedAt
    )
    const projectedCount = Math.min(offset + batch.length, sources.length)
    options.onProgress(progress('projecting', projectedCount, sources.length))
    if (projectedCount < sources.length) await options.yieldControl()
  }

  throwIfAborted(options.signal)
  const aggregate = aggregateBasketballMatches(
    aggregateScope(scope),
    matches,
    exclusions,
    options.activeRoster,
    records.length
  )
  const projectionTimeMs = options.now() - projectionStartedAt
  const metrics: BasketballAggregateTransportMetrics = {
    canonicalPageCount,
    legacyPageCount,
    canonicalSourceCount,
    legacySourceCount,
    eventCount: records.reduce((sum, record) => sum + record.transportEventCount, 0),
    payloadBytes: records.reduce((sum, record) => sum + record.transportPayloadBytes, 0),
    networkTimeMs: canonical.networkTimeMs + legacy.networkTimeMs,
    projectionTimeMs,
    totalTimeMs: options.now() - startedAt,
    maxProjectionBatchMs,
    unresolvedParticipantCount: aggregate.metrics.unresolvedParticipantCount,
    excludedContributionCount: aggregate.metrics.excludedContributionCount,
    malformedSourceCount: aggregate.metrics.malformedSourceCount,
  }

  options.onProgress(progress('complete', sources.length, sources.length))
  return { aggregate, metrics }

  function progress(
    stage: BasketballAggregateLoadProgress['stage'],
    projectedCount = 0,
    projectionTotal = 0
  ): BasketballAggregateLoadProgress {
    return {
      stage,
      canonicalPageCount,
      legacyPageCount,
      canonicalSourceCount,
      legacySourceCount,
      projectedCount,
      projectionTotal,
    }
  }
}

async function drainFamily(
  authority: Authority,
  scope: BasketballAggregateLoadScope,
  options: ExecuteOptions,
  onPage: (authority: Authority, pageCount: number, sourceCount: number) => void
): Promise<DrainedFamily> {
  const records: TransportRecord[] = []
  const seenKeys = new Set<string>()
  const seenCursors = new Set<string>()
  let cursor: CanonicalCursor | LegacyCursor | null = null
  let pageCount = 0
  let networkTimeMs = 0

  do {
    throwIfAborted(options.signal)
    const cursorKey = cursor ? JSON.stringify(cursor) : 'first'
    if (seenCursors.has(cursorKey)) {
      throw invalidPayload(`Basketball ${authority} pagination returned a repeated cursor.`)
    }
    seenCursors.add(cursorKey)
    const networkStartedAt = options.now()
    const response = await requestPage(
      options.client,
      authority,
      scope,
      cursor,
      options.pageSize,
      options.signal
    )
    networkTimeMs += options.now() - networkStartedAt
    const page = parsePage(response, authority, pageCount + 1)
    pageCount += 1
    for (const record of page.records) {
      if (seenKeys.has(record.dedupeKey)) continue
      seenKeys.add(record.dedupeKey)
      records.push(record)
    }
    cursor = page.nextCursor
    onPage(authority, pageCount, records.length)
  } while (cursor)

  return { pageCount, records, networkTimeMs }
}

async function requestPage(
  client: BasketballAggregateRpcClient,
  authority: Authority,
  scope: BasketballAggregateLoadScope,
  cursor: CanonicalCursor | LegacyCursor | null,
  pageSize: number,
  signal: AbortSignal
): Promise<unknown> {
  const playerScope = isPlayerAggregateScope(scope)
  const functionName = authority === 'canonical'
    ? playerScope
      ? 'get_basketball_player_aggregate_publications'
      : 'get_basketball_scope_aggregate_publications'
    : playerScope
      ? 'get_basketball_player_aggregate_legacy_games'
      : 'get_basketball_scope_aggregate_legacy_games'
  const parameters = requestParameters(authority, scope, cursor, pageSize)

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
    if (
      error instanceof BasketballAggregateTransportError ||
      error instanceof BasketballAggregateAuthorityCollisionError
    ) throw error
    throw new BasketballAggregateTransportError(
      'transport',
      'Basketball aggregate sources could not load.',
      error
    )
  }
}

function requestParameters(
  authority: Authority,
  scope: BasketballAggregateLoadScope,
  cursor: CanonicalCursor | LegacyCursor | null,
  pageSize: number
): Record<string, unknown> {
  const playerScope = isPlayerAggregateScope(scope)
  const identity = playerScope
    ? {
        p_player_id: scope.playerId,
        p_team_id: scope.teamId ?? null,
        p_season_id: scope.seasonId ?? null,
      }
    : { p_scope_type: scope.type, p_scope_id: scope.id }
  return authority === 'canonical'
    ? {
        ...identity,
        p_before_finalized_at: (cursor as CanonicalCursor | null)?.finalizedAt ?? null,
        p_before_publication_id: (cursor as CanonicalCursor | null)?.publicationId ?? null,
        p_limit: pageSize,
      }
    : {
        ...identity,
        p_before_game_date: (cursor as LegacyCursor | null)?.gameDate ?? null,
        p_before_game_id: (cursor as LegacyCursor | null)?.gameId ?? null,
        p_limit: pageSize,
      }
}

function parsePage(
  value: unknown,
  authority: Authority,
  pageNumber: number
): {
  records: TransportRecord[]
  nextCursor: CanonicalCursor | LegacyCursor | null
} {
  if (!isPlainObject(value) || !Array.isArray(value.items)) {
    throw invalidPayload(`Basketball ${authority} aggregate page is invalid.`)
  }
  const nextCursor = value.nextCursor === null
    ? null
    : authority === 'canonical'
      ? parseCanonicalCursor(value.nextCursor)
      : parseLegacyCursor(value.nextCursor)
  return {
    records: value.items.map((item, index) =>
      parseTransportRecord(item, authority, pageNumber, index)
    ),
    nextCursor,
  }
}

function parseTransportRecord(
  value: unknown,
  authority: Authority,
  pageNumber: number,
  itemIndex: number
): TransportRecord {
  try {
    const source = authority === 'canonical'
      ? parseCanonicalSource(value)
      : parseLegacySource(value)
    return {
      authority,
      dedupeKey: source.authority === 'canonical'
        ? source.publicationId
        : source.sourceId,
      gameId: source.game.id,
      source,
      exclusion: null,
      transportEventCount: source.authority === 'canonical'
        ? source.transportEventCount
        : 0,
      transportPayloadBytes: source.transportPayloadBytes,
    }
  } catch (error) {
    const row = isPlainObject(value) ? value : null
    const game = row && isPlainObject(row.game) ? row.game : null
    const sourceId = optionalString(
      authority === 'canonical' ? row?.publicationId : row?.sourceId
    ) ?? `malformed-${authority}-page-${pageNumber}-item-${itemIndex + 1}`
    const gameId = optionalString(game?.id) ?? 'unknown'
    return {
      authority,
      dedupeKey: sourceId,
      gameId,
      source: null,
      exclusion: {
        kind: 'malformed_source',
        authority,
        sourceId,
        gameId,
        gameDate: optionalString(game?.date) ?? '',
        message: error instanceof Error
          ? error.message
          : `Basketball ${authority} source item is invalid.`,
        canManage: row?.canManage === true,
      },
      transportEventCount: authority === 'canonical'
        ? optionalNonNegativeInteger(row?.eventCount)
        : 0,
      transportPayloadBytes: optionalNonNegativeInteger(row?.payloadBytes),
    }
  }
}

function parseCanonicalSource(value: unknown): CanonicalTransportSource {
  if (!isPlainObject(value) || !isPlainObject(value.game)) {
    throw invalidPayload('Basketball canonical source item is invalid.')
  }
  if (!isPlainObject(value.canonicalSnapshot)) {
    throw invalidPayload('Basketball canonical snapshot payload is invalid.')
  }
  if (!isPlainObject(value.participantSourceMap)) {
    throw invalidPayload('Basketball participant source map is invalid.')
  }
  const participantSourceMap: Record<string, string> = {}
  for (const [key, playerId] of Object.entries(value.participantSourceMap)) {
    participantSourceMap[key] = requiredString(playerId, `participant mapping ${key}`)
  }
  return {
    authority: 'canonical',
    publicationId: requiredString(value.publicationId, 'publication id'),
    publicationNumber: requiredInteger(value.publicationNumber, 'publication number', 1),
    snapshotFingerprint: requiredString(value.snapshotFingerprint, 'snapshot fingerprint'),
    finalizedAt: requiredString(value.finalizedAt, 'finalized time'),
    active: true,
    game: parseGame(value.game),
    canonicalSnapshot: value.canonicalSnapshot as unknown as BasketballCanonicalSnapshot,
    participantSourceMap,
    canManage: requiredBoolean(value.canManage, 'management authority'),
    transportEventCount: requiredInteger(value.eventCount, 'event count'),
    transportPayloadBytes: requiredInteger(value.payloadBytes, 'payload bytes'),
  }
}

function parseLegacySource(value: unknown): LegacyTransportSource {
  if (!isPlainObject(value) || !isPlainObject(value.game)) {
    throw invalidPayload('Basketball legacy source item is invalid.')
  }
  if (!Array.isArray(value.players) || !Array.isArray(value.periods)) {
    throw invalidPayload('Basketball legacy source collections are invalid.')
  }
  if (!isPlainObject(value.score)) {
    throw invalidPayload('Basketball legacy score is invalid.')
  }
  return {
    authority: 'legacy',
    sourceId: requiredString(value.sourceId, 'legacy source id'),
    sourceFingerprint: requiredString(value.sourceFingerprint, 'legacy source fingerprint'),
    resolvedAt: requiredString(value.resolvedAt, 'legacy resolved time'),
    game: parseGame(value.game),
    players: value.players.map((player, index) => {
      if (!isPlainObject(player)) {
        throw invalidPayload(`Basketball legacy player ${index + 1} is invalid.`)
      }
      return {
        playerId: nullableString(player.playerId, `legacy player ${index + 1} id`),
        displayName: displayString(player.displayName, 'Basketball player'),
        number: nullableString(player.number, `legacy player ${index + 1} number`),
        stats: parseStats(player.stats, `legacy player ${index + 1}`),
        participationEvidence: requiredBoolean(
          player.participationEvidence,
          `legacy player ${index + 1} participation`
        ),
      }
    }),
    trackedStats: parseStats(value.trackedStats, 'legacy tracked team'),
    opponentStats: parseStats(value.opponentStats, 'legacy opponent team'),
    score: {
      tracked: requiredInteger(value.score.tracked, 'legacy tracked score'),
      opponent: requiredInteger(value.score.opponent, 'legacy opponent score'),
    },
    periods: value.periods.map((period, index) => parsePeriod(period, index)),
    canManage: requiredBoolean(value.canManage, 'management authority'),
    transportPayloadBytes: requiredInteger(value.payloadBytes, 'payload bytes'),
  }
}

function parseGame(value: Record<string, unknown>) {
  const cloudScope = value.cloudScope
  if (cloudScope !== 'team' && cloudScope !== 'personal') {
    throw invalidPayload('Basketball source cloud scope is invalid.')
  }
  const teamId = nullableString(value.teamId, 'team id')
  if ((cloudScope === 'team') !== (teamId !== null)) {
    throw invalidPayload('Basketball source team ownership is invalid.')
  }
  return {
    id: requiredString(value.id, 'game id'),
    date: requiredString(value.date, 'game date'),
    status: requiredString(value.status, 'game status'),
    cloudScope,
    teamId,
    seasonId: nullableString(value.seasonId, 'season id'),
    tournamentId: nullableString(value.tournamentId, 'tournament id'),
    trackedTeamName: displayString(value.trackedTeamName, 'Tracked team'),
    opponentName: displayString(value.opponentName, 'Opponent'),
  } as const
}

function parseStats(value: unknown, label: string): BasketballStatTotals {
  if (!isPlainObject(value)) throw invalidPayload(`Basketball ${label} stats are invalid.`)
  return Object.fromEntries(STAT_IDS.map(statId => [
    statId,
    requiredInteger(value[statId], `${label} ${statId}`),
  ])) as BasketballStatTotals
}

function parsePeriod(value: unknown, index: number): BasketballAggregatePeriodScore {
  if (!isPlainObject(value)) {
    throw invalidPayload(`Basketball legacy period ${index + 1} is invalid.`)
  }
  if (value.kind !== 'regulation' && value.kind !== 'overtime') {
    throw invalidPayload(`Basketball legacy period ${index + 1} kind is invalid.`)
  }
  return {
    periodId: requiredString(value.periodId, `legacy period ${index + 1} id`),
    label: requiredString(value.label, `legacy period ${index + 1} label`),
    order: requiredInteger(value.order, `legacy period ${index + 1} order`, 1),
    kind: value.kind as BasketballAggregatePeriodScore['kind'],
    tracked: requiredInteger(value.tracked, `legacy period ${index + 1} tracked score`),
    opponent: requiredInteger(value.opponent, `legacy period ${index + 1} opponent score`),
  }
}

function parseCanonicalCursor(value: unknown): CanonicalCursor {
  if (!isPlainObject(value)) throw invalidPayload('Canonical continuation cursor is invalid.')
  return {
    finalizedAt: requiredString(value.finalizedAt, 'cursor finalized time'),
    publicationId: requiredString(value.publicationId, 'cursor publication id'),
  }
}

function parseLegacyCursor(value: unknown): LegacyCursor {
  if (!isPlainObject(value)) throw invalidPayload('Legacy continuation cursor is invalid.')
  return {
    gameDate: requiredString(value.gameDate, 'cursor game date'),
    gameId: requiredString(value.gameId, 'cursor game id'),
  }
}

function rejectCrossAuthorityCollisions(records: TransportRecord[]): void {
  const canonical = new Set(records
    .filter(record => record.authority === 'canonical' && record.gameId !== 'unknown')
    .map(record => record.gameId))
  const collisions = records
    .filter(record => record.authority === 'legacy' && canonical.has(record.gameId))
    .map(record => record.gameId)
  if (collisions.length) throw new BasketballAggregateAuthorityCollisionError(collisions)
}

function consumeSharedLoad(
  shared: SharedLoad,
  signal?: AbortSignal,
  onProgress?: (progress: BasketballAggregateLoadProgress) => void
): Promise<BasketballAggregateLoadResult> {
  if (signal?.aborted) return Promise.reject(abortedError())
  shared.consumerCount += 1
  if (onProgress) {
    shared.listeners.add(onProgress)
    if (shared.latestProgress) onProgress(shared.latestProgress)
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
      if (finish()) reject(abortedError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    shared.promise.then(
      result => { if (finish()) resolve(result) },
      error => { if (finish()) reject(error) }
    )
  })
}

function normalizedScope(scope: BasketballAggregateLoadScope): Record<string, string | null> {
  return isPlayerAggregateScope(scope)
    ? {
        type: scope.type,
        playerId: scope.playerId,
        teamId: scope.teamId ?? null,
        seasonId: scope.seasonId ?? null,
      }
    : { type: scope.type, id: scope.id }
}

function aggregateScope(scope: BasketballAggregateLoadScope): BasketballAggregateScope {
  return isPlayerAggregateScope(scope)
    ? { type: scope.type, id: scope.playerId }
    : { type: scope.type, id: scope.id }
}

function normalizedRoster(
  roster: BasketballAggregateRosterPlayer[]
): BasketballAggregateRosterPlayer[] {
  return [...roster].sort((left, right) =>
    left.playerId.localeCompare(right.playerId) ||
    left.teamId.localeCompare(right.teamId) ||
    left.displayName.localeCompare(right.displayName) ||
    (left.number ?? '').localeCompare(right.number ?? '')
  )
}

function validateLoadInput(
  scope: BasketballAggregateLoadScope,
  pageSize: number,
  projectionBatchSize: number
): void {
  const identity = isPlayerAggregateScope(scope) ? scope.playerId : scope.id
  if (!identity.trim()) {
    throw invalidPayload('Basketball aggregate scope identity is required.')
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw invalidPayload(`Basketball aggregate page size must be between 1 and ${MAX_PAGE_SIZE}.`)
  }
  if (!Number.isInteger(projectionBatchSize) || projectionBatchSize < 1) {
    throw invalidPayload('Basketball aggregate projection batch size must be positive.')
  }
}

function isPlayerAggregateScope(
  scope: BasketballAggregateLoadScope
): scope is Extract<BasketballAggregateLoadScope, { type: 'player' | 'career' }> {
  return scope.type === 'player' || scope.type === 'career'
}

function rpcError(error: RpcError): BasketballAggregateTransportError {
  const combined = `${error.message} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
  if (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    combined.includes('schema cache') ||
    combined.includes('could not find the function')
  ) {
    return new BasketballAggregateTransportError(
      'backend_update_required',
      'Basketball aggregate data requires the latest backend update.',
      error
    )
  }
  if (
    error.code === '42501' ||
    combined.includes('permission denied') ||
    combined.includes('not authorized') ||
    combined.includes('authentication required') ||
    combined.includes('app_access_')
  ) {
    return new BasketballAggregateTransportError(
      'access_denied',
      'You do not have access to these Basketball aggregates.',
      error
    )
  }
  return new BasketballAggregateTransportError(
    'transport',
    'Basketball aggregate sources could not load.',
    error
  )
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidPayload(`Basketball aggregate ${label} is invalid.`)
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

function requiredBoolean(value: unknown, label: string): boolean {
  if (value !== true && value !== false) {
    throw invalidPayload(`Basketball aggregate ${label} is invalid.`)
  }
  return value
}

function requiredInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw invalidPayload(`Basketball aggregate ${label} is invalid.`)
  }
  return value as number
}

function optionalNonNegativeInteger(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 0 ? value as number : 0
}

function invalidPayload(message: string): BasketballAggregateTransportError {
  return new BasketballAggregateTransportError('invalid_payload', message)
}

function abortedError(): BasketballAggregateTransportError {
  return new BasketballAggregateTransportError(
    'aborted',
    'Basketball aggregate load was cancelled.'
  )
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
