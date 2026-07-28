import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8')

function between(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start)
  const endIndex = value.indexOf(end, startIndex + start.length)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return value.slice(startIndex, endIndex)
}

describe('SOC-6E1 release entry guards', () => {
  it('keeps existing Soccer routes independent of development mode', () => {
    const app = source('src/App.tsx')
    const routeComponents = between(app, 'function GameSetupRoute()', 'function AppRoutes()')
    expect(routeComponents).not.toContain('import.meta.env.DEV')
    expect(app).toContain('<Route path="/soccer/review" element={<SoccerCloudReview />} />')
    expect(source('src/pages/Games.tsx')).not.toContain('import.meta.env.DEV')
    expect(source('src/pages/GameInfo.tsx')).not.toContain('import.meta.env.DEV')
  })

  it('preflights Team Info cloud starts before confirmation or game mutation', () => {
    const teamInfo = source('src/pages/TeamInfo.tsx')
    const handler = between(teamInfo, 'const handleStartGame = async () => {', '\n  useEffect(')
    const capabilityIndex = handler.indexOf('await ensureSoccerReleaseCapabilities')
    expect(capabilityIndex).toBeGreaterThanOrEqual(0)
    expect(capabilityIndex).toBeLessThan(handler.indexOf('window.confirm'))
    expect(capabilityIndex).toBeLessThan(handler.indexOf('startNewGame(sport)'))
  })

  it('preflights team deep links before active-game confirmation or replacement', () => {
    const setup = source('src/pages/GameSetup.tsx')
    const loader = between(
      setup,
      'const loadRequestedTeamSport = async () => {',
      '\n    void loadRequestedTeamSport()'
    )
    const capabilityIndex = loader.indexOf('await ensureSoccerReleaseCapabilities')
    expect(capabilityIndex).toBeGreaterThanOrEqual(0)
    expect(capabilityIndex).toBeLessThan(loader.indexOf('window.confirm'))
    expect(capabilityIndex).toBeLessThan(loader.indexOf('startNewGame(requestedSport)'))
  })

  it('blocks cloud-source continuation before setup dispatches', () => {
    const setup = source('src/pages/SoccerGameSetup.tsx')
    const handler = between(setup, 'const handleContinue = () => {', '  return (')
    const capabilityIndex = handler.indexOf("capabilityState.status !== 'ready'")
    expect(capabilityIndex).toBeGreaterThanOrEqual(0)
    expect(capabilityIndex).toBeLessThan(handler.indexOf("type: 'SET_CLOUD_SYNC_STATE'"))
    expect(setup).toContain('Use Local Match')
  })

  it('forces only an explicit capability retry and restores normal session caching', () => {
    const setup = source('src/pages/SoccerGameSetup.tsx')
    expect(setup).toContain('const force = forceCapabilityCheck.current')
    expect(setup).toContain('forceCapabilityCheck.current = false')
    expect(setup).not.toContain('force: capabilityAttempt > 0')
  })
})
