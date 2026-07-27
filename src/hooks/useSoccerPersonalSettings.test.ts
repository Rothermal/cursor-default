import { describe, expect, it } from 'vitest'
import {
  isCurrentSoccerSettingsRequest,
  shouldBeginSoccerSettingsWrite,
  shouldStartSoccerSettingsRefresh,
} from './useSoccerPersonalSettings'

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

describe('soccer personal settings write serialization', () => {
  it('blocks a second cloud write while one is already in flight', () => {
    expect(shouldBeginSoccerSettingsWrite(false)).toBe(true)
    expect(shouldBeginSoccerSettingsWrite(true)).toBe(false)
  })

  it('discards responses from superseded request ids after scope changes', () => {
    expect(isCurrentSoccerSettingsRequest(3, 3)).toBe(true)
    expect(isCurrentSoccerSettingsRequest(2, 3)).toBe(false)
  })
})
