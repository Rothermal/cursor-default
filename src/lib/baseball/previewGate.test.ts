import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isBaseballEventPreviewAvailable } from '../sportAvailability'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

function implementationFiles(directory: string): string[] {
  return readdirSync(resolve(process.cwd(), directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return implementationFiles(path)
    return /\.tsx?$/.test(path) && !path.includes('.test.') ? [path] : []
  })
}

describe('BSB-2 Baseball event preview gate', () => {
  it('is available only in development builds', () => {
    expect(isBaseballEventPreviewAvailable(true)).toBe(true)
    expect(isBaseballEventPreviewAvailable(false)).toBe(false)
  })

  it('routes setup only through the centralized development policy', () => {
    const app = source('src/App.tsx')
    const setupRoute = app.slice(app.indexOf('function GameSetupRoute()'), app.indexOf('function PlayerSetupRoute()'))
    expect(setupRoute).toContain("requestedSport === 'baseball'")
    expect(setupRoute).toContain("searchParams.get('events') === '1'")
    expect(setupRoute).toContain('isBaseballEventPreviewAvailable()')
    expect(source('src/pages/BaseballEventSetup.tsx')).toContain('if (!isBaseballEventPreviewAvailable())')
    expect(source('src/pages/BaseballGameTracker.tsx')).toContain('if (!isBaseballEventPreviewAvailable())')
  })

  it('never sends a Baseball event game to the legacy stat grid', () => {
    const app = source('src/App.tsx')
    const trackerRoute = app.slice(app.indexOf('function GameTrackerRoute()'), app.indexOf('function GameCheckoutRoute()'))
    expect(trackerRoute.indexOf("state.sport?.id === 'baseball'")).toBeGreaterThan(-1)
    expect(trackerRoute.indexOf("state.sport?.id === 'baseball'")).toBeLessThan(trackerRoute.indexOf('<GameTracker />'))
  })

  it('keeps the preview policy consumers audited', () => {
    const consumers = implementationFiles('src')
      .filter(path => path !== 'src/lib/sportAvailability.ts' && source(path).includes('isBaseballEventPreviewAvailable'))
      .sort()
    expect(consumers).toEqual(['src/App.tsx', 'src/pages/BaseballEventSetup.tsx', 'src/pages/BaseballGameTracker.tsx'])
  })
})
