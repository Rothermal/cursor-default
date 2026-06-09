import { describe, expect, it } from 'vitest'
import {
  shouldAvoidShotChartCloudDelete,
  shouldSkipShotChartCloudDeleteReplace,
} from './shotChartSyncPolicy'

describe('shouldSkipShotChartCloudDeleteReplace', () => {
  it('skips delete+replace when hydration dropped rows and local chart is empty', () => {
    expect(shouldSkipShotChartCloudDeleteReplace(2, 0)).toBe(true)
  })

  it('allows sync when local chart has shots even if hydration dropped rows', () => {
    expect(shouldSkipShotChartCloudDeleteReplace(2, 5)).toBe(false)
  })

  it('allows sync when no rows were dropped during hydration', () => {
    expect(shouldSkipShotChartCloudDeleteReplace(0, 0)).toBe(false)
    expect(shouldSkipShotChartCloudDeleteReplace(0, 3)).toBe(false)
  })
})

describe('shouldAvoidShotChartCloudDelete', () => {
  it('avoids cloud delete when local shots exist but none map to remote players', () => {
    expect(shouldAvoidShotChartCloudDelete(3, 0)).toBe(true)
  })

  it('allows delete when at least one local shot maps', () => {
    expect(shouldAvoidShotChartCloudDelete(3, 2)).toBe(false)
  })

  it('allows delete when local chart is empty', () => {
    expect(shouldAvoidShotChartCloudDelete(0, 0)).toBe(false)
  })
})
