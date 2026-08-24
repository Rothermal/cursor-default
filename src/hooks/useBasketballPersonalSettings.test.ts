import { describe, expect, it } from 'vitest'
import { shouldStartBasketballSettingsRefresh } from './useBasketballPersonalSettings'

describe('Basketball personal settings refresh policy', () => {
  it('requires cloud settings and an idle controller', () => {
    expect(shouldStartBasketballSettingsRefresh(false, false, false)).toBe(false)
    expect(shouldStartBasketballSettingsRefresh(true, false, false)).toBe(true)
    expect(shouldStartBasketballSettingsRefresh(true, true, false)).toBe(false)
    expect(shouldStartBasketballSettingsRefresh(true, false, true)).toBe(false)
  })
})
