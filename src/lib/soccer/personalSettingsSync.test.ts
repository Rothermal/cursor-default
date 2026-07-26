import { describe, expect, it } from 'vitest'
import type { SportSettingsCloudRecord } from '../sportSettingsCloud'
import {
  DEFAULT_SOCCER_PERSONAL_SETTINGS,
  type SoccerPersonalSettings,
} from './settings'
import {
  createSoccerSettingsCacheRecord,
  reconcileSoccerPersonalSettings,
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
        pendingBaseRevision: undefined,
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
      pendingBaseRevision: 2,
      cloudUpdatedAt: now,
      now,
    })
    expect(reconcileSoccerPersonalSettings(local, cloud(2, settings(false))).action)
      .toBe('upload_local')
    expect(reconcileSoccerPersonalSettings(local, cloud(3, settings(false))).action)
      .toBe('conflict')
  })

  it('initializes a missing cloud row from the available local defaults', () => {
    const result = reconcileSoccerPersonalSettings(
      null,
      null,
      settings(true)
    )
    expect(result).toMatchObject({
      action: 'upload_local',
      expectedRevision: null,
      settings: { display: { fieldFlipped: true } },
    })
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
})
