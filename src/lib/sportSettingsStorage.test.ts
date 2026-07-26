import { describe, expect, it } from 'vitest'
import {
  loadSportSettingsCache,
  saveSportSettingsCache,
  sportSettingsCacheKey,
  type SportSettingsCacheRecord,
} from './sportSettingsStorage'

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function record(marker: string): SportSettingsCacheRecord<{ marker: string }> {
  return {
    version: 1,
    sportId: 'soccer',
    schemaVersion: 1,
    revision: null,
    settings: { marker },
    pending: {
      baseRevision: null,
      savedAt: '2026-07-26T12:00:00.000Z',
    },
    cloudUpdatedAt: null,
    cachedAt: '2026-07-26T12:00:00.000Z',
  }
}

describe('sport settings cache', () => {
  it('isolates anonymous and user-keyed account settings', () => {
    const storage = new MemoryStorage()
    saveSportSettingsCache({ kind: 'anonymous' }, record('anonymous'), storage)
    saveSportSettingsCache(
      { kind: 'user', userId: 'user-1' },
      record('account'),
      storage
    )

    expect(
      loadSportSettingsCache<{ marker: string }>(
        { kind: 'anonymous' },
        'soccer',
        storage
      )?.settings.marker
    ).toBe('anonymous')
    expect(
      loadSportSettingsCache<{ marker: string }>(
        { kind: 'user', userId: 'user-1' },
        'soccer',
        storage
      )?.settings.marker
    ).toBe('account')
    expect(
      loadSportSettingsCache(
        { kind: 'user', userId: 'user-2' },
        'soccer',
        storage
      )
    ).toBeNull()
  })

  it('retains pending account edits in the account-scoped record', () => {
    const storage = new MemoryStorage()
    const scope = { kind: 'user', userId: 'user-1' } as const
    saveSportSettingsCache(scope, record('pending'), storage)

    expect(loadSportSettingsCache(scope, 'soccer', storage)?.pending).toEqual({
      baseRevision: null,
      savedAt: '2026-07-26T12:00:00.000Z',
    })
    expect(loadSportSettingsCache({ kind: 'anonymous' }, 'soccer', storage)).toBeNull()
  })

  it('fails closed for corrupt or mismatched records', () => {
    const storage = new MemoryStorage()
    const key = sportSettingsCacheKey({ kind: 'anonymous' }, 'soccer')
    storage.setItem(key, '{not-json')
    expect(loadSportSettingsCache({ kind: 'anonymous' }, 'soccer', storage)).toBeNull()

    storage.setItem(key, JSON.stringify({ ...record('wrong'), sportId: 'basketball' }))
    expect(loadSportSettingsCache({ kind: 'anonymous' }, 'soccer', storage)).toBeNull()
  })
})
