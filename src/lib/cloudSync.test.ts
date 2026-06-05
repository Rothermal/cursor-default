import { describe, expect, it } from 'vitest'
import { shouldSkipShotChartSync } from './cloudSync'

describe('shouldSkipShotChartSync', () => {
  it('skips when hydration dropped rows and local chart is empty', () => {
    expect(shouldSkipShotChartSync(0, 2)).toBe(true)
  })

  it('allows sync when local chart has shots despite dropped hydration rows', () => {
    expect(shouldSkipShotChartSync(3, 2)).toBe(false)
  })

  it('allows sync when no hydration rows were dropped', () => {
    expect(shouldSkipShotChartSync(0, 0)).toBe(false)
  })
})
