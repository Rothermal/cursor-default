import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')

function between(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start)
  const endIndex = value.indexOf(end, startIndex + start.length)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return value.slice(startIndex, endIndex)
}

describe('Basketball release entry guards', () => {
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

  it('keeps Basketball Team Info entry mutation-free until setup Continue', () => {
    const teamInfo = source('src/pages/TeamInfo.tsx')
    const handler = between(teamInfo, 'const handleStartGame = async () => {', '\n  useEffect(')
    const basketballEntry = between(
      handler,
      "if (sport.id === 'basketball') {",
      '\n    const hasActiveGame'
    )

    expect(basketballEntry).toContain("navigate(gameSetupPath(team.id, sport.id))")
    expect(basketballEntry).not.toContain('ensureBasketballReleaseCapabilities')
    expect(basketballEntry).not.toContain('startNewGame')
    expect(basketballEntry).not.toContain('SET_CLOUD_SYNC_STATE')
  })

  it('resolves Basketball team deep links without preflight or active-game replacement', () => {
    const setup = source('src/pages/GameSetup.tsx')
    const loader = between(
      setup,
      'const loadRequestedTeamSport = async () => {',
      '\n    void loadRequestedTeamSport()'
    )
    const basketballEntry = between(
      loader,
      "if (requestedSport.id === 'basketball') {",
      '\n      const hasActiveGame'
    )

    expect(basketballEntry).toContain('setLoadingRequestedTeamSport(false)')
    expect(basketballEntry).not.toContain('ensureBasketballReleaseCapabilities')
    expect(basketballEntry).not.toContain('window.confirm')
    expect(basketballEntry).not.toContain('startNewGame')
  })

  it('keeps Basketball Sport Dashboard entry mutation-free', () => {
    const dashboard = source('src/pages/SportDashboard.tsx')
    const handler = between(dashboard, 'const handleStartNew = () => {', '\n  const handleResumeParked')
    const basketballEntry = between(
      handler,
      "if (sport.id === 'basketball') {",
      '\n    if (\n      hasActiveGame'
    )

    expect(basketballEntry).toContain("navigate('/setup?sport=basketball')")
    expect(basketballEntry).not.toContain('startNewGame')
  })

  it('persists Basketball edits as a draft and commits through one context command', () => {
    const setup = source('src/pages/GameSetup.tsx')
    const eventIntent = between(
      setup,
      'const updateBasketballEventIntent = (enabled: boolean): boolean => {',
      '\n  const updateTeamMode'
    )
    const handler = between(setup, 'const handleNext = async () => {', '\n  async function compensate')

    expect(eventIntent).toContain('setBasketballAuthority')
    expect(eventIntent.indexOf('setBasketballAuthority')).toBeLessThan(
      eventIntent.indexOf("dispatch({ type: 'HYDRATE_STATE'")
    )
    expect(setup).toContain('saveBasketballSetupDraft(currentBasketballDraft)')
    expect(handler).toContain('commitGameSetup(')
    expect(handler).toContain(
      "hasActiveGame &&\n        !window.confirm('Park your current game and continue with this Basketball setup?')"
    )
  })

  it('rechecks reviewed rules before Player Setup freezes an event game', () => {
    const playerSetup = source('src/pages/PlayerSetup.tsx')
    const handler = between(
      playerSetup,
      'const handleStart = async () => {',
      '\n  const refreshReviewedDefaults'
    )
    const latestIndex = handler.indexOf('await loadLatestBasketballSetupAuthority')
    const staleIndex = handler.indexOf('basketballSetupEventMatchesAuthority')
    const startIndex = handler.indexOf('startBasketballEventGame(draft)')

    expect(latestIndex).toBeGreaterThanOrEqual(0)
    expect(staleIndex).toBeGreaterThan(latestIndex)
    expect(startIndex).toBeGreaterThan(staleIndex)
    expect(playerSetup).toContain('reviewedSetup: {')
    expect(playerSetup).toContain('rulesSnapshot: draft.event.reviewedRules')
    expect(playerSetup).toContain('rulesSource: draft.event.reviewedRulesSource')
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
