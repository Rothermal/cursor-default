import { describe, expect, it } from 'vitest'
import { shouldSkipShotChartCloudSync } from './shotChartCloudSync'

describe('shouldSkipShotChartCloudSync', () => {
  it('skips when hydration dropped rows and local chart is empty', () => {
    expect(shouldSkipShotChartCloudSync(2, 0)).toBe(true)
  })

  it('allows sync when user has recorded local shots', () => {
    expect(shouldSkipShotChartCloudSync(2, 3)).toBe(false)
  })

  it('allows sync when no rows were dropped during hydration', () => {
    expect(shouldSkipShotChartCloudSync(0, 0)).toBe(false)
  })
})
