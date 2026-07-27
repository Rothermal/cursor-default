import { describe, expect, it } from 'vitest'
import {
  isCurrentSoccerSettingsRequest,
  shouldBeginSoccerSettingsWrite,
} from './useSoccerPersonalSettings'
import { shouldStartSoccerTeamSettingsRefresh } from './useSoccerTeamSettings'

describe('shared soccer settings refresh guard', () => {
  it('starts only when cloud work is active and no read or write is in flight', () => {
    expect(shouldStartSoccerTeamSettingsRefresh(true, false, false)).toBe(true)
    expect(shouldStartSoccerTeamSettingsRefresh(false, false, false)).toBe(false)
    expect(shouldStartSoccerTeamSettingsRefresh(true, true, false)).toBe(false)
    expect(shouldStartSoccerTeamSettingsRefresh(true, false, true)).toBe(false)
  })

  it('shares the personal write and stale-request guards for team defaults', () => {
    expect(shouldBeginSoccerSettingsWrite(true)).toBe(false)
    expect(isCurrentSoccerSettingsRequest(1, 2)).toBe(false)
  })
})
