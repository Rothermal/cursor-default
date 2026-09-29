import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeStoredSettings } from '../settingsStorage'
import { getHockeyEventCreationPolicy, SPORT_EVENT_RELEASE_STAGES } from '../sportAvailability'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

function implementationFiles(directory: string): string[] {
  return readdirSync(resolve(process.cwd(), directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return implementationFiles(path)
    return /\.tsx?$/.test(path) && !path.includes('.test.') ? [path] : []
  })
}

describe('HKY-2E hockeyEvent release stage', () => {
  it('ships as a production opt-in', () => {
    expect(SPORT_EVENT_RELEASE_STAGES.hockey).toBe('opt_in')
  })

  it('needs the device toggle in production and keeps existing games reachable', () => {
    const off = getHockeyEventCreationPolicy(false, { development: false })
    expect(off).toEqual({
      releaseStage: 'opt_in',
      preferenceAvailable: true,
      canCreateNewEventGame: false,
      canAccessExistingEventGames: true,
    })
    expect(getHockeyEventCreationPolicy(true, { development: false }).canCreateNewEventGame).toBe(true)
  })

  it('rolls back to internal by hiding the toggle and ignoring a stored opt-in', () => {
    const internal = getHockeyEventCreationPolicy(true, { development: false, releaseStage: 'internal' })
    expect(internal.preferenceAvailable).toBe(false)
    expect(internal.canCreateNewEventGame).toBe(false)
    expect(internal.canAccessExistingEventGames).toBe(true)
  })

  it('keeps the development preview without the toggle', () => {
    expect(getHockeyEventCreationPolicy(false, { development: true }).canCreateNewEventGame).toBe(true)
    expect(getHockeyEventCreationPolicy(false, { development: true, releaseStage: 'internal' }).canCreateNewEventGame).toBe(true)
  })

  it('stores the device toggle default-off and fails closed on malformed values', () => {
    expect(mergeStoredSettings({}).hockey.eventTrackerEnabled).toBe(false)
    expect(mergeStoredSettings({ hockey: { eventTrackerEnabled: true } }).hockey.eventTrackerEnabled).toBe(true)
    expect(mergeStoredSettings({ hockey: { eventTrackerEnabled: 'true' } }).hockey.eventTrackerEnabled).toBe(false)
    expect(mergeStoredSettings({ hockey: null }).hockey.eventTrackerEnabled).toBe(false)
  })
})

describe('HKY-2E route gates', () => {
  it('sends the event setup route to the page that applies the policy', () => {
    const app = source('src/App.tsx')
    const setupRoute = app.slice(app.indexOf('function GameSetupRoute()'), app.indexOf('function PlayerSetupRoute()'))
    expect(setupRoute).toContain("requestedSport === 'hockey' && searchParams.get('events') === '1'")
    expect(setupRoute).toContain('<HockeyGameSetup />')
    expect(source('src/pages/HockeyGameSetup.tsx'))
      .toContain('if (!getHockeyEventCreationPolicy(hockeyEventTrackerEnabled).canCreateNewEventGame)')
  })

  it('opens existing Hockey event games without consulting the release stage', () => {
    const app = source('src/App.tsx')
    const trackerRoute = app.slice(app.indexOf('function GameTrackerRoute()'), app.indexOf('function GameCheckoutRoute()'))
    expect(trackerRoute).toContain('<HockeyGameTracker />')
    expect(trackerRoute).not.toMatch(/Policy|Availab/)
    expect(source('src/pages/HockeyGameTracker.tsx')).not.toMatch(/sportAvailability|Policy\(/)
  })

  it('keeps the policy consumers audited', () => {
    const consumers = implementationFiles('src')
      .filter(path => path !== 'src/lib/sportAvailability.ts' && source(path).includes('getHockeyEventCreationPolicy'))
      .sort()
    expect(consumers).toEqual([
      'src/components/settings/HockeySettings.tsx',
      'src/pages/HockeyGameSetup.tsx',
      'src/pages/SportDashboard.tsx',
    ])
  })
})
