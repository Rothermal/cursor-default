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

function writeManifest(manifest: ParkedGamesManifest): void {
  localStorage.setItem(GAMES_MANIFEST_KEY, JSON.stringify(manifest))
}

function readRecord(localGameId: string): ParkedGameRecord | null {
  try {
    const raw = localStorage.getItem(gameRecordKey(localGameId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ParkedGameRecord
    if (!parsed || parsed.localGameId !== localGameId || !parsed.gameState) return null
    return {
      ...parsed,
      sync: normalizeSyncState(parsed.sync, null, parsed.gameState),
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
  updatedAt: string
): ParkedGameSummary {
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
    syncStatus: state.cloudSync.status,
  }
}

function writeLegacyMirror(state: GameState, ownerId: string | null): void {
  localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(state))
  if (ownerId) {
    localStorage.setItem(GAME_OWNER_KEY, ownerId)
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
    const summary = buildSummary(localGameId, gameState, updatedAt)
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
      sync: buildSyncState(null, gameState),
    }

    localStorage.setItem(gameRecordKey(localGameId), JSON.stringify(record))
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
    .map(id => manifest.summaries[id])
    .filter((summary): summary is ParkedGameSummary => Boolean(summary))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
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

  const localGameId = manifest.activeLocalGameId ?? createLocalGameId()
  const existing = readRecord(localGameId)
  const updatedAt = nowIso()
  const summary = buildSummary(localGameId, state, updatedAt)
  const record: ParkedGameRecord = {
    localGameId,
    ownerId,
    createdAt: existing?.createdAt ?? updatedAt,
    updatedAt,
    gameState: state,
    summary,
    sync: buildSyncState(existing, state),
  }

  localStorage.setItem(gameRecordKey(localGameId), JSON.stringify(record))
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
  const createdAt = existing?.createdAt ?? nowIso()
  const updatedAt = nowIso()
  const summary = buildSummary(localGameId, state, updatedAt)
  const sync = buildSyncState(existing, state, syncPatch)
  const record: ParkedGameRecord = {
    localGameId,
    ownerId,
    createdAt,
    updatedAt,
    gameState: state,
    summary,
    sync,
  }
  localStorage.setItem(gameRecordKey(localGameId), JSON.stringify(record))

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
