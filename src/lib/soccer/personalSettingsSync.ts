import type {
  SportSettingsCacheRecord,
  SportSettingsCacheScope,
} from '../sportSettingsStorage'
import type { SportSettingsCloudRecord } from '../sportSettingsCloud'
import { stableJson } from '../gameEvents/stream'
import {
  DEFAULT_SOCCER_PERSONAL_SETTINGS,
  SOCCER_PERSONAL_SETTINGS_SCHEMA_VERSION,
  parseSoccerPersonalSettings,
  type SoccerPersonalSettings,
} from './settings'

export type SoccerPersonalSettingsReconciliation =
  | {
      action: 'use_cloud'
      settings: SoccerPersonalSettings
      record: SportSettingsCacheRecord<SoccerPersonalSettings>
    }
  | {
      action: 'upload_local'
      settings: SoccerPersonalSettings
      expectedRevision: number | null
    }
  | {
      action: 'use_local'
      settings: SoccerPersonalSettings
    }
  | {
      action: 'conflict'
      local: SoccerPersonalSettings
      cloud: SoccerPersonalSettings
      cloudRecord: SportSettingsCloudRecord<SoccerPersonalSettings>
    }
  | {
      action: 'invalid_cloud'
      settings: SoccerPersonalSettings
      revision: number
      error: string
    }

export function validSoccerSettingsCache(
  record: SportSettingsCacheRecord | null
): SportSettingsCacheRecord<SoccerPersonalSettings> | null {
  if (!record || record.schemaVersion !== SOCCER_PERSONAL_SETTINGS_SCHEMA_VERSION) return null
  const parsed = parseSoccerPersonalSettings(record.settings)
  return parsed.ok ? { ...record, settings: parsed.value } : null
}

export function reconcileSoccerPersonalSettings(
  localRecord: SportSettingsCacheRecord<SoccerPersonalSettings> | null,
  cloudRecord: SportSettingsCloudRecord | null,
  bootstrapSettings: SoccerPersonalSettings = DEFAULT_SOCCER_PERSONAL_SETTINGS,
  now = new Date().toISOString()
): SoccerPersonalSettingsReconciliation {
  if (cloudRecord) {
    const parsedCloud = cloudRecord.schemaVersion === SOCCER_PERSONAL_SETTINGS_SCHEMA_VERSION
      ? parseSoccerPersonalSettings(cloudRecord.settings)
      : { ok: false as const, error: 'Cloud soccer settings use an unsupported schema.' }

    if (!parsedCloud.ok) {
      return {
        action: 'invalid_cloud',
        settings: localRecord?.settings ?? structuredClone(bootstrapSettings),
        revision: cloudRecord.revision,
        error: parsedCloud.error,
      }
    }

    if (!localRecord?.pending) {
      return {
        action: 'use_cloud',
        settings: parsedCloud.value,
        record: cloudRecordToCache(cloudRecord, parsedCloud.value, now),
      }
    }

    if (localRecord.pending.baseRevision === cloudRecord.revision) {
      return {
        action: 'upload_local',
        settings: localRecord.settings,
        expectedRevision: cloudRecord.revision,
      }
    }

    return {
      action: 'conflict',
      local: localRecord.settings,
      cloud: parsedCloud.value,
      cloudRecord: {
        ...cloudRecord,
        settings: parsedCloud.value,
      },
    }
  }

  return localRecord
    ? {
        action: 'upload_local',
        settings: localRecord.settings,
        expectedRevision: null,
      }
    : {
        action: 'use_local',
        settings: structuredClone(bootstrapSettings),
      }
}

export function createSoccerSettingsCacheRecord(
  settings: SoccerPersonalSettings,
  options: {
    revision: number | null
    pending: { baseRevision: number | null } | null
    cloudUpdatedAt: string | null
    now?: string
  }
): SportSettingsCacheRecord<SoccerPersonalSettings> {
  const now = options.now ?? new Date().toISOString()
  return {
    version: 1,
    sportId: 'soccer',
    schemaVersion: SOCCER_PERSONAL_SETTINGS_SCHEMA_VERSION,
    revision: options.revision,
    settings: structuredClone(settings),
    pending: options.pending
      ? { baseRevision: options.pending.baseRevision, savedAt: now }
      : null,
    cloudUpdatedAt: options.cloudUpdatedAt,
    cachedAt: now,
  }
}

export function soccerSettingsFingerprint(settings: SoccerPersonalSettings): string {
  return stableJson(settings)
}

export function soccerSettingsCacheScope(
  userId: string | null
): SportSettingsCacheScope {
  return userId ? { kind: 'user', userId } : { kind: 'anonymous' }
}

function cloudRecordToCache(
  cloudRecord: SportSettingsCloudRecord,
  settings: SoccerPersonalSettings,
  now: string
): SportSettingsCacheRecord<SoccerPersonalSettings> {
  return createSoccerSettingsCacheRecord(settings, {
    revision: cloudRecord.revision,
    pending: null,
    cloudUpdatedAt: cloudRecord.updatedAt,
    now,
  })
}
