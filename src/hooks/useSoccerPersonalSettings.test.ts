import { describe, expect, it } from 'vitest'
import { shouldStartSoccerSettingsRefresh } from './useSoccerPersonalSettings'

describe('soccer personal settings refresh policy', () => {
  it('does not reconcile while cloud settings are disabled', () => {
    expect(shouldStartSoccerSettingsRefresh(false, false)).toBe(false)
  })

  it('allows only one refresh at a time', () => {
    expect(shouldStartSoccerSettingsRefresh(true, false)).toBe(true)
    expect(shouldStartSoccerSettingsRefresh(true, true)).toBe(false)
  })
})
