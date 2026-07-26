import type {
  SportSettingsCacheRecord,
  SportSettingsCacheScope,
} from '../sportSettingsStorage'
import type { SportSettingsCloudRecord } from '../sportSettingsCloud'
import {
  DEFAULT_SOCCER_PERSONAL_SETTINGS,
  SOCCER_SETTINGS_SCHEMA_VERSION,
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
  if (!record || record.schemaVersion !== SOCCER_SETTINGS_SCHEMA_VERSION) return null
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
    const parsedCloud = cloudRecord.schemaVersion === SOCCER_SETTINGS_SCHEMA_VERSION
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

  return {
    action: 'upload_local',
    settings: localRecord?.settings ?? structuredClone(bootstrapSettings),
    expectedRevision: null,
  }
}

export function createSoccerSettingsCacheRecord(
  settings: SoccerPersonalSettings,
  options: {
    revision: number | null
    pendingBaseRevision: number | null | undefined
    cloudUpdatedAt: string | null
    now?: string
  }
): SportSettingsCacheRecord<SoccerPersonalSettings> {
  const now = options.now ?? new Date().toISOString()
  return {
    version: 1,
    sportId: 'soccer',
    schemaVersion: SOCCER_SETTINGS_SCHEMA_VERSION,
    revision: options.revision,
    settings: structuredClone(settings),
    pending: options.pendingBaseRevision === undefined
      ? null
      : { baseRevision: options.pendingBaseRevision, savedAt: now },
    cloudUpdatedAt: options.cloudUpdatedAt,
    cachedAt: now,
  }
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
    pendingBaseRevision: undefined,
    cloudUpdatedAt: cloudRecord.updatedAt,
    now,
  })
}
