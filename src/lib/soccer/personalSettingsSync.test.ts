import { describe, expect, it } from 'vitest'
import type { SportSettingsCloudRecord } from '../sportSettingsCloud'
import {
  DEFAULT_SOCCER_PERSONAL_SETTINGS,
  type SoccerPersonalSettings,
} from './settings'
import {
  createSoccerSettingsCacheRecord,
  reconcileSoccerPersonalSettings,
  soccerSettingsFingerprint,
} from './personalSettingsSync'

const now = '2026-07-26T12:00:00.000Z'

function settings(fieldFlipped: boolean): SoccerPersonalSettings {
  return {
    ...structuredClone(DEFAULT_SOCCER_PERSONAL_SETTINGS),
    display: { fieldFlipped },
  }
}

function cloud(
  revision: number,
  value: SoccerPersonalSettings
): SportSettingsCloudRecord<SoccerPersonalSettings> {
  return {
    sportId: 'soccer',
    schemaVersion: 1,
    revision,
    settings: value,
    updatedAt: now,
    updatedBy: null,
  }
}

describe('personal soccer settings reconciliation', () => {
  it('uses established cloud settings when the cache has no pending edit', () => {
    const result = reconcileSoccerPersonalSettings(
      createSoccerSettingsCacheRecord(settings(false), {
        revision: 1,
        pending: null,
        cloudUpdatedAt: now,
        now,
      }),
      cloud(2, settings(true)),
      settings(false),
      now
    )
    expect(result.action).toBe('use_cloud')
    if (result.action === 'use_cloud') {
      expect(result.settings.display.fieldFlipped).toBe(true)
    }
  })

  it('uploads a pending edit only from the matching cloud revision', () => {
    const local = createSoccerSettingsCacheRecord(settings(true), {
      revision: 2,
      pending: { baseRevision: 2 },
      cloudUpdatedAt: now,
      now,
    })
    expect(reconcileSoccerPersonalSettings(local, cloud(2, settings(false))).action)
      .toBe('upload_local')
    expect(reconcileSoccerPersonalSettings(local, cloud(3, settings(false))).action)
      .toBe('conflict')
  })

  it('keeps untouched built-in defaults local when no cloud or cache exists', () => {
    const result = reconcileSoccerPersonalSettings(
      null,
      null,
      settings(true)
    )
    expect(result).toMatchObject({
      action: 'use_local',
      settings: { display: { fieldFlipped: true } },
    })
  })

  it('uploads a meaningful local profile when the cloud row is missing', () => {
    const local = createSoccerSettingsCacheRecord(settings(true), {
      revision: null,
      pending: { baseRevision: null },
      cloudUpdatedAt: null,
      now,
    })
    expect(reconcileSoccerPersonalSettings(local, null)).toMatchObject({
      action: 'upload_local',
      expectedRevision: null,
    })
  })

  it('fingerprints equivalent settings independently of object key order', () => {
    const original = settings(true)
    const reordered = reorderObjectKeys(original)
    expect(soccerSettingsFingerprint(original)).toBe(
      soccerSettingsFingerprint(reordered as SoccerPersonalSettings)
    )
  })

  it('fails closed on an unsupported cloud schema', () => {
    const result = reconcileSoccerPersonalSettings(null, {
      ...cloud(5, settings(true)),
      schemaVersion: 2,
    })
    expect(result).toMatchObject({
      action: 'invalid_cloud',
      revision: 5,
    })
  })

  it('retains a coherent local cache when the cloud schema is unsupported', () => {
    const local = createSoccerSettingsCacheRecord(settings(true), {
      revision: 4,
      pending: null,
      cloudUpdatedAt: now,
      now,
    })
    const result = reconcileSoccerPersonalSettings(local, {
      ...cloud(5, settings(false)),
      schemaVersion: 2,
    })

    expect(result).toMatchObject({
      action: 'invalid_cloud',
      settings: { display: { fieldFlipped: true } },
      revision: 5,
    })
  })
})

function reorderObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderObjectKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [key, reorderObjectKeys(item)])
  )
}
