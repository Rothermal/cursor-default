import type { SportSettingsCloudRecord } from '../sportSettingsCloud'
import type {
  SportSettingsCacheRecord,
  SportSettingsCacheScope,
} from '../sportSettingsStorage'
import {
  SOCCER_LEGACY_TEAM_SETTINGS_SCHEMA_VERSION,
  SOCCER_TEAM_SETTINGS_SCHEMA_VERSION,
  parseSoccerTeamSettings,
  type SoccerTeamSettings,
} from './settings'

export const EMPTY_SOCCER_TEAM_SETTINGS: SoccerTeamSettings = {
  rules: {},
  formation: null,
}

export function soccerTeamSettingsCacheScope(
  userId: string,
  teamId: string
): SportSettingsCacheScope {
  return { kind: 'team', userId, teamId }
}

export function validSoccerTeamSettingsCache(
  record: SportSettingsCacheRecord | null
): SportSettingsCacheRecord<SoccerTeamSettings> | null {
  if (!record || !isSupportedTeamSchema(record.schemaVersion)) return null
  const parsed = parseSoccerTeamSettings(record.settings, record.schemaVersion)
  return parsed.ok ? { ...record, settings: parsed.value } : null
}

export function parseCloudSoccerTeamSettings(
  record: SportSettingsCloudRecord
): SportSettingsCloudRecord<SoccerTeamSettings> | null {
  if (!isSupportedTeamSchema(record.schemaVersion)) return null
  const parsed = parseSoccerTeamSettings(record.settings, record.schemaVersion)
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
    schemaVersion: SOCCER_TEAM_SETTINGS_SCHEMA_VERSION,
    revision: options.revision,
    settings: structuredClone(settings),
    pending: null,
    cloudUpdatedAt: options.cloudUpdatedAt,
    cachedAt: now,
  }
}

function isSupportedTeamSchema(schemaVersion: number): boolean {
  return schemaVersion === SOCCER_LEGACY_TEAM_SETTINGS_SCHEMA_VERSION ||
    schemaVersion === SOCCER_TEAM_SETTINGS_SCHEMA_VERSION
}
