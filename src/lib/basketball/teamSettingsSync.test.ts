import { describe, expect, it } from 'vitest'
import type { SportSettingsCloudRecord } from '../sportSettingsCloud'
import type { SportSettingsCacheRecord } from '../sportSettingsStorage'
import {
  basketballTeamSettingsCacheScope,
  basketballTeamSettingsFingerprint,
  createBasketballTeamSettingsCacheRecord,
  defaultBasketballTeamSettings,
  parseCloudBasketballTeamSettings,
  resolveBasketballTeamSettingsCloudRecord,
  validBasketballTeamSettingsCache,
} from './teamSettingsSync'

const now = '2026-08-24T12:00:00.000Z'

describe('Basketball team settings synchronization', () => {
  it('resolves a missing cloud row from the exact application default', () => {
    expect(resolveBasketballTeamSettingsCloudRecord(null)).toEqual({
      status: 'missing',
      settings: {
        baseProfile: { profileId: 'nfhs', profileVersion: 1 },
        ruleOverrides: {},
      },
    })
  })

  it('accepts strict version-one Basketball cache and cloud records', () => {
    const settings = defaultBasketballTeamSettings()
    const cache = createBasketballTeamSettingsCacheRecord(settings, {
      revision: 3,
      cloudUpdatedAt: now,
      now,
    })
    const cloud: SportSettingsCloudRecord = {
      sportId: 'basketball',
      schemaVersion: 1,
      revision: 3,
      settings,
      updatedAt: now,
      updatedBy: 'admin-1',
    }

    expect(validBasketballTeamSettingsCache(cache)?.settings).toEqual(settings)
    expect(parseCloudBasketballTeamSettings(cloud)?.settings).toEqual(settings)
  })

  it('rejects wrong-sport, unsupported-schema, and invalid whole records', () => {
    const cache = createBasketballTeamSettingsCacheRecord(
      defaultBasketballTeamSettings(),
      { revision: 3, cloudUpdatedAt: now, now }
    )
    expect(validBasketballTeamSettingsCache({
      ...cache,
      sportId: 'soccer',
    } as SportSettingsCacheRecord)).toBeNull()
    expect(validBasketballTeamSettingsCache({
      ...cache,
      schemaVersion: 2,
    } as SportSettingsCacheRecord)).toBeNull()
    expect(parseCloudBasketballTeamSettings({
      sportId: 'basketball',
      schemaVersion: 1,
      revision: 4,
      settings: {
        ...defaultBasketballTeamSettings(),
        unknown: true,
      },
      updatedAt: now,
      updatedBy: 'admin-1',
    })).toBeNull()
  })

  it('keeps team caches account-and-team scoped', () => {
    expect(basketballTeamSettingsCacheScope('user-1', 'team-1')).toEqual({
      kind: 'team',
      userId: 'user-1',
      teamId: 'team-1',
    })
    expect(basketballTeamSettingsCacheScope('user-2', 'team-1')).not.toEqual(
      basketballTeamSettingsCacheScope('user-1', 'team-1')
    )
    expect(basketballTeamSettingsCacheScope('user-1', 'team-2')).not.toEqual(
      basketballTeamSettingsCacheScope('user-1', 'team-1')
    )
  })

  it('fingerprints equivalent settings independently of key order', () => {
    const settings = defaultBasketballTeamSettings()
    expect(basketballTeamSettingsFingerprint(settings)).toBe(
      basketballTeamSettingsFingerprint({
        ruleOverrides: settings.ruleOverrides,
        baseProfile: settings.baseProfile,
      })
    )
  })
})
