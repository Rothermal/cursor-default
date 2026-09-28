import type { SportSettingsCloudRecord, SportSettingsCloudWriteResult } from './sportSettingsCloud'
import type { SportSettingsCacheRecord } from './sportSettingsStorage'

/**
 * What a sport supplies so the shared team-settings hook can load, cache and save its
 * `team_sport_settings` row. Parsing stays sport-owned and exact.
 */
export interface SportTeamSettingsAdapter<TSettings> {
  sportId: string
  /** Shown in status messages, e.g. "Shared Baseball defaults ...". */
  label: string
  schemaVersion: (settings: TSettings) => number
  defaults: () => TSettings
  parse: (value: unknown) => { ok: true; value: TSettings } | { ok: false; error: string }
  parseCloud: (record: SportSettingsCloudRecord) => SportSettingsCloudRecord<TSettings> | null
  validCache: (record: SportSettingsCacheRecord | null) => SportSettingsCacheRecord<TSettings> | null
  save: (
    teamId: string,
    expectedRevision: number | null,
    settings: TSettings
  ) => Promise<SportSettingsCloudWriteResult<TSettings>>
}

export function createSportTeamSettingsCacheRecord<TSettings>(
  adapter: SportTeamSettingsAdapter<TSettings>,
  settings: TSettings,
  options: { revision: number | null; cloudUpdatedAt: string | null; now?: string }
): SportSettingsCacheRecord<TSettings> {
  const now = options.now ?? new Date().toISOString()
  return {
    version: 1,
    sportId: adapter.sportId,
    schemaVersion: adapter.schemaVersion(settings),
    revision: options.revision,
    settings: structuredClone(settings),
    pending: null,
    cloudUpdatedAt: options.cloudUpdatedAt,
    cachedAt: now,
  }
}
