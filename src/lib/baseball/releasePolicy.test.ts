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

describe('BSB-7D Baseball event-only release', () => {
  it('ships event-only creation independently of sport discovery', () => {
    expect(SPORT_EVENT_RELEASE_STAGES.baseball).toBe('released')
  })

  it('ignores the retired device toggle and keeps existing games reachable', () => {
    expect(getBaseballEventCreationPolicy(false, { development: false })).toEqual({
      releaseStage: 'released',
      preferenceAvailable: false,
      canCreateNewEventGame: true,
      canAccessExistingEventGames: true,
    })
    expect(getBaseballEventCreationPolicy(true, { development: false }).canCreateNewEventGame).toBe(true)
  })

  it('rolls back new creation without restoring opt-in or gating existing games', () => {
    const internal = getBaseballEventCreationPolicy(true, { development: false, releaseStage: 'internal', creationEnabled: false })
    expect(internal.preferenceAvailable).toBe(false)
    expect(internal.canCreateNewEventGame).toBe(false)
    expect(internal.canAccessExistingEventGames).toBe(true)
  })

  it('uses the same explicit creation rollback in development', () => {
    expect(getBaseballEventCreationPolicy(false, { development: true }).canCreateNewEventGame).toBe(true)
    expect(getBaseballEventCreationPolicy(true, { development: true, releaseStage: 'opt_in', creationEnabled: false }).canCreateNewEventGame).toBe(false)
  })

  it('preserves old device settings without using them for authority', () => {
    expect(mergeStoredSettings({}).baseball.eventTrackerEnabled).toBe(false)
    expect(mergeStoredSettings({ baseball: { eventTrackerEnabled: true } }).baseball.eventTrackerEnabled).toBe(true)
    expect(mergeStoredSettings({ baseball: { eventTrackerEnabled: 'true' } }).baseball.eventTrackerEnabled).toBe(false)
    expect(mergeStoredSettings({ baseball: null }).baseball.eventTrackerEnabled).toBe(false)
  })
})

describe('BSB-7D route gates', () => {
  it('sends the event setup route to the page that applies the policy', () => {
    const app = source('src/App.tsx')
    const setupRoute = app.slice(app.indexOf('function GameSetupRoute()'), app.indexOf('function PlayerSetupRoute()'))
    expect(setupRoute).toContain("eventsRequested: searchParams.get('events') === '1'")
    expect(source('src/lib/gameSetupRoute.ts'))
      .toContain("if (sport === 'baseball') return 'baseball_events'")
    expect(setupRoute).toContain('<BaseballEventSetup key=')
    expect(source('src/pages/BaseballEventSetup.tsx'))
      .toContain('if (!getBaseballEventCreationPolicy().canCreateNewEventGame)')
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
      'src/pages/BaseballEventSetup.tsx',
    ])
  })

  it('removes preview UI while retaining capture controls and data-safe update prompts', () => {
    const settings = source('src/components/settings/BaseballSettings.tsx')
    expect(settings).not.toMatch(/New event tracker|eventTrackerEnabled|role="switch"/)
    expect(settings).toContain('New-game capture defaults')
    const pwa = source('src/components/PwaStatus.tsx')
    expect(pwa).toContain("prepareActiveGameMutation('reload_commit')")
    expect(pwa).toContain('updateServiceWorker(true)')
    expect(pwa).toContain('Later')
  })
})
