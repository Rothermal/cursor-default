import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeStoredSettings } from '../settingsStorage'
import { getBaseballEventCreationPolicy, SPORT_EVENT_RELEASE_STAGES } from '../sportAvailability'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

function implementationFiles(directory: string): string[] {
  return readdirSync(resolve(process.cwd(), directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return implementationFiles(path)
    return /\.tsx?$/.test(path) && !path.includes('.test.') ? [path] : []
  })
}

describe('BSB-3D baseballEvent release stage', () => {
  it('ships as a production opt-in', () => {
    expect(SPORT_EVENT_RELEASE_STAGES.baseball).toBe('opt_in')
  })

  it('needs the device toggle in production and keeps existing games reachable', () => {
    expect(getBaseballEventCreationPolicy(false, { development: false })).toEqual({
      releaseStage: 'opt_in',
      preferenceAvailable: true,
      canCreateNewEventGame: false,
      canAccessExistingEventGames: true,
    })
    expect(getBaseballEventCreationPolicy(true, { development: false }).canCreateNewEventGame).toBe(true)
  })

  it('rolls back to internal by hiding the toggle and ignoring a stored opt-in', () => {
    const internal = getBaseballEventCreationPolicy(true, { development: false, releaseStage: 'internal' })
    expect(internal.preferenceAvailable).toBe(false)
    expect(internal.canCreateNewEventGame).toBe(false)
    expect(internal.canAccessExistingEventGames).toBe(true)
  })

  it('keeps the development preview without the toggle', () => {
    expect(getBaseballEventCreationPolicy(false, { development: true }).canCreateNewEventGame).toBe(true)
    expect(getBaseballEventCreationPolicy(false, { development: true, releaseStage: 'internal' }).canCreateNewEventGame).toBe(true)
  })

  it('stores the device toggle default-off and fails closed on malformed values', () => {
    expect(mergeStoredSettings({}).baseball.eventTrackerEnabled).toBe(false)
    expect(mergeStoredSettings({ baseball: { eventTrackerEnabled: true } }).baseball.eventTrackerEnabled).toBe(true)
    expect(mergeStoredSettings({ baseball: { eventTrackerEnabled: 'true' } }).baseball.eventTrackerEnabled).toBe(false)
    expect(mergeStoredSettings({ baseball: null }).baseball.eventTrackerEnabled).toBe(false)
  })
})

describe('BSB-3D route gates', () => {
  it('sends the event setup route to the page that applies the policy', () => {
    const app = source('src/App.tsx')
    const setupRoute = app.slice(app.indexOf('function GameSetupRoute()'), app.indexOf('function PlayerSetupRoute()'))
    expect(setupRoute).toContain("requestedSport === 'baseball' && searchParams.get('events') === '1'")
    expect(setupRoute).toContain('<BaseballEventSetup />')
    expect(source('src/pages/BaseballEventSetup.tsx'))
      .toContain('if (!getBaseballEventCreationPolicy(baseballEventTrackerEnabled).canCreateNewEventGame)')
  })

  it('opens existing Baseball event games without consulting the release stage', () => {
    const app = source('src/App.tsx')
    const trackerRoute = app.slice(app.indexOf('function GameTrackerRoute()'), app.indexOf('function GameCheckoutRoute()'))
    expect(trackerRoute).toContain('<BaseballGameTracker />')
    expect(trackerRoute).not.toMatch(/Policy|Availab/)
    expect(source('src/pages/BaseballGameTracker.tsx')).not.toMatch(/sportAvailability|Policy\(/)
  })

  it('never sends a Baseball event game to the legacy stat grid', () => {
    const app = source('src/App.tsx')
    const trackerRoute = app.slice(app.indexOf('function GameTrackerRoute()'), app.indexOf('function GameCheckoutRoute()'))
    expect(trackerRoute.indexOf("state.sport?.id === 'baseball'")).toBeGreaterThan(-1)
    expect(trackerRoute.indexOf("state.sport?.id === 'baseball'")).toBeLessThan(trackerRoute.indexOf('<GameTracker />'))
  })

  it('keeps the policy consumers audited', () => {
    const consumers = implementationFiles('src')
      .filter(path => path !== 'src/lib/sportAvailability.ts' && source(path).includes('getBaseballEventCreationPolicy'))
      .sort()
    expect(consumers).toEqual([
      'src/components/settings/BaseballSettings.tsx',
      'src/pages/BaseballEventSetup.tsx',
      'src/pages/SportDashboard.tsx',
    ])
  })
})
