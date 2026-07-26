import type { SportSettingsCloudRecord } from '../sportSettingsCloud'
import type {
  SportSettingsCacheRecord,
  SportSettingsCacheScope,
} from '../sportSettingsStorage'
import {
  SOCCER_SETTINGS_SCHEMA_VERSION,
  parseSoccerTeamSettings,
  type SoccerTeamSettings,
} from './settings'

export const EMPTY_SOCCER_TEAM_SETTINGS: SoccerTeamSettings = { rules: {} }

export function soccerTeamSettingsCacheScope(
  userId: string,
  teamId: string
): SportSettingsCacheScope {
  return { kind: 'team', userId, teamId }
}

export function validSoccerTeamSettingsCache(
  record: SportSettingsCacheRecord | null
): SportSettingsCacheRecord<SoccerTeamSettings> | null {
  if (!record || record.schemaVersion !== SOCCER_SETTINGS_SCHEMA_VERSION) return null
  const parsed = parseSoccerTeamSettings(record.settings)
  return parsed.ok ? { ...record, settings: parsed.value } : null
}

export function parseCloudSoccerTeamSettings(
  record: SportSettingsCloudRecord
): SportSettingsCloudRecord<SoccerTeamSettings> | null {
  if (record.schemaVersion !== SOCCER_SETTINGS_SCHEMA_VERSION) return null
  const parsed = parseSoccerTeamSettings(record.settings)
  return parsed.ok ? { ...record, settings: parsed.value } : null
}

export function createSoccerTeamSettingsCacheRecord(
  settings: SoccerTeamSettings,
  options: {
    revision: number | null
    cloudUpdatedAt: string | null
    now?: string
  }
): SportSettingsCacheRecord<SoccerTeamSettings> {
  const now = options.now ?? new Date().toISOString()
  return {
    version: 1,
    sportId: 'soccer',
    schemaVersion: SOCCER_SETTINGS_SCHEMA_VERSION,
    revision: options.revision,
    settings: structuredClone(settings),
    pending: null,
    cloudUpdatedAt: options.cloudUpdatedAt,
    cachedAt: now,
  }
}
