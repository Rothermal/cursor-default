import type { CloudSyncStatus, GameState } from '../types'
import {
  GAME_OWNER_KEY,
  GAME_RECORD_KEY_PREFIX,
  GAME_STORAGE_KEY,
  GAMES_MANIFEST_KEY,
  PENDING_SYNC_KEY,
} from './gameStorageKeys'

const MANIFEST_VERSION = 1

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
    return parsed
  } catch {
    return null
  }
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
