import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isHockeyEventPreviewAvailable } from '../sportAvailability'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

function implementationFiles(directory: string): string[] {
  return readdirSync(resolve(process.cwd(), directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return implementationFiles(path)
    return /\.tsx?$/.test(path) && !path.includes('.test.') ? [path] : []
  })
}

describe('HKY-1 Hockey event preview gate', () => {
  it('is available only in development builds', () => {
    expect(isHockeyEventPreviewAvailable(true)).toBe(true)
    expect(isHockeyEventPreviewAvailable(false)).toBe(false)
  })

  it('routes the setup preview only through the centralized development policy', () => {
    const app = source('src/App.tsx')
    const setupRoute = app.slice(app.indexOf('function GameSetupRoute()'), app.indexOf('function PlayerSetupRoute()'))
    expect(setupRoute).toContain("requestedSport === 'hockey'")
    expect(setupRoute).toContain("searchParams.get('events') === '1'")
    expect(setupRoute).toContain('isHockeyEventPreviewAvailable()')
    expect(source('src/pages/HockeyEventPreview.tsx')).toContain('if (!isHockeyEventPreviewAvailable())')
  })

  it('keeps the preview policy consumers audited', () => {
    const consumers = implementationFiles('src')
      .filter(path => path !== 'src/lib/sportAvailability.ts' && source(path).includes('isHockeyEventPreviewAvailable'))
      .sort()
    expect(consumers).toEqual(['src/App.tsx', 'src/pages/HockeyEventPreview.tsx'])
  })
})
