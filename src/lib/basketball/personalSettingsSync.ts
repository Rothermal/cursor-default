import type {
  SportSettingsCacheRecord,
  SportSettingsCacheScope,
} from '../sportSettingsStorage'
import type { SportSettingsCloudRecord } from '../sportSettingsCloud'
import { stableJson } from '../gameEvents/stream'
import {
  BASKETBALL_SETTINGS_SCHEMA_VERSION,
  DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
  parseBasketballPersonalSettings,
  type BasketballPersonalSettingsV1,
} from './settings'

export type BasketballPersonalSettingsReconciliation =
  | {
      action: 'use_cloud'
      settings: BasketballPersonalSettingsV1
      record: SportSettingsCacheRecord<BasketballPersonalSettingsV1>
    }
  | {
      action: 'upload_local'
      settings: BasketballPersonalSettingsV1
      expectedRevision: number | null
    }
  | {
      action: 'conflict'
      local: BasketballPersonalSettingsV1
      cloud: BasketballPersonalSettingsV1
      cloudRecord: SportSettingsCloudRecord<BasketballPersonalSettingsV1>
    }
  | {
      action: 'invalid_cloud'
      settings: BasketballPersonalSettingsV1
      revision: number
      error: string
    }

export function basketballSettingsBootstrap(
  reboundPromptAfterMiss: boolean
): BasketballPersonalSettingsV1 {
  return {
    ...structuredClone(DEFAULT_BASKETBALL_PERSONAL_SETTINGS),
    capture: { reboundPromptAfterMiss },
  }
}

export function validBasketballSettingsCache(
  record: SportSettingsCacheRecord | null
): SportSettingsCacheRecord<BasketballPersonalSettingsV1> | null {
  if (
    !record ||
    record.sportId !== 'basketball' ||
    record.schemaVersion !== BASKETBALL_SETTINGS_SCHEMA_VERSION
  ) return null
  const parsed = parseBasketballPersonalSettings(record.settings)
  return parsed.ok ? { ...record, settings: parsed.value } : null
}

export function reconcileBasketballPersonalSettings(
  localRecord: SportSettingsCacheRecord<BasketballPersonalSettingsV1> | null,
  cloudRecord: SportSettingsCloudRecord | null,
  bootstrapSettings: BasketballPersonalSettingsV1,
  now = new Date().toISOString()
): BasketballPersonalSettingsReconciliation {
  if (cloudRecord) {
    const parsedCloud = cloudRecord.schemaVersion === BASKETBALL_SETTINGS_SCHEMA_VERSION
      ? parseBasketballPersonalSettings(cloudRecord.settings)
      : { ok: false as const, error: 'Cloud Basketball settings use an unsupported schema.' }

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
      cloudRecord: { ...cloudRecord, settings: parsedCloud.value },
    }
  }

  return {
    action: 'upload_local',
    settings: localRecord?.settings ?? structuredClone(bootstrapSettings),
    expectedRevision: null,
  }
}

export function createBasketballSettingsCacheRecord(
  settings: BasketballPersonalSettingsV1,
  options: {
    revision: number | null
    pending: { baseRevision: number | null } | null
    cloudUpdatedAt: string | null
    now?: string
  }
): SportSettingsCacheRecord<BasketballPersonalSettingsV1> {
  const now = options.now ?? new Date().toISOString()
  return {
    version: 1,
    sportId: 'basketball',
    schemaVersion: BASKETBALL_SETTINGS_SCHEMA_VERSION,
    revision: options.revision,
    settings: structuredClone(settings),
    pending: options.pending
      ? { baseRevision: options.pending.baseRevision, savedAt: now }
      : null,
    cloudUpdatedAt: options.cloudUpdatedAt,
    cachedAt: now,
  }
}

export function basketballSettingsFingerprint(
  settings: BasketballPersonalSettingsV1
): string {
  return stableJson(settings)
}

export function basketballSettingsCacheScope(
  userId: string | null
): SportSettingsCacheScope {
  return userId ? { kind: 'user', userId } : { kind: 'anonymous' }
}

function cloudRecordToCache(
  cloudRecord: SportSettingsCloudRecord,
  settings: BasketballPersonalSettingsV1,
  now: string
): SportSettingsCacheRecord<BasketballPersonalSettingsV1> {
  return createBasketballSettingsCacheRecord(settings, {
    revision: cloudRecord.revision,
    pending: null,
    cloudUpdatedAt: cloudRecord.updatedAt,
    now,
  })
}
