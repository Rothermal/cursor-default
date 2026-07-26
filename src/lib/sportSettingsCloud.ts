import { supabase } from './supabase'
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

export interface SupabaseLikeError {
  code?: string
  message?: string
  details?: string
  hint?: string
}

export type SportSettingsCloudLoadResult<TSettings = unknown> =
  | { status: 'loaded'; record: SportSettingsCloudRecord<TSettings> }
  | { status: 'missing' }
  | { status: 'backend_update_required'; error: string }
  | { status: 'error'; error: string }
  | { status: 'not_configured' }

export type SportSettingsCloudWriteResult<TSettings = unknown> =
  | SportSettingsSaveResult<TSettings>
  | { status: 'backend_update_required'; error: string }
  | { status: 'error'; error: string }
  | { status: 'not_configured' }

interface SportSettingsQueryResult {
  data: unknown
  error: SupabaseLikeError | null
}

export interface SportSettingsCloudClient {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<SportSettingsQueryResult>
      }
    }
  }
  rpc: (
    functionName: string,
    args: Record<string, unknown>
  ) => Promise<SportSettingsQueryResult>
}

export async function loadUserSportSettings<TSettings = unknown>(
  sportId: string,
  client: SportSettingsCloudClient | null =
    supabase as unknown as SportSettingsCloudClient | null
): Promise<SportSettingsCloudLoadResult<TSettings>> {
  if (!client) return { status: 'not_configured' }

  const { data, error } = await client
    .from('user_sport_settings')
    .select('sport_id,schema_version,revision,settings,updated_at')
    .eq('sport_id', sportId)
    .maybeSingle()

  if (error) return cloudFailure(error, 'user')
  if (data === null) return { status: 'missing' }

  const record = parseSportSettingsTableRecord<TSettings>(data)
  return record
    ? { status: 'loaded', record }
    : { status: 'error', error: 'Cloud sport settings returned an invalid record.' }
}

export async function saveUserSportSettings<TSettings>(
  sportId: string,
  schemaVersion: number,
  expectedRevision: number | null,
  settings: TSettings,
  client: SportSettingsCloudClient | null =
    supabase as unknown as SportSettingsCloudClient | null
): Promise<SportSettingsCloudWriteResult<TSettings>> {
  if (!client) return { status: 'not_configured' }

  const { data, error } = await client.rpc(
    'save_user_sport_settings_revisioned',
    {
      p_sport_id: sportId,
      p_schema_version: schemaVersion,
      p_expected_revision: expectedRevision,
      p_settings: settings,
    }
  )
  if (error) return cloudFailure(error, 'user')

  const result = parseSportSettingsSaveResult<TSettings>(data)
  return result ?? {
    status: 'error',
    error: 'Cloud sport settings returned an invalid save result.',
  }
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

export function parseSportSettingsTableRecord<TSettings = unknown>(
  value: unknown
): SportSettingsCloudRecord<TSettings> | null {
  if (!isPlainObject(value)) return null
  return parseSportSettingsCloudRecord<TSettings>({
    sportId: value.sport_id,
    schemaVersion: value.schema_version,
    revision: value.revision,
    settings: value.settings,
    updatedAt: value.updated_at,
    updatedBy: value.updated_by ?? null,
  })
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

function cloudFailure(
  error: SupabaseLikeError,
  scope: SportSettingsCloudScope
): { status: 'backend_update_required' | 'error'; error: string } {
  if (isSportSettingsBackendUpdateRequired(error)) {
    return {
      status: 'backend_update_required',
      error: sportSettingsBackendMessage(scope),
    }
  }
  return {
    status: 'error',
    error: error.message || 'Cloud sport settings could not be reached.',
  }
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}
