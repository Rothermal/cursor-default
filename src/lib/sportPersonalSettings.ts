import type { SportSettingsCloudRecord, SportSettingsCloudWriteResult } from './sportSettingsCloud'
import type { SportSettingsCacheRecord, SportSettingsCacheScope } from './sportSettingsStorage'

/**
 * What a sport supplies so the shared personal-settings hook can cache, reconcile and save
 * its `user_sport_settings` row (Basketball's flow, sport neutral since HKY-5C). Parsing
 * stays sport-owned and exact.
 */
export interface SportPersonalSettingsAdapter<TSettings> {
  sportId: string
  /** Shown in status messages, e.g. "Cloud Hockey settings ...". */
  label: string
  schemaVersion: number
  defaults: () => TSettings
  parse: (value: unknown) => { ok: true; value: TSettings } | { ok: false; error: string }
  save: (
    expectedRevision: number | null,
    settings: TSettings
  ) => Promise<SportSettingsCloudWriteResult<TSettings>>
}

export type SportPersonalSettingsReconciliation<TSettings> =
  | { action: 'use_cloud'; settings: TSettings; record: SportSettingsCacheRecord<TSettings> }
  | { action: 'upload_local'; settings: TSettings; expectedRevision: number | null }
  | {
      action: 'conflict'
      local: TSettings
      cloud: TSettings
      cloudRecord: SportSettingsCloudRecord<TSettings>
    }
  | { action: 'invalid_cloud'; settings: TSettings; revision: number; error: string }
  | { action: 'use_defaults'; settings: TSettings }

export function sportPersonalSettingsCacheScope(userId: string | null): SportSettingsCacheScope {
  return userId ? { kind: 'user', userId } : { kind: 'anonymous' }
}

export function validSportPersonalSettingsCache<TSettings>(
  adapter: SportPersonalSettingsAdapter<TSettings>,
  record: SportSettingsCacheRecord | null
): SportSettingsCacheRecord<TSettings> | null {
  if (!record || record.sportId !== adapter.sportId || record.schemaVersion !== adapter.schemaVersion) return null
  const parsed = adapter.parse(record.settings)
  return parsed.ok ? { ...record, settings: parsed.value } : null
}

export function parseSportPersonalCloudRecord<TSettings>(
  adapter: SportPersonalSettingsAdapter<TSettings>,
  record: SportSettingsCloudRecord
): SportSettingsCloudRecord<TSettings> | null {
  if (record.sportId !== adapter.sportId || record.schemaVersion !== adapter.schemaVersion) return null
  const parsed = adapter.parse(record.settings)
  return parsed.ok ? { ...record, settings: parsed.value } : null
}

export function createSportPersonalSettingsCacheRecord<TSettings>(
  adapter: SportPersonalSettingsAdapter<TSettings>,
  settings: TSettings,
  options: {
    revision: number | null
    pending: { baseRevision: number | null } | null
    cloudUpdatedAt: string | null
    now?: string
  }
): SportSettingsCacheRecord<TSettings> {
  const now = options.now ?? new Date().toISOString()
  return {
    version: 1,
    sportId: adapter.sportId,
    schemaVersion: adapter.schemaVersion,
    revision: options.revision,
    settings: structuredClone(settings),
    pending: options.pending ? { baseRevision: options.pending.baseRevision, savedAt: now } : null,
    cloudUpdatedAt: options.cloudUpdatedAt,
    cachedAt: now,
  }
}

/**
 * Same decisions as `reconcileBasketballPersonalSettings`: an unsent device edit uploads
 * when the cloud is still at its base revision, conflicts otherwise; with no pending edit
 * the cloud wins; with no cloud row a device copy uploads. Unlike Basketball, defaults
 * alone are never uploaded, so opening a page does not create a row.
 */
export function reconcileSportPersonalSettings<TSettings>(
  adapter: SportPersonalSettingsAdapter<TSettings>,
  localRecord: SportSettingsCacheRecord<TSettings> | null,
  cloudRecord: SportSettingsCloudRecord | null,
  bootstrapSettings: TSettings,
  now = new Date().toISOString()
): SportPersonalSettingsReconciliation<TSettings> {
  if (cloudRecord) {
    const parsedCloud = cloudRecord.schemaVersion === adapter.schemaVersion
      ? adapter.parse(cloudRecord.settings)
      : { ok: false as const, error: `Cloud ${adapter.label} settings use an unsupported schema.` }
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
        record: createSportPersonalSettingsCacheRecord(adapter, parsedCloud.value, {
          revision: cloudRecord.revision,
          pending: null,
          cloudUpdatedAt: cloudRecord.updatedAt,
          now,
        }),
      }
    }
    if (localRecord.pending.baseRevision === cloudRecord.revision) {
      return { action: 'upload_local', settings: localRecord.settings, expectedRevision: cloudRecord.revision }
    }
    return {
      action: 'conflict',
      local: localRecord.settings,
      cloud: parsedCloud.value,
      cloudRecord: { ...cloudRecord, settings: parsedCloud.value },
    }
  }
  if (!localRecord) return { action: 'use_defaults', settings: structuredClone(bootstrapSettings) }
  return { action: 'upload_local', settings: localRecord.settings, expectedRevision: null }
}

/**
 * A save made from an older revision than the one now shown (another device's change arrived
 * through focus, online or Refresh after the draft was taken) is a conflict for the recorder
 * to resolve with Use Cloud or Keep This Device, never a silent overwrite.
 */
export function staleSportPersonalSave<TSettings>(
  device: TSettings,
  expectedRevision: number | null,
  current: { settings: TSettings; revision: number | null; lastSyncedAt: string | null },
  now = new Date().toISOString()
): { device: TSettings; cloud: TSettings; cloudRevision: number | null; cloudUpdatedAt: string } | null {
  if (expectedRevision === current.revision) return null
  return {
    device,
    cloud: structuredClone(current.settings),
    cloudRevision: current.revision,
    cloudUpdatedAt: current.lastSyncedAt ?? now,
  }
}
