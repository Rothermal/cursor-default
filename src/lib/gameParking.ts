import type { CloudSyncStatus, GameState } from '../types'
import { buildGameSyncFingerprint } from './gameSyncFingerprint'
import {
  GAME_OWNER_KEY,
  GAME_RECORD_KEY_PREFIX,
  GAME_STORAGE_KEY,
  GAMES_MANIFEST_KEY,
  PENDING_SYNC_KEY,
} from './gameStorageKeys'

const MANIFEST_VERSION = 1
const EXPORT_VERSION = 1
export const MAX_PARKED_GAMES = 12

export type ParkedGameStorageErrorCode = 'quota' | 'max_parked_games' | 'invalid_import'

export class ParkedGameStorageError extends Error {
  code: ParkedGameStorageErrorCode

  constructor(code: ParkedGameStorageErrorCode, message: string) {
    super(message)
    this.name = 'ParkedGameStorageError'
    this.code = code
  }
}

export interface ParkedGameSyncState {
  dirty: boolean
  revision: number
  lastEnqueuedRevision: number | null
  lastSuccessfulSyncRevision: number | null
  attempts: number
  lastError: string | null
  nextAttemptAt: string | null
}

export interface ParkedGameSummary {
  localGameId: string
  sportId: string | null
  sportName: string
  sportIcon: string
  teamName: string
  opponentName: string
  gameDate: string | null
  status: string | null
  updatedAt: string
  cloudGameId: string | null
  syncStatus: CloudSyncStatus
  syncDirty: boolean
  syncLastError: string | null
}

export interface ParkedGamesManifest {
  version: number
  ownerId: string | null
  activeLocalGameId: string | null
  gameIds: string[]
  summaries: Record<string, ParkedGameSummary>
}

export interface ParkedGameRecord {
  localGameId: string
  ownerId: string | null
  createdAt: string
  updatedAt: string
  gameState: GameState
  summary: ParkedGameSummary
  sync: ParkedGameSyncState
}

export interface ParkedGameStorageInfo {
  parkedCount: number
  maxParkedGames: number
  canCreateParkedGame: boolean
  estimatedBytes: number
}

export interface ParkedGamesExportPayload {
  version: number
  exportedAt: string
  ownerId: string | null
  activeLocalGameId: string | null
  records: ParkedGameRecord[]
}

export interface ImportParkedGamesResult {
  imported: number
  skipped: number
  summaries: ParkedGameSummary[]
}

function gameRecordKey(localGameId: string): string {
  return `${GAME_RECORD_KEY_PREFIX}${localGameId}`
}

function createLocalGameId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

function nowIso(): string {
  return new Date().toISOString()
}

function emptyManifest(ownerId: string | null): ParkedGamesManifest {
  return {
    version: MANIFEST_VERSION,
    ownerId,
    activeLocalGameId: null,
    gameIds: [],
    summaries: {},
  }
}

function isManifest(value: unknown): value is ParkedGamesManifest {
  if (!value || typeof value !== 'object') return false
  const maybe = value as Partial<ParkedGamesManifest>
  return Array.isArray(maybe.gameIds) && typeof maybe.summaries === 'object'
}

function readManifest(ownerId: string | null): ParkedGamesManifest {
  const raw = localStorage.getItem(GAMES_MANIFEST_KEY)
  if (!raw) return emptyManifest(ownerId)

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isManifest(parsed)) return emptyManifest(ownerId)
    if (parsed.ownerId && ownerId && parsed.ownerId !== ownerId) {
      clearAllParkedGames()
      return emptyManifest(ownerId)
    }
    return {
      ...emptyManifest(ownerId),
      ...parsed,
      version: MANIFEST_VERSION,
      ownerId: parsed.ownerId ?? ownerId,
      activeLocalGameId:
        typeof parsed.activeLocalGameId === 'string' ? parsed.activeLocalGameId : null,
      gameIds: parsed.gameIds.filter((id): id is string => typeof id === 'string'),
      summaries: parsed.summaries ?? {},
    }
  } catch {
    return emptyManifest(ownerId)
  }
}

function isQuotaError(error: unknown): boolean {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 22
  ) {
    return true
  }
  if (!(error instanceof DOMException)) return false
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
  )
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch (error) {
    if (isQuotaError(error)) {
      throw new ParkedGameStorageError(
        'quota',
        'Local storage is full. Export or discard a parked game before continuing.'
      )
    }
    throw error
  }
}

function writeManifest(manifest: ParkedGamesManifest): void {
  safeSetItem(GAMES_MANIFEST_KEY, JSON.stringify(manifest))
}

function canCreateLocalGameId(manifest: ParkedGamesManifest): boolean {
  return manifest.gameIds.length < MAX_PARKED_GAMES
}

function assertCanCreateLocalGameId(manifest: ParkedGamesManifest): void {
  if (canCreateLocalGameId(manifest)) return
  throw new ParkedGameStorageError(
    'max_parked_games',
    `This device can park up to ${MAX_PARKED_GAMES} games. Resume, export, or discard one before starting another.`
  )
}

function estimatedStorageBytes(manifest: ParkedGamesManifest): number {
  let total = (localStorage.getItem(GAMES_MANIFEST_KEY) ?? '').length
  for (const id of manifest.gameIds) {
    total += (localStorage.getItem(gameRecordKey(id)) ?? '').length
  }
  total += (localStorage.getItem(GAME_STORAGE_KEY) ?? '').length
  return total * 2
}

function readRecord(localGameId: string): ParkedGameRecord | null {
  try {
    const raw = localStorage.getItem(gameRecordKey(localGameId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ParkedGameRecord
    if (!parsed || parsed.localGameId !== localGameId || !parsed.gameState) return null
    const sync = normalizeSyncState(parsed.sync, null, parsed.gameState)
    const updatedAt =
      typeof parsed.updatedAt === 'string'
        ? parsed.updatedAt
        : parsed.summary?.updatedAt ?? nowIso()
    return {
      ...parsed,
      updatedAt,
      summary: buildSummary(localGameId, parsed.gameState, updatedAt, sync),
      sync,
    }
  } catch {
    return null
  }
}

function hasSyncablePayload(state: GameState): boolean {
  return Boolean(state.sport && state.gameInfo && state.cloudSync.gameStatus !== 'final')
}

function normalizeSyncState(
  value: Partial<ParkedGameSyncState> | null | undefined,
  existing: ParkedGameRecord | null,
  state: GameState
): ParkedGameSyncState {
  const revision =
    typeof value?.revision === 'number'
      ? Math.max(0, Math.floor(value.revision))
      : existing?.sync.revision ?? 0
  const fingerprint = hasSyncablePayload(state) ? buildGameSyncFingerprint(state) : null
  const dirty = Boolean(
    hasSyncablePayload(state) &&
      fingerprint &&
      state.cloudSync.lastSyncedGameFingerprint !== fingerprint
  )

  return {
    dirty: typeof value?.dirty === 'boolean' ? value.dirty : dirty,
    revision,
    lastEnqueuedRevision:
      typeof value?.lastEnqueuedRevision === 'number'
        ? Math.max(0, Math.floor(value.lastEnqueuedRevision))
        : existing?.sync.lastEnqueuedRevision ?? null,
    lastSuccessfulSyncRevision:
      typeof value?.lastSuccessfulSyncRevision === 'number'
        ? Math.max(0, Math.floor(value.lastSuccessfulSyncRevision))
        : existing?.sync.lastSuccessfulSyncRevision ?? (dirty ? null : revision),
    attempts:
      typeof value?.attempts === 'number'
        ? Math.max(0, Math.floor(value.attempts))
        : existing?.sync.attempts ?? 0,
    lastError:
      typeof value?.lastError === 'string'
        ? value.lastError
        : existing?.sync.lastError ?? null,
    nextAttemptAt:
      typeof value?.nextAttemptAt === 'string'
        ? value.nextAttemptAt
        : existing?.sync.nextAttemptAt ?? null,
  }
}

function buildSyncState(
  existing: ParkedGameRecord | null,
  state: GameState,
  patch: Partial<ParkedGameSyncState> = {}
): ParkedGameSyncState {
  const fingerprint = hasSyncablePayload(state) ? buildGameSyncFingerprint(state) : null
  const previousFingerprint = existing ? buildGameSyncFingerprint(existing.gameState) : null
  const payloadChanged = fingerprint !== previousFingerprint
  const revision = (existing?.sync.revision ?? 0) + (payloadChanged ? 1 : 0)
  const dirty = Boolean(
    hasSyncablePayload(state) &&
      fingerprint &&
      state.cloudSync.lastSyncedGameFingerprint !== fingerprint
  )
  const base: ParkedGameSyncState = {
    dirty,
    revision,
    lastEnqueuedRevision: dirty ? revision : existing?.sync.lastEnqueuedRevision ?? null,
    lastSuccessfulSyncRevision: dirty
      ? existing?.sync.lastSuccessfulSyncRevision ?? null
      : revision,
    attempts: dirty ? (payloadChanged ? 0 : existing?.sync.attempts ?? 0) : 0,
    lastError: dirty ? (payloadChanged ? null : existing?.sync.lastError ?? null) : null,
    nextAttemptAt: dirty ? (payloadChanged ? null : existing?.sync.nextAttemptAt ?? null) : null,
  }

  return normalizeSyncState({ ...base, ...patch }, existing, state)
}

function hasPersistableGameState(state: GameState): boolean {
  return Boolean(
    state.sport ||
      state.gameInfo ||
      state.players.length > 0 ||
      state.actionLog.length > 0 ||
      state.shotChart.length > 0 ||
      state.cloudSync.gameId
  )
}

function buildSummary(
  localGameId: string,
  state: GameState,
  updatedAt: string,
  sync: ParkedGameSyncState
): ParkedGameSummary {
  const syncStatus: CloudSyncStatus = sync.dirty
    ? sync.lastError || state.cloudSync.status === 'error'
      ? 'error'
      : state.cloudSync.status === 'offline' || state.cloudSync.status === 'syncing'
        ? state.cloudSync.status
        : 'idle'
    : state.cloudSync.status

  return {
    localGameId,
    sportId: state.sport?.id ?? null,
    sportName: state.sport?.name ?? 'Unknown sport',
    sportIcon: state.sport?.icon ?? '',
    teamName: state.gameInfo?.teamName?.trim() || 'Untitled team',
    opponentName: state.gameInfo?.opponentName?.trim() || 'Opponent TBD',
    gameDate: state.gameInfo?.date ?? null,
    status: state.cloudSync.gameStatus,
    updatedAt,
    cloudGameId: state.cloudSync.gameId,
    syncStatus,
    syncDirty: sync.dirty,
    syncLastError: sync.lastError,
  }
}

function writeLegacyMirror(state: GameState, ownerId: string | null): void {
  safeSetItem(GAME_STORAGE_KEY, JSON.stringify(state))
  if (ownerId) {
    safeSetItem(GAME_OWNER_KEY, ownerId)
  }
}

function removeLegacyMirror(): void {
  localStorage.removeItem(GAME_STORAGE_KEY)
  localStorage.removeItem(GAME_OWNER_KEY)
  localStorage.removeItem(PENDING_SYNC_KEY)
}

export function migrateLegacyGameStorage(ownerId: string | null): ParkedGamesManifest {
  const existing = localStorage.getItem(GAMES_MANIFEST_KEY)
  if (existing) return readManifest(ownerId)

  const legacyRaw = localStorage.getItem(GAME_STORAGE_KEY)
  if (!legacyRaw) return emptyManifest(ownerId)

  const legacyOwner = localStorage.getItem(GAME_OWNER_KEY)
  if (legacyOwner && ownerId && legacyOwner !== ownerId) {
    removeLegacyMirror()
    return emptyManifest(ownerId)
  }

  let localGameId: string | null = null
  try {
    const gameState = JSON.parse(legacyRaw) as GameState
    if (!hasPersistableGameState(gameState) || gameState.cloudSync?.gameStatus === 'final') {
      removeLegacyMirror()
      return emptyManifest(ownerId)
    }

    localGameId = createLocalGameId()
    const updatedAt = nowIso()
    const sync = buildSyncState(null, gameState)
    const summary = buildSummary(localGameId, gameState, updatedAt, sync)
    const manifest: ParkedGamesManifest = {
      ...emptyManifest(ownerId),
      activeLocalGameId: localGameId,
      gameIds: [localGameId],
      summaries: { [localGameId]: summary },
    }
    const record: ParkedGameRecord = {
      localGameId,
      ownerId,
      createdAt: updatedAt,
      updatedAt,
      gameState,
      summary,
      sync,
    }

    safeSetItem(gameRecordKey(localGameId), JSON.stringify(record))
    writeManifest(manifest)
    return manifest
  } catch {
    if (localGameId) {
      try {
        localStorage.removeItem(gameRecordKey(localGameId))
      } catch {
        // ignore rollback failure; preserving legacy is the important part
      }
    }
    return emptyManifest(ownerId)
  }
}

export function loadActiveParkedGameState(ownerId: string | null): GameState | null {
  const manifest = migrateLegacyGameStorage(ownerId)
  const activeId = manifest.activeLocalGameId
  if (!activeId) return null

  const record = readRecord(activeId)
  if (!record || record.gameState.cloudSync?.gameStatus === 'final') {
    discardParkedGame(activeId, ownerId)
    return null
  }
  return record.gameState
}

export function listParkedGames(ownerId: string | null): ParkedGameSummary[] {
  const manifest = migrateLegacyGameStorage(ownerId)
  return manifest.gameIds
    .map(id => readRecord(id)?.summary ?? manifest.summaries[id])
    .filter((summary): summary is ParkedGameSummary => Boolean(summary))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getParkedGameStorageInfo(ownerId: string | null): ParkedGameStorageInfo {
  const manifest = migrateLegacyGameStorage(ownerId)
  return {
    parkedCount: manifest.gameIds.length,
    maxParkedGames: MAX_PARKED_GAMES,
    canCreateParkedGame: canCreateLocalGameId(manifest),
    estimatedBytes: estimatedStorageBytes(manifest),
  }
}

export function getActiveLocalGameId(ownerId: string | null): string | null {
  return migrateLegacyGameStorage(ownerId).activeLocalGameId
}

export function saveActiveGameState(
  state: GameState,
  ownerId: string | null
): ParkedGameSummary[] {
  const manifest = migrateLegacyGameStorage(ownerId)
  if (!hasPersistableGameState(state) || state.cloudSync.gameStatus === 'final') {
    if (manifest.activeLocalGameId) {
      return discardParkedGame(manifest.activeLocalGameId, ownerId)
    }
    removeLegacyMirror()
    return listParkedGames(ownerId)
  }

  const hasActiveId = Boolean(manifest.activeLocalGameId)
  if (!hasActiveId) {
    assertCanCreateLocalGameId(manifest)
  }
  const localGameId = manifest.activeLocalGameId ?? createLocalGameId()
  const existing = readRecord(localGameId)
  const updatedAt = nowIso()
  const sync = buildSyncState(existing, state)
  const summary = buildSummary(localGameId, state, updatedAt, sync)
  const record: ParkedGameRecord = {
    localGameId,
    ownerId,
    createdAt: existing?.createdAt ?? updatedAt,
    updatedAt,
    gameState: state,
    summary,
    sync,
  }

  safeSetItem(gameRecordKey(localGameId), JSON.stringify(record))
  writeLegacyMirror(state, ownerId)

  const gameIds = manifest.gameIds.includes(localGameId)
    ? manifest.gameIds
    : [localGameId, ...manifest.gameIds]
  writeManifest({
    ...manifest,
    ownerId,
    activeLocalGameId: localGameId,
    gameIds,
    summaries: {
      ...manifest.summaries,
      [localGameId]: summary,
    },
  })

  return listParkedGames(ownerId)
}

export function getParkedGameRecord(
  localGameId: string,
  ownerId: string | null
): ParkedGameRecord | null {
  migrateLegacyGameStorage(ownerId)
  const record = readRecord(localGameId)
  if (!record) return null
  if (record.ownerId && ownerId && record.ownerId !== ownerId) return null
  return record
}

export function listParkedGameRecords(ownerId: string | null): ParkedGameRecord[] {
  const manifest = migrateLegacyGameStorage(ownerId)
  return manifest.gameIds
    .map(id => readRecord(id))
    .filter((record): record is ParkedGameRecord => Boolean(record))
    .filter(record => !record.ownerId || !ownerId || record.ownerId === ownerId)
}

export function hasDirtyParkedGames(ownerId: string | null): boolean {
  return listParkedGameRecords(ownerId).some(record => record.sync.dirty)
}

export function listDirtyParkedGameRecords(
  ownerId: string | null,
  now: Date = new Date()
): ParkedGameRecord[] {
  const nowMs = now.getTime()
  const manifest = migrateLegacyGameStorage(ownerId)
  const activeId = manifest.activeLocalGameId
  return listParkedGameRecords(ownerId)
    .filter(record => {
      if (!record.sync.dirty) return false
      if (!record.sync.nextAttemptAt) return true
      const nextMs = Date.parse(record.sync.nextAttemptAt)
      return Number.isNaN(nextMs) || nextMs <= nowMs
    })
    .sort((a, b) => {
      if (a.localGameId === activeId) return -1
      if (b.localGameId === activeId) return 1
      return a.updatedAt.localeCompare(b.updatedAt)
    })
}

export function saveParkedGameRecordState(
  localGameId: string,
  state: GameState,
  ownerId: string | null,
  syncPatch: Partial<ParkedGameSyncState> = {}
): ParkedGameSummary[] {
  const manifest = migrateLegacyGameStorage(ownerId)
  const existing = readRecord(localGameId)
  if (!existing && !manifest.gameIds.includes(localGameId)) {
    assertCanCreateLocalGameId(manifest)
  }
  const createdAt = existing?.createdAt ?? nowIso()
  const updatedAt = nowIso()
  const sync = buildSyncState(existing, state, syncPatch)
  const summary = buildSummary(localGameId, state, updatedAt, sync)
  const record: ParkedGameRecord = {
    localGameId,
    ownerId,
    createdAt,
    updatedAt,
    gameState: state,
    summary,
    sync,
  }
  safeSetItem(gameRecordKey(localGameId), JSON.stringify(record))

  const gameIds = manifest.gameIds.includes(localGameId)
    ? manifest.gameIds
    : [localGameId, ...manifest.gameIds]
  writeManifest({
    ...manifest,
    ownerId,
    gameIds,
    summaries: {
      ...manifest.summaries,
      [localGameId]: summary,
    },
  })

  if (manifest.activeLocalGameId === localGameId) {
    writeLegacyMirror(state, ownerId)
  }

  return listParkedGames(ownerId)
}

export function beginNewActiveParkedGame(ownerId: string | null): string {
  const manifest = migrateLegacyGameStorage(ownerId)
  assertCanCreateLocalGameId(manifest)
  const localGameId = createLocalGameId()
  writeManifest({
    ...manifest,
    ownerId,
    activeLocalGameId: localGameId,
    gameIds: manifest.gameIds.includes(localGameId)
      ? manifest.gameIds
      : [localGameId, ...manifest.gameIds],
  })
  removeLegacyMirror()
  return localGameId
}

export function parkActiveGame(ownerId: string | null): ParkedGameSummary[] {
  const manifest = migrateLegacyGameStorage(ownerId)
  writeManifest({
    ...manifest,
    ownerId,
    activeLocalGameId: null,
  })
  removeLegacyMirror()
  return listParkedGames(ownerId)
}

export function activateParkedGame(localGameId: string, ownerId: string | null): GameState | null {
  const manifest = migrateLegacyGameStorage(ownerId)
  const record = readRecord(localGameId)
  if (!record) return null

  writeManifest({
    ...manifest,
    ownerId,
    activeLocalGameId: localGameId,
    gameIds: manifest.gameIds.includes(localGameId)
      ? manifest.gameIds
      : [localGameId, ...manifest.gameIds],
    summaries: {
      ...manifest.summaries,
      [localGameId]: record.summary,
    },
  })
  writeLegacyMirror(record.gameState, ownerId)
  return record.gameState
}

export function discardParkedGame(
  localGameId: string,
  ownerId: string | null
): ParkedGameSummary[] {
  const manifest = migrateLegacyGameStorage(ownerId)
  localStorage.removeItem(gameRecordKey(localGameId))
  const summaries = { ...manifest.summaries }
  delete summaries[localGameId]
  const activeLocalGameId =
    manifest.activeLocalGameId === localGameId ? null : manifest.activeLocalGameId

  writeManifest({
    ...manifest,
    ownerId,
    activeLocalGameId,
    gameIds: manifest.gameIds.filter(id => id !== localGameId),
    summaries,
  })

  if (manifest.activeLocalGameId === localGameId) {
    removeLegacyMirror()
  }

  return listParkedGames(ownerId)
}

export function clearActiveParkedGame(ownerId: string | null): ParkedGameSummary[] {
  const manifest = migrateLegacyGameStorage(ownerId)
  if (!manifest.activeLocalGameId) {
    removeLegacyMirror()
    return listParkedGames(ownerId)
  }
  return discardParkedGame(manifest.activeLocalGameId, ownerId)
}

export function clearAllParkedGames(): void {
  try {
    const raw = localStorage.getItem(GAMES_MANIFEST_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (isManifest(parsed)) {
        for (const id of parsed.gameIds) {
          localStorage.removeItem(gameRecordKey(id))
        }
      }
    }
    localStorage.removeItem(GAMES_MANIFEST_KEY)
    removeLegacyMirror()
  } catch {
    // ignore
  }
}

export function exportParkedGames(ownerId: string | null): string {
  const manifest = migrateLegacyGameStorage(ownerId)
  const payload: ParkedGamesExportPayload = {
    version: EXPORT_VERSION,
    exportedAt: nowIso(),
    ownerId: manifest.ownerId ?? ownerId,
    activeLocalGameId: manifest.activeLocalGameId,
    records: listParkedGameRecords(ownerId),
  }
  return JSON.stringify(payload, null, 2)
}

function parseImportPayload(raw: string): ParkedGamesExportPayload {
  try {
    const parsed = JSON.parse(raw) as Partial<ParkedGamesExportPayload>
    if (!parsed || parsed.version !== EXPORT_VERSION || !Array.isArray(parsed.records)) {
      throw new Error('Invalid export file')
    }
    return parsed as ParkedGamesExportPayload
  } catch {
    throw new ParkedGameStorageError(
      'invalid_import',
      'This file is not a valid StatKeeper parked games export.'
    )
  }
}

export function importParkedGames(raw: string, ownerId: string | null): ImportParkedGamesResult {
  const payload = parseImportPayload(raw)
  const manifest = migrateLegacyGameStorage(ownerId)
  const summaries = { ...manifest.summaries }
  const gameIds = [...manifest.gameIds]
  let imported = 0
  let skipped = 0

  for (const incoming of payload.records) {
    if (!incoming?.localGameId || !incoming.gameState) {
      skipped += 1
      continue
    }
    if (!gameIds.includes(incoming.localGameId) && gameIds.length >= MAX_PARKED_GAMES) {
      skipped += 1
      continue
    }

    const updatedAt = typeof incoming.updatedAt === 'string' ? incoming.updatedAt : nowIso()
    const sync = normalizeSyncState(incoming.sync, null, incoming.gameState)
    const record: ParkedGameRecord = {
      localGameId: incoming.localGameId,
      ownerId,
      createdAt: typeof incoming.createdAt === 'string' ? incoming.createdAt : updatedAt,
      updatedAt,
      gameState: incoming.gameState,
      sync,
      summary: buildSummary(incoming.localGameId, incoming.gameState, updatedAt, sync),
    }
    safeSetItem(gameRecordKey(record.localGameId), JSON.stringify(record))
    if (!gameIds.includes(record.localGameId)) {
      gameIds.push(record.localGameId)
    }
    summaries[record.localGameId] = record.summary
    imported += 1
  }

  const activeLocalGameId =
    payload.activeLocalGameId && gameIds.includes(payload.activeLocalGameId)
      ? payload.activeLocalGameId
      : manifest.activeLocalGameId
  writeManifest({
    ...manifest,
    ownerId,
    activeLocalGameId,
    gameIds,
    summaries,
  })

  const activeRecord = activeLocalGameId ? readRecord(activeLocalGameId) : null
  if (activeRecord) {
    writeLegacyMirror(activeRecord.gameState, ownerId)
  }

  return {
    imported,
    skipped,
    summaries: listParkedGames(ownerId),
  }
}

export function parkedGameStorageErrorMessage(error: unknown): string {
  if (error instanceof ParkedGameStorageError) return error.message
  return 'Parked games could not be saved on this device.'
}
