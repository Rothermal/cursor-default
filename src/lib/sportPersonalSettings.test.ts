import { describe, expect, it } from 'vitest'
import { defaultHockeySettings } from './hockey/settings'
import { hockeyPersonalSettingsAdapter as adapter } from './hockey/settingsSync'
import type { HockeySettingsV1 } from './hockey/types'
import {
  createSportPersonalSettingsCacheRecord,
  parseSportPersonalCloudRecord,
  reconcileSportPersonalSettings,
  sportPersonalSettingsCacheScope,
  validSportPersonalSettingsCache,
} from './sportPersonalSettings'
import type { SportSettingsCloudRecord } from './sportSettingsCloud'

const NOW = '2026-10-05T00:00:00.000Z'
const ncaa: HockeySettingsV1 = { settingsSchemaVersion: 1, baseProfile: { profileId: 'ncaa', profileVersion: 1 }, ruleOverrides: {} }
const cloud = (settings: unknown, revision = 3, schemaVersion = 1): SportSettingsCloudRecord => ({
  sportId: 'hockey', schemaVersion, revision, settings, updatedAt: NOW, updatedBy: null,
})
const cached = (settings: HockeySettingsV1, revision: number | null, pending: { baseRevision: number | null } | null) =>
  createSportPersonalSettingsCacheRecord(adapter, settings, { revision, pending, cloudUpdatedAt: null, now: NOW })

describe('sport-neutral personal settings (HKY-5C)', () => {
  it('uses the cloud copy unless a device edit is pending', () => {
    const decision = reconcileSportPersonalSettings(adapter, cached(defaultHockeySettings(), 2, null), cloud(ncaa), defaultHockeySettings(), NOW)
    expect(decision).toMatchObject({ action: 'use_cloud', settings: ncaa, record: { revision: 3, pending: null } })
  })

  it('uploads a pending edit made on the current revision and conflicts on an older one', () => {
    expect(reconcileSportPersonalSettings(adapter, cached(ncaa, 3, { baseRevision: 3 }), cloud(defaultHockeySettings()), defaultHockeySettings()))
      .toEqual({ action: 'upload_local', settings: ncaa, expectedRevision: 3 })
    expect(reconcileSportPersonalSettings(adapter, cached(ncaa, 2, { baseRevision: 2 }), cloud(defaultHockeySettings()), defaultHockeySettings()))
      .toMatchObject({ action: 'conflict', local: ncaa, cloud: defaultHockeySettings() })
  })

  it('never uploads bare defaults, but uploads a device copy when the cloud has none', () => {
    expect(reconcileSportPersonalSettings(adapter, null, null, defaultHockeySettings()))
      .toEqual({ action: 'use_defaults', settings: defaultHockeySettings() })
    expect(reconcileSportPersonalSettings(adapter, cached(ncaa, null, { baseRevision: null }), null, defaultHockeySettings()))
      .toEqual({ action: 'upload_local', settings: ncaa, expectedRevision: null })
  })

  it('fails closed on an invalid or newer cloud copy and a foreign cache', () => {
    expect(reconcileSportPersonalSettings(adapter, null, cloud({ bad: true }), defaultHockeySettings()))
      .toMatchObject({ action: 'invalid_cloud', revision: 3 })
    expect(reconcileSportPersonalSettings(adapter, null, cloud(ncaa, 3, 2), defaultHockeySettings()))
      .toMatchObject({ action: 'invalid_cloud', error: 'Cloud Hockey settings use an unsupported schema.' })
    expect(parseSportPersonalCloudRecord(adapter, { ...cloud(ncaa), sportId: 'basketball' })).toBeNull()
    expect(validSportPersonalSettingsCache(adapter, { ...cached(ncaa, 1, null), sportId: 'basketball' })).toBeNull()
    expect(validSportPersonalSettingsCache(adapter, cached(ncaa, 1, null))?.settings).toEqual(ncaa)
  })

  it('scopes the device cache by account', () => {
    expect(sportPersonalSettingsCacheScope(null)).toEqual({ kind: 'anonymous' })
    expect(sportPersonalSettingsCacheScope('user-1')).toEqual({ kind: 'user', userId: 'user-1' })
  })
})
