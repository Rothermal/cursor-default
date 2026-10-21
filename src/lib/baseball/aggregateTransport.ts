import { captureAuthIdentity, isCurrentAuthIdentity } from '../authIdentity'
import { isPlainObject } from '../gameEvents/envelope'
import { stableJson } from '../gameEvents/stream'
import { supabase } from '../supabase'
import { baseballMapFingerprint, baseballUuid, parseBaseballParticipantMap } from './aggregateIdentity'
import { aggregateBaseballMatches, isPlayerScope, projectBaseballCanonicalAggregateSource } from './aggregateProjection'
import { BaseballFeatureError, createBaseballFeatureClient, exactKeys, invalid, requiredString, type BaseballRpcClient } from './featureClient'
import type { BaseballAggregateExclusion, BaseballAggregateLoadScope, BaseballAggregateMatch, BaseballAggregateResult,
  BaseballAggregateRosterPlayer, BaseballCanonicalAggregateSource } from './aggregateTypes'
import type { BaseballAggregateSourceGame } from './aggregateTypes'
import type { BaseballRulesVariant } from './types'

export type { BaseballAggregateLoadScope } from './aggregateTypes'
export interface BaseballAggregateProgress {
  stage: 'checking' | 'loading' | 'projecting' | 'complete'
  pageCount: number
  sourceCount: number
  projectedCount: number
}
export interface BaseballAggregateLoadResult {
  aggregate: BaseballAggregateResult
  metrics: { pageCount: number; sourceCount: number; projectedCount: number; payloadBytes: number }
}
export interface BaseballAggregateLoadOptions {
  userId: string
  variant: BaseballRulesVariant
  client?: BaseballRpcClient
  signal?: AbortSignal
  onProgress?: (progress: BaseballAggregateProgress) => void
  pageSize?: number
  projectionBatchSize?: number
  activeRoster?: readonly BaseballAggregateRosterPlayer[]
  /** A refresh/source lifetime may explicitly avoid joining an earlier in-flight load. */
  refreshGeneration?: number
  yieldControl?: () => Promise<void>
}
interface Cursor { finalizedAt: string; publicationId: string }
interface Subscription { progress?: (progress: BaseballAggregateProgress) => void }
interface SharedLoad {
  controller: AbortController
  promise: Promise<BaseballAggregateLoadResult>
  subscribers: Set<Subscription>
  latest?: BaseballAggregateProgress
}
const inFlight = new WeakMap<BaseballRpcClient, Map<string, SharedLoad>>()

export function loadBaseballAggregates(scope: BaseballAggregateLoadScope, options: BaseballAggregateLoadOptions): Promise<BaseballAggregateLoadResult> {
  try {
    const identity = captureAuthIdentity(options.userId)
    if (!identity) throw new BaseballFeatureError('stale_account', 'Sign in before loading Baseball totals.')
    if (options.signal?.aborted) throw aborted()
    const client = options.client ?? (supabase as unknown as BaseballRpcClient | null)
    if (!client) throw new BaseballFeatureError('not_configured', 'Supabase is not configured.')
    const normalized = normalizeScope(scope)
    const pageSize = options.pageSize ?? 20
    const batchSize = options.projectionBatchSize ?? 5
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 || !Number.isInteger(batchSize) || batchSize < 1) throw invalid('Invalid Baseball page/batch size.')
    if (!['baseball', 'softball_fastpitch', 'softball_slowpitch'].includes(options.variant)) throw invalid('Invalid Baseball variant.')
    if (options.refreshGeneration !== undefined && (!Number.isSafeInteger(options.refreshGeneration) || options.refreshGeneration < 0)) throw invalid('Invalid refresh generation.')
    const roster = structuredClone([...(options.activeRoster ?? [])]).sort((a, b) => a.playerId.localeCompare(b.playerId))
    const key = stableJson({ identity, scope: normalized, variant: options.variant, pageSize, batchSize, roster, refresh: options.refreshGeneration ?? 0 })
    let loads = inFlight.get(client)
    if (!loads) { loads = new Map(); inFlight.set(client, loads) }
    let shared = loads.get(key)
    if (shared?.controller.signal.aborted) shared = undefined
    if (!shared) {
      const current: SharedLoad = { controller: new AbortController(), promise: Promise.resolve(null as never), subscribers: new Set() }
      const feature = createBaseballFeatureClient(options.userId, { client, signal: current.controller.signal })
      const clientLoads = loads
      current.promise = execute(normalized, { ...options, activeRoster: roster, pageSize, projectionBatchSize: batchSize }, feature, progress => {
        feature.assertCurrent()
        current.latest = progress
        for (const subscriber of current.subscribers) {
          feature.assertCurrent()
          try { subscriber.progress?.({ ...progress }) } catch { /* Consumers do not own the shared request. */ }
        }
      }).finally(() => { if (clientLoads.get(key) === current) clientLoads.delete(key) })
      loads.set(key, current)
      shared = current
    }
    return consume(shared, options, () => {
      if (!isCurrentAuthIdentity(identity)) throw new BaseballFeatureError('stale_account', 'The Baseball account changed.')
    })
  } catch (error) { return Promise.reject(error) }
}

async function execute(
  scope: BaseballAggregateLoadScope, options: BaseballAggregateLoadOptions,
  feature: ReturnType<typeof createBaseballFeatureClient>, progress: (value: BaseballAggregateProgress) => void,
): Promise<BaseballAggregateLoadResult> {
  let pageCount = 0
  let sourceCount = 0
  let payloadBytes = 0
  progress({ stage: 'checking', pageCount, sourceCount, projectedCount: 0 })
  await feature.require('aggregate')
  feature.assertCurrent()
  const sources: BaseballCanonicalAggregateSource[] = []
  const exclusions: BaseballAggregateExclusion[] = []
  let cursor: Cursor | null = null
  do {
    feature.assertCurrent()
    const parameters = { ...(isPlayerScope(scope)
      ? { p_player_id: scope.playerId, p_team_id: scope.teamId ?? null, p_season_id: scope.seasonId ?? null }
      : { p_scope_type: scope.type, p_scope_id: scope.id }),
    p_before_finalized_at: cursor?.finalizedAt ?? null, p_before_publication_id: cursor?.publicationId ?? null, p_limit: options.pageSize }
    const response = await feature.request(isPlayerScope(scope) ? 'get_baseball_player_aggregate_publications' : 'get_baseball_scope_aggregate_publications', parameters)
    feature.assertCurrent()
    const page = parsePage(response, options.pageSize!)
    pageCount += 1
    sourceCount += page.items.length
    if (page.nextCursor && cursor && compareCursor(page.nextCursor, cursor) >= 0) throw invalid('Baseball paging did not advance.')
    for (const [index, item] of page.items.entries()) {
      try {
        const source = parseBaseballAggregateSource(item)
        assertSourceScope(source, scope)
        sources.push(source)
        payloadBytes += source.payloadBytes
      } catch (error) {
        const row = isPlainObject(item) ? item : null
        exclusions.push({ kind: 'malformed_source', sourceId: typeof row?.publicationId === 'string' ? row.publicationId : `page-${pageCount}-row-${index}`,
          gameId: isPlainObject(row?.game) && typeof row.game.id === 'string' ? row.game.id : 'unknown',
          message: error instanceof Error ? error.message : 'Invalid Baseball source.' })
      }
    }
    cursor = page.nextCursor
    progress({ stage: 'loading', pageCount, sourceCount, projectedCount: 0 })
  } while (cursor)
  const matches: BaseballAggregateMatch[] = []
  const batchSize = options.projectionBatchSize!
  for (let offset = 0; offset < sources.length; offset += batchSize) {
    feature.assertCurrent()
    for (const source of sources.slice(offset, offset + batchSize)) {
      const projected = projectBaseballCanonicalAggregateSource(source)
      if (projected.ok) matches.push(projected.match)
      else exclusions.push(projected.exclusion)
    }
    const count = Math.min(offset + batchSize, sources.length)
    progress({ stage: 'projecting', pageCount, sourceCount, projectedCount: count })
    if (count < sources.length) {
      feature.assertCurrent()
      await (options.yieldControl ?? (() => new Promise(resolve => setTimeout(resolve, 0))))()
      feature.assertCurrent()
    }
  }
  feature.assertCurrent()
  const aggregate = aggregateBaseballMatches(scope, options.variant, matches, exclusions, options.activeRoster)
  progress({ stage: 'complete', pageCount, sourceCount, projectedCount: sources.length })
  feature.assertCurrent()
  return { aggregate, metrics: { pageCount, sourceCount, projectedCount: sources.length, payloadBytes } }
}

function consume(shared: SharedLoad, options: BaseballAggregateLoadOptions, assertCurrent: () => void): Promise<BaseballAggregateLoadResult> {
  return new Promise((resolve, reject) => {
    const subscriber: Subscription = { progress: options.onProgress }
    let settled = false
    const finish = () => {
      if (settled) return false
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      shared.subscribers.delete(subscriber)
      if (!shared.subscribers.size) shared.controller.abort()
      return true
    }
    const onAbort = () => { if (finish()) reject(aborted()) }
    shared.subscribers.add(subscriber)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    shared.promise.then(result => {
      if (settled) return
      try { assertCurrent(); if (finish()) resolve(structuredClone(result)) } catch (error) { if (finish()) reject(error) }
    }, error => { if (finish()) reject(error) })
    if (options.signal?.aborted) { onAbort(); return }
    try {
      assertCurrent()
      if (shared.latest) options.onProgress?.({ ...shared.latest })
    } catch (error) {
      // Callback exceptions are local; account errors still invalidate delivery.
      try { assertCurrent() } catch (stale) { if (finish()) reject(stale); return }
      void error
    }
  })
}

export function parseBaseballAggregateSource(value: unknown): BaseballCanonicalAggregateSource {
  const keys = ['publicationId', 'publicationNumber', 'snapshotFingerprint', 'finalizedAt', 'eventCount', 'payloadBytes', 'game',
    'canonicalSnapshot', 'participantSourceMap', 'canManage', 'participantMapFingerprint', 'identityStatus', 'identityDiagnostic']
  if (!isPlainObject(value) || !exactKeys(value, keys) || !isPlainObject(value.game)) throw invalid('Invalid Baseball source envelope.')
  const game = value.game
  if (!exactKeys(game, ['id', 'date', 'status', 'cloudScope', 'teamId', 'seasonId', 'tournamentId', 'trackedTeamName', 'opponentName'])) throw invalid('Invalid Baseball game envelope.')
  const cloudScope = game.cloudScope
  if (cloudScope !== 'personal' && cloudScope !== 'team') throw invalid('Invalid Baseball cloud scope.')
  const nullableUuid = (v: unknown, label: string) => v === null ? null : baseballUuid(v, label)
  const teamId = nullableUuid(game.teamId, 'team')
  const seasonId = nullableUuid(game.seasonId, 'season')
  const tournamentId = nullableUuid(game.tournamentId, 'tournament')
  if ((cloudScope === 'team') !== Boolean(teamId) || (cloudScope === 'personal' && (seasonId || tournamentId))) throw invalid('Invalid Baseball team/tournament scope.')
  if (!Number.isSafeInteger(value.publicationNumber) || Number(value.publicationNumber) < 1
    || !Number.isSafeInteger(value.eventCount) || Number(value.eventCount) < 0
    || !Number.isSafeInteger(value.payloadBytes) || Number(value.payloadBytes) < 0) throw invalid('Invalid Baseball source counts.')
  const date = requiredString(game.date, 'game date')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw invalid('Invalid Baseball game date.')
  const finalizedAt = timestamp(value.finalizedAt)
  if (typeof value.canManage !== 'boolean' || !['valid', 'invalid'].includes(String(value.identityStatus))
    || (value.identityDiagnostic !== null && typeof value.identityDiagnostic !== 'string')) throw invalid('Invalid Baseball identity status.')
  if (value.identityStatus === 'valid' && (value.identityDiagnostic !== null || value.participantSourceMap === null)) throw invalid('Invalid Baseball valid identity envelope.')
  if (value.identityStatus === 'invalid' && (value.participantSourceMap !== null || !value.identityDiagnostic)) throw invalid('Invalid Baseball invalid identity envelope.')
  return { publicationId: baseballUuid(value.publicationId, 'publication'), publicationNumber: Number(value.publicationNumber),
    snapshotFingerprint: requiredString(value.snapshotFingerprint, 'snapshot fingerprint'), finalizedAt,
    eventCount: Number(value.eventCount), payloadBytes: Number(value.payloadBytes),
    game: { id: baseballUuid(game.id, 'game'), date, status: requiredString(game.status, 'status'), cloudScope, teamId, seasonId, tournamentId,
      trackedTeamName: game.trackedTeamName === null ? 'Tracked team' : requiredString(game.trackedTeamName, 'team name'),
      opponentName: game.opponentName === null ? 'Opponent' : requiredString(game.opponentName, 'opponent name') },
    canonicalSnapshot: value.canonicalSnapshot, participantSourceMap: value.participantSourceMap === null ? null : parseBaseballParticipantMap(value.participantSourceMap),
    participantMapFingerprint: value.participantMapFingerprint === null ? null : baseballMapFingerprint(value.participantMapFingerprint),
    identityStatus: value.identityStatus as 'valid' | 'invalid', identityDiagnostic: value.identityDiagnostic as string | null, canManage: value.canManage }
}
function parsePage(value: unknown, limit: number): { items: unknown[]; nextCursor: Cursor | null } {
  if (!isPlainObject(value) || !exactKeys(value, ['items', 'nextCursor']) || !Array.isArray(value.items) || value.items.length > limit) throw invalid('Invalid Baseball aggregate page.')
  let nextCursor: Cursor | null = null
  if (value.nextCursor !== null) {
    if (!isPlainObject(value.nextCursor) || !exactKeys(value.nextCursor, ['finalizedAt', 'publicationId']) || !value.items.length) throw invalid('Invalid Baseball page cursor.')
    nextCursor = { finalizedAt: timestamp(value.nextCursor.finalizedAt), publicationId: baseballUuid(value.nextCursor.publicationId, 'cursor publication') }
    const last = value.items[value.items.length - 1]
    if (!isPlainObject(last) || last.publicationId !== nextCursor.publicationId || last.finalizedAt !== nextCursor.finalizedAt) throw invalid('Baseball page cursor does not match its boundary.')
  }
  return { items: value.items, nextCursor }
}
function normalizeScope(scope: BaseballAggregateLoadScope): BaseballAggregateLoadScope {
  if (isPlayerScope(scope)) return { type: scope.type, playerId: baseballUuid(scope.playerId, 'player'),
    teamId: scope.teamId == null ? null : baseballUuid(scope.teamId, 'team'), seasonId: scope.seasonId == null ? null : baseballUuid(scope.seasonId, 'season') }
  if (!['team', 'season', 'tournament'].includes(scope.type)) throw invalid('Invalid Baseball aggregate scope.')
  if (scope.type === 'tournament') return { type: 'tournament', id: baseballUuid(scope.id, 'tournament'), teamId: baseballUuid(scope.teamId, 'tournament team') }
  return { type: scope.type, id: baseballUuid(scope.id, 'scope') }
}
function assertSourceScope(source: BaseballCanonicalAggregateSource, scope: BaseballAggregateLoadScope): void {
  if (isPlayerScope(scope)) {
    if (scope.teamId && source.game.teamId !== scope.teamId || scope.seasonId && source.game.seasonId !== scope.seasonId) throw invalid('Baseball source escaped its player scope.')
    // Invalid own-game identity rows are diagnostics, not fabricated player contributions.
    if (source.identityStatus === 'valid' && !Object.values(source.participantSourceMap ?? {}).includes(scope.playerId)) throw invalid('Baseball source does not contain the requested player.')
  } else {
    const expected = scope.type === 'team' ? source.game.teamId : scope.type === 'season' ? source.game.seasonId : source.game.tournamentId
    if (source.game.cloudScope !== 'team' || expected !== scope.id) throw invalid('Baseball source escaped its authorized scope.')
    if (scope.type === 'tournament') assertBaseballTournamentAssociation(source.game, { id: scope.id, teamId: scope.teamId })
  }
}
/** The caller supplies tournament metadata read through existing authorization, never a name. */
export function assertBaseballTournamentAssociation(
  game: Pick<BaseballAggregateSourceGame, 'cloudScope' | 'teamId' | 'tournamentId'>,
  tournament: { id: string; teamId: string },
): void {
  const id = baseballUuid(tournament.id, 'tournament')
  const teamId = baseballUuid(tournament.teamId, 'tournament team')
  if (game.cloudScope !== 'team' || game.teamId !== teamId || game.tournamentId !== id) {
    throw invalid('Baseball tournament attachment requires its authorized owning team.')
  }
}
function timestamp(value: unknown): string {
  const text = requiredString(value, 'timestamp')
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(text) || !Number.isFinite(Date.parse(text))) throw invalid('Invalid Baseball timestamp.')
  return text
}
function compareCursor(a: Cursor, b: Cursor): number {
  // PostgreSQL keysets preserve microseconds; Date alone would collapse tied milliseconds.
  const micros = (s: string) => {
    const fraction = s.match(/\.(\d+)/)?.[1] ?? ''
    return BigInt(Date.parse(s.replace(/\.\d+/, ''))) * 1000n + BigInt(fraction.padEnd(6, '0'))
  }
  const left = micros(a.finalizedAt), right = micros(b.finalizedAt)
  return left < right ? -1 : left > right ? 1 : a.publicationId.localeCompare(b.publicationId)
}
function aborted(): BaseballFeatureError { return new BaseballFeatureError('aborted', 'The Baseball aggregate load was cancelled.') }
