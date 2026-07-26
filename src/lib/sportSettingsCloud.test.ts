import { describe, expect, it } from 'vitest'
import {
  isSportSettingsBackendUpdateRequired,
  parseSportSettingsSaveResult,
  sportSettingsBackendMessage,
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
  })
})
