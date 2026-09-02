import { describe, expect, it } from 'vitest'
import type { SportSettingsCloudRecord } from '../sportSettingsCloud'
import type { SportSettingsCacheRecord } from '../sportSettingsStorage'
import {
  createSoccerTeamSettingsCacheRecord,
  parseCloudSoccerTeamSettings,
  validSoccerTeamSettingsCache,
} from './teamSettingsSync'

const settings = { rules: { maxOnFieldPlayers: 9 }, formation: null }
const legacySettings = { rules: { maxOnFieldPlayers: 9 } }
const now = '2026-07-26T12:00:00.000Z'

describe('soccer team settings synchronization', () => {
  it('writes version two cache records and accepts current cloud records', () => {
    const cache = createSoccerTeamSettingsCacheRecord(settings, {
      revision: 3,
      cloudUpdatedAt: now,
      now,
    })
    const cloud: SportSettingsCloudRecord = {
      sportId: 'soccer',
      schemaVersion: 2,
      revision: 3,
      settings,
      updatedAt: now,
      updatedBy: 'admin-1',
    }

    expect(validSoccerTeamSettingsCache(cache)?.settings).toEqual(settings)
    expect(cache.schemaVersion).toBe(2)
    expect(parseCloudSoccerTeamSettings(cloud)?.settings).toEqual(settings)
  })

  it('normalizes legacy version-one cache and cloud records', () => {
    const legacyCache: SportSettingsCacheRecord = {
      version: 1,
      sportId: 'soccer',
      schemaVersion: 1,
      revision: 2,
      settings: legacySettings,
      pending: null,
      cloudUpdatedAt: now,
      cachedAt: now,
    }
    const legacyCloud: SportSettingsCloudRecord = {
      sportId: 'soccer',
      schemaVersion: 1,
      revision: 2,
      settings: legacySettings,
      updatedAt: now,
      updatedBy: 'admin-1',
    }

    expect(validSoccerTeamSettingsCache(legacyCache)?.settings).toEqual(settings)
    expect(validSoccerTeamSettingsCache(legacyCache)?.schemaVersion).toBe(1)
    expect(parseCloudSoccerTeamSettings(legacyCloud)?.settings).toEqual(settings)
  })

  it('rejects unsupported schemas and invalid whole payloads', () => {
    const cache = createSoccerTeamSettingsCacheRecord(settings, {
      revision: 3,
      cloudUpdatedAt: now,
      now,
    })
    expect(validSoccerTeamSettingsCache({
      ...cache,
      schemaVersion: 3,
    } as SportSettingsCacheRecord)).toBeNull()

    expect(parseCloudSoccerTeamSettings({
      sportId: 'soccer',
      schemaVersion: 2,
      revision: 4,
      settings: {
        rules: {
          maxOnFieldPlayers: 9,
          unknownRule: true,
        },
        formation: null,
      },
      updatedAt: now,
      updatedBy: 'admin-1',
    })).toBeNull()
  })
})
