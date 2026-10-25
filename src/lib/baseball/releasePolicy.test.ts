import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeStoredSettings } from '../settingsStorage'
import { getBaseballEventCreationPolicy, SPORT_EVENT_RELEASE_STAGES } from '../sportAvailability'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

function section(path: string, start: string, end: string): string {
  const text = source(path), from = text.indexOf(start), to = text.indexOf(end, from + start.length)
  expect(from).toBeGreaterThanOrEqual(0)
  expect(to).toBeGreaterThan(from)
  return text.slice(from, to)
}

function implementationFiles(directory: string): string[] {
  return readdirSync(resolve(process.cwd(), directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return implementationFiles(path)
    return /\.tsx?$/.test(path) && !path.includes('.test.') ? [path] : []
  })
}

describe('BSB-7D Baseball event-only release', () => {
  it('ships event-only creation independently of sport discovery', () => {
    expect(getBaseballEventCreationPolicy().releaseStage).toBe('released')
    expect(SPORT_EVENT_RELEASE_STAGES).not.toHaveProperty('baseball')
  })

  it('uses only the creation switch and keeps existing games reachable', () => {
    expect(getBaseballEventCreationPolicy()).toEqual({
      releaseStage: 'released',
      preferenceAvailable: false,
      canCreateNewEventGame: true,
      canAccessExistingEventGames: true,
    })
    expect(getBaseballEventCreationPolicy({ creationEnabled: true }).canCreateNewEventGame).toBe(true)
  })

  it('rolls back new creation without restoring opt-in or gating existing games', () => {
    const internal = getBaseballEventCreationPolicy({ creationEnabled: false })
    expect(internal.preferenceAvailable).toBe(false)
    expect(internal.canCreateNewEventGame).toBe(false)
    expect(internal.canAccessExistingEventGames).toBe(true)
  })

  it('exposes no preview or development override of creation rollback', () => {
    const policy = source('src/lib/sportAvailability.ts').split('export function getBaseballEventCreationPolicy(')[1].split('export function getSportAvailabilityPolicy')[0]
    expect(policy).not.toMatch(/enabledOnDevice|development|SportEventCreationPolicyOptions/)
    expect(getBaseballEventCreationPolicy({ creationEnabled: false }).canCreateNewEventGame).toBe(false)
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
    expect(setupRoute).not.toContain('eventsRequested')
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

  it('redirects retired Baseball before mounting the generic tracker, roster or checkout', () => {
    const tracker = section('src/App.tsx', 'function GameTrackerRoute()', 'function GameCheckoutRoute()')
    expect(tracker).toContain("if (state.sport?.id === 'baseball') return isLegacyBaseballGame(state)")
    expect(tracker).toContain('? <Navigate to="/summary" replace /> : <BaseballGameTracker />')
    for (const [start, end] of [['function PlayerSetupRoute()', 'function GameTrackerRoute()'], ['function GameCheckoutRoute()', 'function GameSummaryRoute()']]) {
      expect(section('src/App.tsx', start, end)).toContain("isLegacyBaseballGame(state) ? '/summary' : '/game'")
    }
  })

  it('pins both Summary handler refusals independently of their hidden controls', () => {
    const summary = source('src/pages/GameSummary.tsx')
    expect(summary).toContain('const mayCorrect = !legacyReadOnly && isTeamAdmin')
    const primary = section('src/pages/GameSummary.tsx', 'const handleSetPrimaryRecorder = async', '\n  useEffect(')
    expect(primary).toContain('if (legacyReadOnly || !gameId || !supabase) return')
    expect(primary.indexOf('if (legacyReadOnly')).toBeLessThan(primary.indexOf("supabase.rpc('set_primary_recorder'"))
    const correction = section('src/pages/GameSummary.tsx', 'const handleSaveCorrection = async', '\n  return (')
    expect(correction).toContain('if (legacyReadOnly || !correcting || !gameId || !user || !supabase) return')
    expect(correction.indexOf('if (legacyReadOnly')).toBeLessThan(correction.indexOf(".from('stat_corrections')"))
  })

  it.each([
    ['const startEditOpponentName = async', 'const cancelEditOpponentName =', 'setEditingGameId(game.id)'],
    ['const handleSaveOpponentName = async', 'const handleDeleteGame = async', '.update({ opponent_name: name })'],
  ])('pins the cloud rename authority refusal in %s', (start, end, mutation) => {
    const handler = section('src/pages/Games.tsx', start, end)
    expect(handler).toContain('if (isRetiredLegacySport(sportId))')
    expect(handler).toContain("sportId === 'baseball' ? loadBaseballCloudDataAuthority : sportId === 'hockey' ? loadHockeyCloudDataAuthority : loadBasketballCloudDataAuthority")
    expect(handler).toContain("if (authority !== 'sport_events')")
    expect(handler).toContain('games are read-only.')
    expect(handler.indexOf("if (authority !== 'sport_events')")).toBeLessThan(handler.indexOf(mutation))
  })
})
