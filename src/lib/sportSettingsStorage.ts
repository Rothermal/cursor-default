import { isPlainObject } from './gameEvents/envelope'

export const SPORT_SETTINGS_CACHE_KEY_PREFIX = 'statkeeper_sport_settings:'
export const SPORT_SETTINGS_CACHE_VERSION = 1

export type SportSettingsCacheScope =
  | { kind: 'anonymous' }
  | { kind: 'user'; userId: string }

export interface SportSettingsPendingWrite {
  baseRevision: number | null
  savedAt: string
}

export interface SportSettingsCacheRecord<TSettings = unknown> {
  version: typeof SPORT_SETTINGS_CACHE_VERSION
  sportId: string
  schemaVersion: number
  revision: number | null
  settings: TSettings
  pending: SportSettingsPendingWrite | null
  cloudUpdatedAt: string | null
  cachedAt: string
}

export function sportSettingsCacheKey(
  scope: SportSettingsCacheScope,
  sportId: string
): string {
  const normalizedSportId = requiredIdentity(sportId, 'Sport id')
  const scopeKey = scope.kind === 'anonymous'
    ? 'anonymous'
    : `user:${encodeURIComponent(requiredIdentity(scope.userId, 'User id'))}`
  return `${SPORT_SETTINGS_CACHE_KEY_PREFIX}${scopeKey}:${encodeURIComponent(normalizedSportId)}`
}

export function loadSportSettingsCache<TSettings = unknown>(
  scope: SportSettingsCacheScope,
  sportId: string,
  storage: Pick<Storage, 'getItem'> = localStorage
): SportSettingsCacheRecord<TSettings> | null {
  try {
    const saved = storage.getItem(sportSettingsCacheKey(scope, sportId))
    if (!saved) return null
    return parseSportSettingsCacheRecord<TSettings>(JSON.parse(saved), sportId)
  } catch {
    return null
  }
}

export function saveSportSettingsCache<TSettings>(
  scope: SportSettingsCacheScope,
  record: SportSettingsCacheRecord<TSettings>,
  storage: Pick<Storage, 'setItem'> = localStorage
): void {
  const parsed = parseSportSettingsCacheRecord<TSettings>(record, record.sportId)
  if (!parsed) throw new Error('Sport settings cache record is invalid.')
  storage.setItem(
    sportSettingsCacheKey(scope, record.sportId),
    JSON.stringify(parsed)
  )
}

export function parseSportSettingsCacheRecord<TSettings = unknown>(
  value: unknown,
  expectedSportId?: string
): SportSettingsCacheRecord<TSettings> | null {
  if (!isPlainObject(value)) return null
  if (value.version !== SPORT_SETTINGS_CACHE_VERSION) return null
  if (!isSportId(value.sportId)) return null
  if (expectedSportId !== undefined && value.sportId !== expectedSportId) return null
  if (!isPositiveInteger(value.schemaVersion)) return null
  if (value.revision !== null && !isPositiveInteger(value.revision)) return null
  if (!Object.prototype.hasOwnProperty.call(value, 'settings')) return null
  if (value.cloudUpdatedAt !== null && typeof value.cloudUpdatedAt !== 'string') return null
  if (typeof value.cachedAt !== 'string' || !value.cachedAt) return null

  const pending = parsePendingWrite(value.pending)
  if (value.pending !== null && !pending) return null

  return {
    version: SPORT_SETTINGS_CACHE_VERSION,
    sportId: value.sportId,
    schemaVersion: value.schemaVersion,
    revision: value.revision,
    settings: structuredClone(value.settings) as TSettings,
    pending,
    cloudUpdatedAt: value.cloudUpdatedAt,
    cachedAt: value.cachedAt,
  }
}

function parsePendingWrite(value: unknown): SportSettingsPendingWrite | null {
  if (value === null) return null
  if (!isPlainObject(value)) return null
  if (value.baseRevision !== null && !isPositiveInteger(value.baseRevision)) return null
  if (typeof value.savedAt !== 'string' || !value.savedAt) return null
  return {
    baseRevision: value.baseRevision,
    savedAt: value.savedAt,
  }
}

function requiredIdentity(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} is required.`)
  return normalized
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}

function isSportId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{1,39}$/.test(value)
}
