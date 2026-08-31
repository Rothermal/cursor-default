import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PWA_MAX_PRECACHE_ASSET_BYTES } from '../pwaBuildPolicy'

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')

function implementationSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return implementationSourceFiles(path)
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) return []
    return [relative(process.cwd(), path).replace(/\\/g, '/')]
  })
}

function implementationConsumers(symbol: string): string[] {
  return implementationSourceFiles(resolve(process.cwd(), 'src'))
    .filter(path => path !== 'src/lib/sportAvailability.ts' && source(path).includes(symbol))
    .sort()
}

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
    const releaseCapabilityIndex = handler.indexOf('await ensureBasketballReleaseCapabilities')
    const clockCapabilityIndex = handler.indexOf('await ensureBasketballClockLineupCapabilities')

    expect(releaseCapabilityIndex).toBeGreaterThanOrEqual(0)
    expect(clockCapabilityIndex).toBeGreaterThan(releaseCapabilityIndex)
    for (const mutation of [
      'prepareActiveGameMutation',
      'startNewGame(sport)',
      ".from('tournaments')",
      "type: 'SET_CLOUD_SYNC_STATE'",
      "type: 'SET_GAME_INFO'",
    ]) {
      expect(clockCapabilityIndex).toBeLessThan(handler.indexOf(mutation))
    }
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

  it('can return a local-only draft to automatic without resetting rule overrides', () => {
    const setup = source('src/pages/GameSetup.tsx')
    const policyControl = between(
      setup,
      'aria-label="Basketball cloud policy"',
      '\n                  </div>\n                </div>'
    )

    expect(policyControl).toContain('Automatic Cloud')
    expect(policyControl).toContain("setBasketballCloudIntent('automatic')")
    expect(policyControl).not.toContain('setBasketballMatchOverrides')
    expect(policyControl).not.toContain('disabled={anchoredBasketballSetup}')
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
      '\n    if (hasActiveGame && !prepareActiveGameMutation'
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
      "hasActiveGame && !prepareActiveGameMutation('setup_replace_commit')"
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

  it('keeps local-only team roster reads separate from cloud roster writes', () => {
    const playerSetup = source('src/pages/PlayerSetup.tsx')
    const addPlayer = between(
      playerSetup,
      'const handleAddPlayer = async () => {',
      '\n\n  const handleRemovePlayer'
    )
    const removePlayer = between(
      playerSetup,
      'const handleRemovePlayer = async (playerId: string) => {',
      '\n\n  const handleKeyDown'
    )

    expect(playerSetup).toContain(
      'const individualPlayers = state.players.filter(player => !isTeamPseudoPlayer(player))'
    )
    expect(playerSetup).toContain('const canReadCloudRoster = Boolean(rosterTeamId')
    expect(playerSetup).toContain('const canWriteCloudRoster = Boolean(cloudTeamId')
    expect(addPlayer).toContain('if (canWriteCloudRoster && cloudTeamId && user)')
    expect(removePlayer).toContain('if (canWriteCloudRoster && cloudTeamId)')
    expect(addPlayer).not.toContain('team_id: rosterTeamId')
    expect(removePlayer).not.toContain(".eq('team_id', rosterTeamId)")
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

  it('keeps every release-policy consumer on an audited allowlist', () => {
    expect(implementationConsumers('getBasketballEventCreationPolicy')).toEqual([
      'src/components/settings/BasketballSettings.tsx',
      'src/context/GameContext.tsx',
      'src/pages/GameSetup.tsx',
    ])
    expect(implementationConsumers('getSportAvailabilityPolicy')).toEqual([
      'src/pages/Admin.tsx',
      'src/pages/GameSetup.tsx',
      'src/pages/SoccerGameSetup.tsx',
      'src/pages/SportDashboard.tsx',
      'src/pages/SportSelect.tsx',
      'src/pages/TeamInfo.tsx',
      'src/pages/Teams.tsx',
    ])
  })

  it('rechecks Event creation before capability, parking, tournament, or commit mutation', () => {
    const setup = source('src/pages/GameSetup.tsx')
    const context = source('src/context/GameContext.tsx')
    const parking = source('src/lib/gameParking.ts')
    const handler = between(setup, 'const handleNext = async (', '\n  return (')
    const guardIndex = handler.indexOf('canCommitBasketballSetup({')

    expect(guardIndex).toBeGreaterThanOrEqual(0)
    expect(guardIndex).toBeLessThan(handler.indexOf('await ensureBasketballReleaseCapabilities'))
    expect(guardIndex).toBeLessThan(handler.indexOf('await ensureBasketballClockLineupCapabilities'))
    expect(guardIndex).toBeLessThan(handler.indexOf('prepareActiveGameMutation'))
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
    expect(auth).toContain('clearBasketballClockLineupCapabilityCache()')
    expect(auth).toContain('capabilityUserId.current !== nextUserId')
    const signOut = between(auth, 'const signOut = useCallback(async () => {', '\n  return (')
    expect(signOut).toContain('clearBasketballReleaseCapabilityCache()')
    expect(signOut).toContain('clearBasketballClockLineupCapabilityCache()')
  })

  it('rejects stale-account Basketball cloud adoption before local hydration', () => {
    const gameInfo = source('src/pages/GameInfo.tsx')
    const games = source('src/pages/Games.tsx')

    expect(gameInfo).toContain('currentUserIdRef.current !== user.id')
    expect(gameInfo.indexOf('currentUserIdRef.current !== user.id')).toBeLessThan(
      gameInfo.indexOf('openGameSnapshot(basketballGame)')
    )
    expect(games).toContain('currentUserIdRef.current !== userId')
    expect(games.indexOf('currentUserIdRef.current !== userId')).toBeLessThan(
      games.indexOf('openGameSnapshot(basketballGame)')
    )
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

  it('keeps one anchored clock strip mounted above both Basketball workspaces', () => {
    const tracker = source('src/pages/GameTracker.tsx')
    const teamRoleHook = source('src/hooks/useTeamRole.ts')
    const clockStrip = source('src/components/basketball/BasketballClockStrip.tsx')
    const lineupSheet = source('src/components/basketball/BasketballLineupSheet.tsx')
    const boundaryReview = source('src/components/basketball/BasketballBoundaryReviewDialog.tsx')
    const eventDetail = source('src/components/basketball/BasketballEventDetailDialog.tsx')
    const timeline = source('src/components/basketball/BasketballTimeline.tsx')
    const stripIndex = tracker.indexOf('<BasketballClockStrip')
    const workspaceIndex = tracker.indexOf('aria-label="Basketball game workspace"')

    expect(stripIndex).toBeGreaterThanOrEqual(0)
    expect(workspaceIndex).toBeGreaterThan(stripIndex)
    expect(clockStrip).toContain('deriveBasketballClockDisplay')
    expect(clockStrip).toContain('window.setInterval(() => setNow(')
    expect(clockStrip).toContain('Review lineup')
    expect(clockStrip).toContain('<BasketballBoundaryReviewDialog')
    expect(clockStrip).toContain('confirmBasketballBoundaryLineup(stateRef.current')
    expect(clockStrip.indexOf('if (pendingSides.length > 0)')).toBeLessThan(
      clockStrip.indexOf('startBasketballClock(stateRef.current')
    )
    expect(boundaryReview).toContain('Confirm current five')
    expect(boundaryReview).toContain('Your current role cannot record this equal-play override.')
    expect(boundaryReview).toContain('Confirm current five unavailable.')
    expect(boundaryReview).toContain('<BasketballLineupSheet')
    expect(clockStrip).toContain('<BasketballLineupSheet')
    expect(clockStrip).toContain('updateBasketballLineup(stateRef.current')
    expect(clockStrip).toContain('disabled={Boolean(lineupDisabledReason)}')
    expect(clockStrip).toContain('Set the clock before changing the lineup.')
    expect(clockStrip).toContain('aria-label={lineupDisabledReason')
    expect(clockStrip).not.toContain('Substitutions arrive in BKE-6C')
    expect(lineupSheet).toContain('buildBasketballLineupSheetModel')
    expect(lineupSheet).toContain("substitutionMode: purpose === 'boundary'")
    expect(lineupSheet).toContain("'current_lineup_recovery'")
    expect(lineupSheet).toContain('Roles and captain')
    expect(lineupSheet).toContain('reasonCode: model.reasonRequired ? reasonCode : null')
    expect(lineupSheet).toContain('role="dialog"')
    expect(lineupSheet).toContain("event.key === 'Escape'")
    expect(clockStrip).not.toContain('lazy(() => import(')
    expect(tracker).toContain('basketballEqualPlayAuthorityTeamId(state)')
    expect(tracker).toContain('useTeamRole(\n    equalPlayAuthorityTeamId === state.cloudSync.teamId')
    expect(tracker).toContain(
      'canAuthorizeBasketballEqualPlayOverride(state, equalPlayAccess)'
    )
    expect(teamRoleHook).toContain('}, [isConfigured, teamId, userId])')
    expect(boundaryReview).not.toContain('fallback={null}')
    expect(eventDetail).toContain('participantLabel(change.participantId)')
    expect(eventDetail).not.toContain('`${change.participantId}:')
    expect(timeline).toContain("state.sportGameState.projection.participants[participantId]")
  })

  it('keeps lineup correction in Timeline and older Recent Events routed there', () => {
    const timeline = source('src/components/basketball/BasketballTimeline.tsx')
    const editor = source('src/components/basketball/BasketballLineupCorrectionEditor.tsx')
    const recent = source('src/components/basketball/BasketballRecentEventsPopup.tsx')
    const tracker = source('src/pages/GameTracker.tsx')
    const projector = source('src/lib/basketball/projector.ts')

    expect(timeline).toContain('<BasketballLineupCorrectionEditor')
    expect(timeline).toContain("scope: 'capture_group'")
    expect(editor).toContain('previewBasketballLineupCorrection(state, draft)')
    expect(editor).toContain('applyBasketballLineupCorrection(state, preview)')
    expect(recent).toContain("const openTimeline = !canUndo && unit.kind !== 'boundary'")
    expect(recent).toContain("openTimeline ? 'Timeline' : 'Undo'")
    expect(tracker).toContain("setBasketballWorkspace('timeline')")
    expect(projector).toContain('orderBasketballEventsForProjection(captureOrderedEvents)')
  })

  it('keeps BKE-6D1 Summary review isolated and duration formatting centralized', () => {
    const summary = source('src/pages/BasketballSummary.tsx')
    const clockStatus = source(
      'src/components/basketball-summary/BasketballSummaryClockStatus.tsx'
    )
    const teamStats = source('src/components/basketball-summary/BasketballTeamStats.tsx')
    const aggregate = source('src/lib/basketball/aggregateStats.ts')
    const correction = source('src/lib/basketball/lineupCorrectionCommands.ts')

    expect(summary).toContain('<BasketballSummaryClockStatus source={source} />')
    expect(clockStatus).toContain('deriveBasketballClockDisplay')
    expect(clockStatus).toContain('remote display')
    expect(clockStatus).not.toContain('useGame(')
    expect(clockStatus).not.toContain('dispatch(')
    expect(teamStats).toContain("quality.clockModel === 'anchored'")
    expect(teamStats).toContain('<LineupRows name={trackedName}')
    expect(aggregate).toContain('formatBasketballDurationSeconds')
    expect(correction).toContain('formatBasketballDurationMs')
    expect(correction).not.toContain('Math.round(valueMs / 1_000)')
  })

  it('keeps the courtside production shell under an explicit offline precache budget', () => {
    const viteConfig = source('vite.config.ts')

    expect(PWA_MAX_PRECACHE_ASSET_BYTES).toBe(3 * 1024 * 1024)
    expect(viteConfig).toContain('maximumFileSizeToCacheInBytes: PWA_MAX_PRECACHE_ASSET_BYTES')
    expect(viteConfig).toContain("globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']")
  })

  it('keeps anchored display ticks presentation-only and hides manual-minute capture', () => {
    const tracker = source('src/pages/GameTracker.tsx')
    const clockStrip = source('src/components/basketball/BasketballClockStrip.tsx')
    const displayTimer = between(
      clockStrip,
      'useEffect(() => {\n    if (!clock?.running) return',
      '\n  }, [clock?.running, clock?.lastStartEventId])'
    )

    expect(displayTimer).toContain('setNow(new Date().toISOString())')
    expect(displayTimer).not.toContain('onState(')
    expect(displayTimer).not.toContain('dispatch(')
    expect(tracker).toContain("basketballSportState?.projection.clock && action.id === 'min'")
  })

  it('centralizes park and replacement preparation before active-game mutation', () => {
    const context = source('src/context/GameContext.tsx')
    const policy = source('src/lib/basketball/productionClockPolicy.ts')
    const guardedPages = [
      'src/pages/BasketballSummary.tsx',
      'src/pages/CareerStats.tsx',
      'src/pages/Games.tsx',
      'src/pages/GameInfo.tsx',
      'src/pages/GameSetup.tsx',
      'src/pages/GameSummary.tsx',
      'src/pages/PlayerProfile.tsx',
      'src/pages/SoccerSummary.tsx',
      'src/pages/SportDashboard.tsx',
      'src/pages/TeamInfo.tsx',
    ].map(source)

    expect(context).toContain('const prepareActiveGameMutation = useCallback(')
    expect(context).toContain("'The Basketball clock is running. Pause and continue?'")
    expect(context).toContain("if (action === 'reload_commit' && !runningClock) return true")
    expect(context).toContain('pauseRunningBasketballClockForWorkflow(current, action')
    expect(context.indexOf('saveActiveGameState(paused.state, userId)'))
      .toBeLessThan(context.indexOf("dispatch({ type: 'HYDRATE_STATE', state: paused.state })"))
    expect(context).toContain('blockUnpreparedRunningClock')
    expect(policy).toContain("basketballWorkflowActionKind(action) === 'park_or_replace'")
    expect(guardedPages.every(page => page.includes('prepareActiveGameMutation'))).toBe(true)
  })

  it('keeps deployed build identity and PWA updates operator-verifiable', () => {
    const viteConfig = source('vite.config.ts')
    const deploy = source('.github/workflows/deploy.yml')
    const shell = source('src/components/AppShell.tsx')
    const status = source('src/components/PwaStatus.tsx')
    const css = source('src/index.css')
    const releasePlan = source('docs/PLAN_BKE_6E_RELEASE_HARDENING.md')
    const releaseMatrix = source('docs/REGRESSION_BKE_6E_RELEASE.md')
    const applyUpdate = between(
      status,
      'const applyUpdate = async () => {',
      '\n  }\n\n  if (!needRefresh'
    )

    expect(viteConfig).toContain("registerType: 'prompt'")
    expect(viteConfig).not.toContain("registerType: 'autoUpdate'")
    expect(deploy).toContain('VITE_APP_BUILD_ID: ${{ github.sha }}')
    expect(shell).toContain('APP_BUILD_ID, APP_BUILD_LABEL')
    expect(shell).toContain('aria-label={`Build ${APP_BUILD_ID}`}')
    expect(status).toContain("useRegisterSW({\n    immediate: true")
    expect(status).toContain('Existing games remain saved.')
    expect(status).toContain('stays active until you choose Update')
    expect(status).toContain('const [offlineDismissed, setOfflineDismissed] = useState(false)')
    expect(status).toContain('setOfflineDismissed(false)')
    expect(status).toContain('if (!online) setOfflineDismissed(true)')
    expect(status).toContain('(online || offlineDismissed)')
    expect(status).toContain("pathname === '/game'")
    expect(css).toContain('.pwa-status-game-offset')
    expect(releasePlan).toContain('loading or refreshing is not sufficient')
    expect(releaseMatrix).toContain('refresh alone is not sufficient')
    expect(applyUpdate.indexOf("prepareActiveGameMutation('reload_commit')"))
      .toBeLessThan(applyUpdate.indexOf('updateServiceWorker(true)'))
  })

  it('pins compact, reduced-motion, safe-area, and modal-focus release contracts', () => {
    const css = source('src/index.css')
    const clock = source('src/components/basketball/BasketballClockStrip.tsx')
    const tracker = source('src/pages/GameTracker.tsx')
    const confirmation = source('src/components/ConfirmDialog.tsx')
    const shotDetail = source('src/components/basketball/BasketballShotDetailDialog.tsx')
    const modalFocus = source('src/hooks/useModalFocus.ts')

    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('.safe-top')
    expect(css).toContain('.safe-bottom')
    expect(clock).toContain('grid grid-cols-3 gap-1.5 sm:gap-2')
    expect(clock).toContain('safe-top')
    expect(tracker).toContain('safe-bottom')
    expect(confirmation).toContain('useModalFocus({')
    expect(shotDetail).toContain('useModalFocus({')
    expect(modalFocus).toContain("if (event.key === 'Escape')")
    expect(modalFocus).toContain("if (event.key !== 'Tab') return")
    expect(modalFocus).toContain('previouslyFocused?.isConnected')
  })
})
