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

describe('BKE-4E5 release entry guards', () => {
  it('preflights internal event-cloud continuation before game mutation', () => {
    const setup = source('src/pages/GameSetup.tsx')
    const handler = between(setup, 'const handleNext = async () => {', '\n  return (')
    const capabilityIndex = handler.indexOf('await ensureBasketballReleaseCapabilities')

    expect(capabilityIndex).toBeGreaterThanOrEqual(0)
    expect(capabilityIndex).toBeLessThan(handler.indexOf('window.confirm'))
    expect(capabilityIndex).toBeLessThan(handler.indexOf('startNewGame(sport)'))
    expect(capabilityIndex).toBeLessThan(handler.indexOf(".from('tournaments')"))
    expect(capabilityIndex).toBeLessThan(handler.indexOf("type: 'SET_CLOUD_SYNC_STATE'"))
    expect(capabilityIndex).toBeLessThan(handler.indexOf("type: 'SET_GAME_INFO'"))
  })

  it('preflights Team Info starts before confirmation or game mutation', () => {
    const teamInfo = source('src/pages/TeamInfo.tsx')
    const handler = between(teamInfo, 'const handleStartGame = async () => {', '\n  useEffect(')
    const capabilityIndex = handler.indexOf('await ensureBasketballReleaseCapabilities')

    expect(capabilityIndex).toBeGreaterThanOrEqual(0)
    expect(capabilityIndex).toBeLessThan(handler.indexOf('window.confirm'))
    expect(capabilityIndex).toBeLessThan(handler.indexOf('startNewGame(sport)'))
    expect(capabilityIndex).toBeLessThan(handler.indexOf("type: 'SET_CLOUD_SYNC_STATE'"))
  })

  it('preflights team deep links before active-game confirmation or replacement', () => {
    const setup = source('src/pages/GameSetup.tsx')
    const loader = between(
      setup,
      'const loadRequestedTeamSport = async () => {',
      '\n    void loadRequestedTeamSport()'
    )
    const capabilityIndex = loader.indexOf('await ensureBasketballReleaseCapabilities')

    expect(capabilityIndex).toBeGreaterThanOrEqual(0)
    expect(capabilityIndex).toBeLessThan(loader.indexOf('window.confirm'))
    expect(capabilityIndex).toBeLessThan(loader.indexOf('startNewGame(requestedSport)'))
  })

  it('keeps the internal creation gate closed outside development policy', () => {
    const policy = source('src/lib/sportAvailability.ts')
    expect(policy).toContain(
      'export function isBasketballEventModelCreationAvailable('
    )
    expect(policy).toContain('return development')
  })

  it('clears Basketball capability success when the auth account changes', () => {
    const auth = source('src/context/AuthContext.tsx')
    expect(auth).toContain('clearBasketballReleaseCapabilityCache()')
    expect(auth).toContain('capabilityUserId.current !== nextUserId')
    const signOut = between(auth, 'const signOut = useCallback(async () => {', '\n  return (')
    expect(signOut).toContain('clearBasketballReleaseCapabilityCache()')
  })
})
