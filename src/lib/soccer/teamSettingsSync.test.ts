import { describe, expect, it } from 'vitest'
import type { SportSettingsCloudRecord } from '../sportSettingsCloud'
import type { SportSettingsCacheRecord } from '../sportSettingsStorage'
import {
  createSoccerTeamSettingsCacheRecord,
  parseCloudSoccerTeamSettings,
  validSoccerTeamSettingsCache,
} from './teamSettingsSync'

const settings = { rules: { maxOnFieldPlayers: 9 } }
const now = '2026-07-26T12:00:00.000Z'

describe('soccer team settings synchronization', () => {
  it('accepts version-one cache and cloud records', () => {
    const cache = createSoccerTeamSettingsCacheRecord(settings, {
      revision: 3,
      cloudUpdatedAt: now,
      now,
    })
    const cloud: SportSettingsCloudRecord = {
      sportId: 'soccer',
      schemaVersion: 1,
      revision: 3,
      settings,
      updatedAt: now,
      updatedBy: 'admin-1',
    }

    expect(validSoccerTeamSettingsCache(cache)?.settings).toEqual(settings)
    expect(parseCloudSoccerTeamSettings(cloud)?.settings).toEqual(settings)
  })

  it('rejects unsupported schemas and invalid whole payloads', () => {
    const cache = createSoccerTeamSettingsCacheRecord(settings, {
      revision: 3,
      cloudUpdatedAt: now,
      now,
    })
    expect(validSoccerTeamSettingsCache({
      ...cache,
      schemaVersion: 2,
    } as SportSettingsCacheRecord)).toBeNull()

    expect(parseCloudSoccerTeamSettings({
      sportId: 'soccer',
      schemaVersion: 1,
      revision: 4,
      settings: {
        rules: {
          maxOnFieldPlayers: 9,
          unknownRule: true,
        },
      },
      updatedAt: now,
      updatedBy: 'admin-1',
    })).toBeNull()
  })
})
