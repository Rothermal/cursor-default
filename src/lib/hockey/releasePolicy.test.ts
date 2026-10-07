import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeStoredSettings } from '../settingsStorage'
import { getHockeyEventCreationPolicy, hockeyNewGamesUseEventTracker, SPORT_EVENT_RELEASE_STAGES } from '../sportAvailability'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

function implementationFiles(directory: string): string[] {
  return readdirSync(resolve(process.cwd(), directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return implementationFiles(path)
    return /\.tsx?$/.test(path) && !path.includes('.test.') ? [path] : []
  })
}

describe('HKY-6C hockeyEvent release stage', () => {
  it('ships released: every new Hockey game is an event game, with no device toggle', () => {
    expect(SPORT_EVENT_RELEASE_STAGES.hockey).toBe('released')
    expect(getHockeyEventCreationPolicy(false, { development: false })).toEqual({
      releaseStage: 'released',
      preferenceAvailable: false,
      canCreateNewEventGame: true,
      canAccessExistingEventGames: true,
    })
    expect(hockeyNewGamesUseEventTracker(false, { development: false })).toBe(true)
    expect(hockeyNewGamesUseEventTracker(true, { development: false })).toBe(true)
  })

  it('rolls back to opt_in: the device toggle decides again', () => {
    const optIn = { development: false, releaseStage: 'opt_in' as const }
    expect(getHockeyEventCreationPolicy(false, optIn)).toEqual({
      releaseStage: 'opt_in',
      preferenceAvailable: true,
      canCreateNewEventGame: false,
      canAccessExistingEventGames: true,
    })
    expect(getHockeyEventCreationPolicy(true, optIn).canCreateNewEventGame).toBe(true)
    expect(hockeyNewGamesUseEventTracker(false, optIn)).toBe(false)
    expect(hockeyNewGamesUseEventTracker(true, optIn)).toBe(true)
    // Development keeps the preview but still follows the toggle for where new games go.
    expect(hockeyNewGamesUseEventTracker(false, { development: true, releaseStage: 'opt_in' })).toBe(false)
  })

  it('rolls back to internal by hiding the toggle and ignoring a stored opt-in', () => {
    const internal = getHockeyEventCreationPolicy(true, { development: false, releaseStage: 'internal' })
    expect(internal.preferenceAvailable).toBe(false)
    expect(internal.canCreateNewEventGame).toBe(false)
    expect(internal.canAccessExistingEventGames).toBe(true)
    expect(hockeyNewGamesUseEventTracker(true, { development: false, releaseStage: 'internal' })).toBe(false)
  })

  it('keeps the development preview without the toggle', () => {
    expect(getHockeyEventCreationPolicy(false, { development: true }).canCreateNewEventGame).toBe(true)
    expect(getHockeyEventCreationPolicy(false, { development: true, releaseStage: 'internal' }).canCreateNewEventGame).toBe(true)
  })

  it('stores the device settings default-off and fails closed on malformed values', () => {
    expect(mergeStoredSettings({}).hockey).toEqual({ eventTrackerEnabled: false, rinkFlippedByDefault: false })
    expect(mergeStoredSettings({ hockey: { rinkFlippedByDefault: true } }).hockey.rinkFlippedByDefault).toBe(true)
    expect(mergeStoredSettings({ hockey: { rinkFlippedByDefault: 1 } }).hockey.rinkFlippedByDefault).toBe(false)
    expect(mergeStoredSettings({}).hockey.eventTrackerEnabled).toBe(false)
    expect(mergeStoredSettings({ hockey: { eventTrackerEnabled: true } }).hockey.eventTrackerEnabled).toBe(true)
    expect(mergeStoredSettings({ hockey: { eventTrackerEnabled: 'true' } }).hockey.eventTrackerEnabled).toBe(false)
    expect(mergeStoredSettings({ hockey: null }).hockey.eventTrackerEnabled).toBe(false)
  })
})

describe('HKY-2E and HKY-6C route gates', () => {
  it('sends the event setup route to the page that applies the policy', () => {
    const app = source('src/App.tsx')
    const setupRoute = app.slice(app.indexOf('function GameSetupRoute()'), app.indexOf('function PlayerSetupRoute()'))
    expect(setupRoute).toContain("requestedSport === 'hockey' && (searchParams.get('events') === '1' || hockeyNewGamesUseEventTracker(hockeyEventTrackerEnabled))")
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

  it('sends new Hockey games from every entry point to the event setup once released', () => {
    expect(source('src/pages/SportDashboard.tsx')).toContain("sport.id === 'hockey' && hockeyNewGamesUseEventTracker(hockeyEventTrackerEnabled)")
    const teamInfo = source('src/pages/TeamInfo.tsx')
    expect(teamInfo).toContain("sport.id === 'hockey' && hockeyNewGamesUseEventTracker(hockeyEventTrackerEnabled)")
    expect(teamInfo).toContain('navigate(`${gameSetupPath(team.id, sport.id)}&events=1`)')
    // A team-only /setup link resolves the team's sport, then hands Hockey to the event setup.
    const gameSetup = source('src/pages/GameSetup.tsx')
    expect(gameSetup).toContain("requestedSport.id === 'hockey' && requestedTeamId && hockeyNewGamesUseEventTracker(hockeyEventTrackerEnabled)")
    expect(gameSetup.indexOf("requestedSport.id === 'hockey' && requestedTeamId")).toBeLessThan(gameSetup.indexOf('if (!startNewGame(requestedSport))'))
  })

  it('seeds the rink orientation default only into the new game\'s display preference', () => {
    const setup = source('src/pages/HockeyGameSetup.tsx')
    expect(setup).toContain('hockeyRinkFlippedByDefault ? setHockeyRinkFlipped(created.state, true) : created.state')
  })

  it('keeps the policy consumers audited', () => {
    const consumers = implementationFiles('src')
      .filter(path => path !== 'src/lib/sportAvailability.ts' && /getHockeyEventCreationPolicy|hockeyNewGamesUseEventTracker/.test(source(path)))
      .sort()
    expect(consumers).toEqual([
      'src/App.tsx',
      'src/components/settings/HockeySettings.tsx',
      'src/pages/GameSetup.tsx',
      'src/pages/HockeyGameSetup.tsx',
      'src/pages/SportDashboard.tsx',
      'src/pages/TeamInfo.tsx',
    ])
  })
})
