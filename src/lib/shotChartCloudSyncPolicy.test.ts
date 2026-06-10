import { describe, expect, it } from 'vitest'
import { shouldSkipShotChartCloudSync } from './shotChartCloudSyncPolicy'

describe('shouldSkipShotChartCloudSync', () => {
  it('blocks sync when hydration dropped rows', () => {
    expect(shouldSkipShotChartCloudSync(1)).toBe(true)
    expect(shouldSkipShotChartCloudSync(3)).toBe(true)
  })

  it('allows sync when guard is cleared', () => {
    expect(shouldSkipShotChartCloudSync(0)).toBe(false)
  })
})
