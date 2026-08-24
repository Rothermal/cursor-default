import { describe, expect, it } from 'vitest'
import { shouldStartBasketballTeamSettingsRefresh } from './useBasketballTeamSettings'

describe('shared Basketball settings refresh guard', () => {
  it('starts only when cloud work is active and no read or write is in flight', () => {
    expect(shouldStartBasketballTeamSettingsRefresh(true, false, false)).toBe(true)
    expect(shouldStartBasketballTeamSettingsRefresh(false, false, false)).toBe(false)
    expect(shouldStartBasketballTeamSettingsRefresh(true, true, false)).toBe(false)
    expect(shouldStartBasketballTeamSettingsRefresh(true, false, true)).toBe(false)
  })
})
