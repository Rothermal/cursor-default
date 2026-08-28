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
    const handler = between(setup, 'const handleNext = async (', '\n  return (')
    const capabilityIndex = handler.indexOf('await ensureBasketballReleaseCapabilities')

    expect(capabilityIndex).toBeGreaterThanOrEqual(0)
    expect(capabilityIndex).toBeLessThan(handler.indexOf('window.confirm'))
    expect(capabilityIndex).toBeLessThan(handler.indexOf('startNewGame(sport)'))
    expect(capabilityIndex).toBeLessThan(handler.indexOf(".from('tournaments')"))
    expect(capabilityIndex).toBeLessThan(handler.indexOf("type: 'SET_CLOUD_SYNC_STATE'"))
    expect(capabilityIndex).toBeLessThan(handler.indexOf("type: 'SET_GAME_INFO'"))
  })

  it('offers the complete capability recovery matrix without committing setup', () => {
    const setup = source('src/pages/GameSetup.tsx')
    const recovery = between(
      setup,
      'basketballCapabilityFailure && (',
      '\n\n              {teams.length > 0 && ('
    )

    expect(recovery).toContain('Retry Check')
    expect(recovery).toContain('Use Legacy Cloud')
    expect(recovery).toContain('Use Event Local-Only')
    expect(recovery).toContain('Cancel')
    expect(recovery).toContain('onClick={handleCancelSetup}')
    expect(recovery).toContain("setBasketballCloudIntent('local_only')")
  })

  it('can return a local-only team draft to automatic without resetting rule overrides', () => {
    const setup = source('src/pages/GameSetup.tsx')
    const policyControl = between(
      setup,
      'aria-label="Basketball cloud policy"',
      '\n                  {anchoredBasketballSetup'
    )

    expect(policyControl).toContain('Automatic Cloud')
    expect(policyControl).toContain("setBasketballCloudIntent('automatic')")
    expect(policyControl).not.toContain('setBasketballMatchOverrides')
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
    const handler = between(setup, 'const handleNext = async (', '\n  async function compensate')

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
    expect(playerSetup).toContain('rulesSnapshot: preparedDraft.event!.reviewedRules')
    expect(playerSetup).toContain('rulesSource: preparedDraft.event!.reviewedRulesSource')
    expect(playerSetup).toContain('version3Setup,')
  })

  it('applies the per-game orientation to every game-specific Basketball court', () => {
    const livePanel = source('src/components/shot-chart/ShotChartPanel.tsx')
    const shotEditor = source('src/components/basketball/BasketballShotEditor.tsx')
    const historicalEditor = source('src/components/basketball/BasketballHistoricalShotEditor.tsx')
    const eventReview = source('src/components/basketball-summary/BasketballShotReview.tsx')
    const legacyReview = source('src/pages/game-summary/GameSummaryShotChartPanel.tsx')

    expect(livePanel).toContain("flipped={courtOrientation === 'flipped'}")
    expect(shotEditor).toContain('flipped={basketballCourtOrientationForState(state)')
    expect(historicalEditor).toContain('flipped={basketballCourtOrientationForState(state)')
    expect(eventReview).toContain('flipped={basketballCourtOrientationForState(source.state)')
    expect(legacyReview).toContain('flipped={flipped}')
  })

  it('centralizes the Event release stage separately from sport availability', () => {
    const policy = source('src/lib/sportAvailability.ts')
    const wholeSportPolicy = between(
      policy,
      'export interface SportAvailabilityPolicy {',
      '\n}'
    )
    expect(policy).toMatch(
      /export const BASKETBALL_EVENT_RELEASE_STAGE = '(internal|opt_in)' as const/
    )
    expect(policy).toContain('export type BasketballEventReleaseStage')
    expect(policy).toContain('export function getBasketballEventCreationPolicy(')
    expect(wholeSportPolicy).not.toContain('Basketball')
    expect(wholeSportPolicy).not.toContain('releaseStage?:')
  })

  it('rechecks Event creation before capability, parking, tournament, or commit mutation', () => {
    const setup = source('src/pages/GameSetup.tsx')
    const context = source('src/context/GameContext.tsx')
    const parking = source('src/lib/gameParking.ts')
    const handler = between(setup, 'const handleNext = async (', '\n  return (')
    const guardIndex = handler.indexOf('canCommitBasketballSetup({')

    expect(guardIndex).toBeGreaterThanOrEqual(0)
    expect(guardIndex).toBeLessThan(handler.indexOf('await ensureBasketballReleaseCapabilities'))
    expect(guardIndex).toBeLessThan(handler.indexOf('window.confirm'))
    expect(guardIndex).toBeLessThan(handler.indexOf(".from('tournaments')"))
    expect(guardIndex).toBeLessThan(handler.indexOf('commitGameSetup('))
    expect(context).toContain('loadSettingsFromStorage().basketball.eventTrackerPreviewEnabled')
    expect(context).toContain('Persisted state is authoritative here')
    expect(context).toContain(').canCreateNewEventGame')
    expect(parking).toContain('allowNewBasketballEventGame = false')
    expect(parking).toContain('continuingCommittedBasketballEventSetup')
    expect(parking).toContain('isUninitializedBasketballEventState(nextState)')
  })

  it('keeps the rollout preference outside cloud-backed Basketball settings saves', () => {
    const context = source('src/context/SettingsContext.tsx')
    const settings = source('src/components/settings/BasketballSettings.tsx')

    expect(context).toContain('setBasketballEventTrackerPreviewEnabled')
    expect(context).toContain('eventTrackerPreviewEnabled: enabled')
    expect(settings).toContain('New event tracker (preview)')
    expect(settings).toContain('disabled={!eventCreationPolicy.preferenceAvailable}')
    expect(settings).toContain('{!trackerTabActive && (')
  })

  it('clears Basketball capability success when the auth account changes', () => {
    const auth = source('src/context/AuthContext.tsx')
    expect(auth).toContain('clearBasketballReleaseCapabilityCache()')
    expect(auth).toContain('capabilityUserId.current !== nextUserId')
    const signOut = between(auth, 'const signOut = useCallback(async () => {', '\n  return (')
    expect(signOut).toContain('clearBasketballReleaseCapabilityCache()')
  })

  it('commits later cloud enablement only after the guarded transport succeeds', () => {
    const panel = source('src/components/basketball/BasketballEnableCloudPanel.tsx')
    const summary = source('src/pages/BasketballSummary.tsx')
    const context = source('src/context/GameContext.tsx')
    const handler = between(
      context,
      'const enableBasketballCloudSync = useCallback(',
      '\n\n  const markEventCloudGameReopened'
    )
    const transportIndex = handler.indexOf('await enableBasketballEventCloud')
    const persistIndex = handler.indexOf('saveParkedGameRecordStateAtomically')
    const hydrateIndex = handler.indexOf("dispatch({ type: 'HYDRATE_STATE'")

    expect(panel).toContain('canOfferBasketballEventCloudEnable')
    expect(panel).toContain('Enable Cloud Sync')
    expect(panel).toContain('Keep Local Only')
    expect(summary).toContain("source.kind === 'local' && healthy")
    expect(summary).toContain('<BasketballEnableCloudPanel state={state} />')
    expect(transportIndex).toBeGreaterThanOrEqual(0)
    expect(persistIndex).toBeGreaterThan(transportIndex)
    expect(hydrateIndex).toBeGreaterThan(persistIndex)
    expect(handler).toContain('Another local game already owns this cloud Basketball game.')
  })
})
