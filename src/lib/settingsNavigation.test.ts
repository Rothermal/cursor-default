import { describe, expect, it } from 'vitest'
import {
  resolveSettingsSection,
  settingsPath,
  settingsSportIdFromPath,
  sportSettingsPath,
} from './settingsNavigation'

describe('settingsNavigation', () => {
  it('builds settings paths', () => {
    expect(settingsPath('account')).toBe('/settings/account')
    expect(settingsPath('app')).toBe('/settings/app')
    expect(settingsPath('sports')).toBe('/settings/sports')
    expect(settingsPath('data')).toBe('/settings/data')
    expect(settingsPath('advanced')).toBe('/settings/advanced')
    expect(sportSettingsPath('basketball')).toBe('/settings/sports/basketball')
  })

  it('resolves settings sections from paths', () => {
    expect(resolveSettingsSection('/settings')).toBe('account')
    expect(resolveSettingsSection('/settings/account')).toBe('account')
    expect(resolveSettingsSection('/settings/app')).toBe('app')
    expect(resolveSettingsSection('/settings/sports')).toBe('sports')
    expect(resolveSettingsSection('/settings/sports/basketball')).toBe('sport')
    expect(resolveSettingsSection('/settings/data')).toBe('data')
    expect(resolveSettingsSection('/settings/advanced')).toBe('advanced')
  })

  it('extracts sport settings ids', () => {
    expect(settingsSportIdFromPath('/settings/sports/basketball')).toBe('basketball')
    expect(settingsSportIdFromPath('/settings/sports/soccer')).toBe('soccer')
    expect(settingsSportIdFromPath('/settings/sports')).toBeNull()
  })
})
