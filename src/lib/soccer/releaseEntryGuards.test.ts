import { readFileSync, readdirSync } from 'node:fs'
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

function sourceFiles(directory: string): string[] {
  return readdirSync(resolve(process.cwd(), directory), { withFileTypes: true })
    .flatMap(entry => {
      const path = `${directory}/${entry.name}`
      return entry.isDirectory() ? sourceFiles(path) : [path]
    })
    .filter(path =>
      /\.(ts|tsx)$/.test(path) &&
      !path.endsWith('.test.ts') &&
      !path.endsWith('.test.tsx')
    )
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

  it('keeps direct development checks limited to centralized policy and diagnostics', () => {
    // Extend this allowlist only for dev diagnostics, never feature availability decisions.
    const directChecks = Object.fromEntries(
      sourceFiles('src')
        .map(path => [
          path,
          source(path).split('import.meta.env.DEV').length - 1,
        ] as const)
        .filter(([, count]) => count > 0)
    )

    expect(directChecks).toEqual({
      'src/App.tsx': 2,
      'src/lib/soccer/aggregateTransport.ts': 1,
      'src/lib/sportAvailability.ts': 1,
    })
    expect(source('src/App.tsx')).toContain('/dev/shot-chart')
    expect(source('src/lib/soccer/aggregateTransport.ts')).toContain(
      '[StatKeeper] Soccer aggregate load'
    )
  })

  it('preflights Team Info cloud starts before confirmation or game mutation', () => {
    const teamInfo = source('src/pages/TeamInfo.tsx')
    const handler = between(teamInfo, 'const handleStartGame = async () => {', '\n  useEffect(')
    const capabilityIndex = handler.indexOf('await ensureSoccerReleaseCapabilities')
    expect(capabilityIndex).toBeGreaterThanOrEqual(0)
    expect(capabilityIndex).toBeLessThan(handler.indexOf('prepareActiveGameMutation'))
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
    expect(capabilityIndex).toBeLessThan(loader.indexOf('prepareActiveGameMutation'))
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
