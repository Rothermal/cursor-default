import { describe, expect, it } from 'vitest'
import { shouldStartSoccerSettingsRefresh } from './useSoccerPersonalSettings'

describe('soccer personal settings refresh policy', () => {
  it('does not reconcile while cloud settings are disabled', () => {
    expect(shouldStartSoccerSettingsRefresh(false, false, false)).toBe(false)
  })

  it('does not refresh during another refresh or cloud write', () => {
    expect(shouldStartSoccerSettingsRefresh(true, false, false)).toBe(true)
    expect(shouldStartSoccerSettingsRefresh(true, true, false)).toBe(false)
    expect(shouldStartSoccerSettingsRefresh(true, false, true)).toBe(false)
  })
})
