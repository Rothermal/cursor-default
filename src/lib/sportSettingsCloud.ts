import { isPlainObject } from './gameEvents/envelope'

export type SportSettingsCloudScope = 'user' | 'team'
export type SportSettingsSaveStatus = 'applied' | 'conflict'

export interface SportSettingsCloudRecord<TSettings = unknown> {
  sportId: string
  schemaVersion: number
  revision: number
  settings: TSettings
  updatedAt: string
  updatedBy: string | null
}

export interface SportSettingsSaveResult<TSettings = unknown> {
  status: SportSettingsSaveStatus
  record: SportSettingsCloudRecord<TSettings> | null
}

interface SupabaseLikeError {
  code?: string
  message?: string
  details?: string
  hint?: string
}

export function parseSportSettingsSaveResult<TSettings = unknown>(
  value: unknown
): SportSettingsSaveResult<TSettings> | null {
  if (!isPlainObject(value)) return null
  if (value.status !== 'applied' && value.status !== 'conflict') return null
  if (value.record === null) {
    return value.status === 'conflict'
      ? { status: value.status, record: null }
      : null
  }

  const record = parseSportSettingsCloudRecord<TSettings>(value.record)
  return record ? { status: value.status, record } : null
}

export function parseSportSettingsCloudRecord<TSettings = unknown>(
  value: unknown
): SportSettingsCloudRecord<TSettings> | null {
  if (!isPlainObject(value)) return null
  if (
    typeof value.sportId !== 'string' ||
    !/^[a-z][a-z0-9_]{1,39}$/.test(value.sportId)
  ) return null
  if (!isPositiveInteger(value.schemaVersion)) return null
  if (!isPositiveInteger(value.revision)) return null
  if (!Object.prototype.hasOwnProperty.call(value, 'settings')) return null
  if (typeof value.updatedAt !== 'string' || !value.updatedAt) return null
  if (value.updatedBy !== null && typeof value.updatedBy !== 'string') return null

  return {
    sportId: value.sportId,
    schemaVersion: value.schemaVersion,
    revision: value.revision,
    settings: structuredClone(value.settings) as TSettings,
    updatedAt: value.updatedAt,
    updatedBy: value.updatedBy,
  }
}

export function isSportSettingsBackendUpdateRequired(
  error: SupabaseLikeError | null
): boolean {
  if (!error) return false
  const combined = [
    error.message,
    error.details,
    error.hint,
  ].filter(Boolean).join(' ').toLowerCase()
  return (
    error.code === '42P01' ||
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    error.code === 'PGRST205' ||
    combined.includes('schema cache') ||
    combined.includes('could not find the table') ||
    combined.includes('could not find the function') ||
    (
      combined.includes('does not exist') &&
      (
        combined.includes('user_sport_settings') ||
        combined.includes('team_sport_settings') ||
        combined.includes('save_user_sport_settings_revisioned') ||
        combined.includes('save_team_sport_settings_revisioned')
      )
    )
  )
}

export function sportSettingsBackendMessage(scope: SportSettingsCloudScope): string {
  return scope === 'user'
    ? 'Cloud sport settings require the latest backend update. Local settings remain available.'
    : 'Shared team settings require the latest backend update.'
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}
