import { describe, expect, it } from 'vitest'
import { BASKETBALL_SETTINGS_SCHEMA_VERSION, DEFAULT_BASKETBALL_PERSONAL_SETTINGS } from './settings'
import { loadLatestBasketballSetupAuthority } from './setupAuthority'

const personalSource = {
  kind: 'personal' as const,
  teamName: 'Falcons',
  seasonId: null,
  seasonName: '',
}
const teamSource = {
  kind: 'team' as const,
  teamId: 'team-1',
  seasonId: 'season-1',
  teamName: 'Falcons',
  seasonName: 'Fall',
  accessRole: 'scorer' as const,
}

describe('Basketball setup authority loading', () => {
  it('uses local personal settings without making a cloud request', async () => {
    let calls = 0
    const result = await loadLatestBasketballSetupAuthority({
      source: personalSource,
      personalSettings: DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
      cloudEnabled: false,
      loaders: {
        personal: async () => { calls += 1; return { status: 'missing' } },
        team: async () => { calls += 1; return { status: 'missing' } },
      },
    })

    expect(calls).toBe(0)
    expect(result).toMatchObject({ ok: true, authority: { kind: 'personal', revision: null } })
  })

  it('loads and validates the exact team revision', async () => {
    const result = await loadLatestBasketballSetupAuthority({
      source: teamSource,
      personalSettings: DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
      cloudEnabled: true,
      loaders: {
        personal: async () => ({ status: 'missing' }),
        team: async () => ({
          status: 'loaded',
          record: {
            sportId: 'basketball',
            schemaVersion: BASKETBALL_SETTINGS_SCHEMA_VERSION,
            revision: 9,
            settings: {
              baseProfile: { profileId: 'nba', profileVersion: 1 },
              ruleOverrides: {},
            },
            updatedAt: '2026-08-24T12:00:00.000Z',
            updatedBy: 'user-1',
          },
        }),
      },
    })

    expect(result).toMatchObject({
      ok: true,
      authority: {
        kind: 'team',
        revision: 9,
        settings: { baseProfile: { profileId: 'nba', profileVersion: 1 } },
      },
    })
  })

  it('fails closed when a cloud team source cannot be checked', async () => {
    expect(await loadLatestBasketballSetupAuthority({
      source: teamSource,
      personalSettings: DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
      cloudEnabled: false,
    })).toEqual({
      ok: false,
      error: 'Reconnect before checking shared Basketball defaults.',
    })
  })

  it('fails closed when the fresh settings request rejects', async () => {
    const result = await loadLatestBasketballSetupAuthority({
      source: personalSource,
      personalSettings: DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
      cloudEnabled: true,
      loaders: {
        personal: async () => { throw new Error('network unavailable') },
        team: async () => ({ status: 'missing' }),
      },
    })

    expect(result).toEqual({
      ok: false,
      error: 'The latest Basketball defaults could not be checked. Try again.',
    })
  })
})
