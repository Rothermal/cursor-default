import { describe, expect, it } from 'vitest'
import {
  isSportSettingsBackendUpdateRequired,
  loadTeamSportSettings,
  loadUserSportSettings,
  parseSportSettingsTableRecord,
  parseSportSettingsSaveResult,
  saveUserSportSettings,
  saveTeamSportSettings,
  sportSettingsBackendMessage,
  type SportSettingsCloudClient,
} from './sportSettingsCloud'

describe('sport settings cloud contracts', () => {
  it('parses applied and conflict records', () => {
    expect(parseSportSettingsSaveResult({
      status: 'applied',
      record: {
        sportId: 'soccer',
        schemaVersion: 1,
        revision: 2,
        settings: { rules: {} },
        updatedAt: '2026-07-26T12:00:00.000Z',
        updatedBy: null,
      },
    })).toEqual({
      status: 'applied',
      record: {
        sportId: 'soccer',
        schemaVersion: 1,
        revision: 2,
        settings: { rules: {} },
        updatedAt: '2026-07-26T12:00:00.000Z',
        updatedBy: null,
      },
    })
    expect(parseSportSettingsSaveResult({
      status: 'conflict',
      record: null,
    })).toEqual({ status: 'conflict', record: null })
  })

  it('classifies missing tables and RPCs as backend-update requirements', () => {
    expect(isSportSettingsBackendUpdateRequired({
      code: '42P01',
      message: 'relation user_sport_settings does not exist',
    })).toBe(true)
    expect(isSportSettingsBackendUpdateRequired({
      code: 'PGRST202',
      message: 'Could not find the function save_user_sport_settings_revisioned',
    })).toBe(true)
    expect(isSportSettingsBackendUpdateRequired({
      code: '42501',
      message: 'permission denied for table user_sport_settings',
    })).toBe(false)
    expect(sportSettingsBackendMessage('user')).toContain('Local settings remain available')
    expect(sportSettingsBackendMessage('team')).toContain('Shared team settings')
  })

  it('rejects malformed load and save responses', async () => {
    const loadClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { sport_id: 'soccer', schema_version: 1 },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SportSettingsCloudClient
    await expect(loadUserSportSettings('soccer', loadClient)).resolves.toEqual({
      status: 'error',
      error: 'Cloud sport settings returned an invalid record.',
    })

    const saveClient = {
      rpc: async () => ({ data: { status: 'applied', record: null }, error: null }),
    } as unknown as SportSettingsCloudClient
    await expect(
      saveUserSportSettings('soccer', 1, null, { rules: {} }, saveClient)
    ).resolves.toEqual({
      status: 'error',
      error: 'Cloud sport settings returned an invalid save result.',
    })
  })

  it('parses direct table rows and loads the current user record', async () => {
    const row = {
      sport_id: 'soccer',
      schema_version: 1,
      revision: 3,
      settings: { marker: 'cloud' },
      updated_at: '2026-07-26T12:00:00.000Z',
    }
    expect(parseSportSettingsTableRecord(row)?.updatedBy).toBeNull()

    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row, error: null }),
          }),
        }),
      }),
    } as unknown as SportSettingsCloudClient

    await expect(loadUserSportSettings('soccer', client)).resolves.toMatchObject({
      status: 'loaded',
      record: { revision: 3, settings: { marker: 'cloud' } },
    })
  })

  it('passes the expected revision to the personal settings RPC', async () => {
    let args: Record<string, unknown> | null = null
    const client = {
      rpc: async (_name: string, nextArgs: Record<string, unknown>) => {
        args = nextArgs
        return {
          data: {
            status: 'conflict',
            record: null,
          },
          error: null,
        }
      },
    } as unknown as SportSettingsCloudClient

    await expect(
      saveUserSportSettings('soccer', 1, 4, { marker: 'device' }, client)
    ).resolves.toEqual({ status: 'conflict', record: null })
    expect(args).toMatchObject({
      p_sport_id: 'soccer',
      p_schema_version: 1,
      p_expected_revision: 4,
      p_settings: { marker: 'device' },
    })
  })

  it('loads a team-scoped record with both identity filters', async () => {
    const filters: Array<[string, string]> = []
    const row = {
      sport_id: 'soccer',
      schema_version: 1,
      revision: 2,
      settings: { rules: { maxOnFieldPlayers: 9 } },
      updated_at: '2026-07-26T12:00:00.000Z',
      updated_by: 'admin-1',
    }
    const chain = {
      eq(column: string, value: string) {
        filters.push([column, value])
        return chain
      },
      maybeSingle: async () => ({ data: row, error: null }),
    }
    const client = {
      from: () => ({ select: () => chain }),
    } as unknown as SportSettingsCloudClient

    await expect(
      loadTeamSportSettings('team-1', 'soccer', client)
    ).resolves.toMatchObject({
      status: 'loaded',
      record: { revision: 2, updatedBy: 'admin-1' },
    })
    expect(filters).toEqual([
      ['team_id', 'team-1'],
      ['sport_id', 'soccer'],
    ])
  })

  it('passes team identity and revision to the shared settings RPC', async () => {
    let functionName = ''
    let args: Record<string, unknown> | null = null
    const client = {
      rpc: async (name: string, nextArgs: Record<string, unknown>) => {
        functionName = name
        args = nextArgs
        return { data: { status: 'conflict', record: null }, error: null }
      },
    } as unknown as SportSettingsCloudClient

    await saveTeamSportSettings(
      'team-1',
      'soccer',
      1,
      3,
      { rules: { maxOnFieldPlayers: 9 } },
      client
    )
    expect(functionName).toBe('save_team_sport_settings_revisioned')
    expect(args).toMatchObject({
      p_team_id: 'team-1',
      p_sport_id: 'soccer',
      p_schema_version: 1,
      p_expected_revision: 3,
    })
  })
})
