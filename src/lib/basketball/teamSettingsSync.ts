import { stableJson } from '../gameEvents/stream'
import type { SportSettingsCloudRecord } from '../sportSettingsCloud'
import type {
  SportSettingsCacheRecord,
  SportSettingsCacheScope,
} from '../sportSettingsStorage'
import {
  BASKETBALL_SETTINGS_SCHEMA_VERSION,
  DEFAULT_BASKETBALL_TEAM_SETTINGS,
  parseBasketballTeamSettings,
  type BasketballTeamSettingsV1,
} from './settings'

export function basketballTeamSettingsCacheScope(
  userId: string,
  teamId: string
): SportSettingsCacheScope {
  return { kind: 'team', userId, teamId }
}

export function validBasketballTeamSettingsCache(
  record: SportSettingsCacheRecord | null
): SportSettingsCacheRecord<BasketballTeamSettingsV1> | null {
  if (
    !record ||
    record.sportId !== 'basketball' ||
    record.schemaVersion !== BASKETBALL_SETTINGS_SCHEMA_VERSION
  ) return null
  const parsed = parseBasketballTeamSettings(record.settings)
  return parsed.ok ? { ...record, settings: parsed.value } : null
}

export function parseCloudBasketballTeamSettings(
  record: SportSettingsCloudRecord
): SportSettingsCloudRecord<BasketballTeamSettingsV1> | null {
  if (
    record.sportId !== 'basketball' ||
    record.schemaVersion !== BASKETBALL_SETTINGS_SCHEMA_VERSION
  ) return null
  const parsed = parseBasketballTeamSettings(record.settings)
  return parsed.ok ? { ...record, settings: parsed.value } : null
}

export function createBasketballTeamSettingsCacheRecord(
  settings: BasketballTeamSettingsV1,
  options: {
    revision: number | null
    cloudUpdatedAt: string | null
    now?: string
  }
): SportSettingsCacheRecord<BasketballTeamSettingsV1> {
  const now = options.now ?? new Date().toISOString()
  return {
    version: 1,
    sportId: 'basketball',
    schemaVersion: BASKETBALL_SETTINGS_SCHEMA_VERSION,
    revision: options.revision,
    settings: structuredClone(settings),
    pending: null,
    cloudUpdatedAt: options.cloudUpdatedAt,
    cachedAt: now,
  }
}

export function defaultBasketballTeamSettings(): BasketballTeamSettingsV1 {
  return structuredClone(DEFAULT_BASKETBALL_TEAM_SETTINGS)
}

export function basketballTeamSettingsFingerprint(
  settings: BasketballTeamSettingsV1
): string {
  return stableJson(settings)
}
