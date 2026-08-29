import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sports } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { useSettings } from '../context/SettingsContext'
import { getDisplayedHomeScore } from '../lib/gameScore'
import {
  isKnownSportId,
  isGameStateForSport,
  isParkedGameForSport,
  parkedSyncLabel,
  routeForResumedGame,
  sportGamesPath,
  sportLeaderboardPath,
  sportTeamsPath,
} from '../lib/sportNavigation'
import { isTeamPseudoPlayer } from '../lib/teamPlayers'
import { getSportAvailabilityPolicy } from '../lib/sportAvailability'
import {
  basketballSetupAccountScope,
  basketballSetupDraftHasMeaningfulEdits,
  basketballSetupDraftMatchesRoute,
  clearBasketballSetupDraft,
  loadBasketballSetupDraft,
} from '../lib/basketball/setupDraft'
import { isBasketballEventLocalOnly } from '../lib/basketball/eventCloudPolicy'

function activeSyncStatusLabel(status: string, lastError: string | null): string | null {
  switch (status) {
    case 'offline':
      return 'Cloud Sync: offline'
    case 'syncing':
      return 'Cloud Sync: syncing...'
    case 'synced':
      return 'Cloud Sync: saved'
    case 'error':
      if (lastError?.includes("Could not find the table 'public.")) {
        return 'Cloud Sync: run migrations'
      }
      if (lastError?.includes('infinite recursion detected in policy')) {
        return 'Cloud Sync: apply 005 migration'
      }
      return 'Cloud Sync: error'
    default:
      return null
  }
}

export default function SportDashboard() {
  const { sportId } = useParams()
  const navigate = useNavigate()
  const { isConfigured, user } = useAuth()
  const { isSportEnabled } = useSettings()
  const {
    state,
    activeLocalGameId,
    parkedGames,
    parkingError,
    clearParkingError,
    prepareActiveGameMutation,
    startNewGame,
    resumeParkedGame,
    discardParkedGame,
  } = useGame()
  const [dashboardError, setDashboardError] = useState<string | null>(null)

  const knownSportIds = sports.map(sport => sport.id)
  const validSportId = isKnownSportId(sportId, knownSportIds) ? sportId : null
  const sport = sports.find(item => item.id === validSportId) ?? null
  const availability = sport
    ? getSportAvailabilityPolicy(sport.id, isSportEnabled(sport.id))
    : null

  const parkedForSport = useMemo(
    () =>
      sport
        ? parkedGames.filter(
            game => game.localGameId !== activeLocalGameId && isParkedGameForSport(game, sport.id)
          )
        : [],
    [activeLocalGameId, parkedGames, sport]
  )

  const hasActiveGame = Boolean(state.sport && activeLocalGameId)
  const hasActiveForSport = Boolean(
    sport && activeLocalGameId && isGameStateForSport(state, sport.id)
  )
  const activeOtherSport = hasActiveGame && sport && state.sport?.id !== sport.id ? state.sport : null

  const liveScoreLine = useMemo(() => {
    if (!hasActiveForSport || !state.sport) return null
    const rosterPlayers = state.players.filter(p => !isTeamPseudoPlayer(p))
    const homeScore = getDisplayedHomeScore(
      state.sport,
      rosterPlayers,
      state.homeTeamScore,
      state.homeScoreAdjustment
    )
    return `${homeScore}-${state.opponentScore}`
  }, [
    hasActiveForSport,
    state.homeScoreAdjustment,
    state.homeTeamScore,
    state.opponentScore,
    state.players,
    state.sport,
  ])

  const handleStartNew = () => {
    if (!sport) return
    setDashboardError(null)
    clearParkingError()
    if (!availability?.canStartNewGame) {
      setDashboardError(
        availability?.releaseStage === 'unreleased'
          ? `${sport.name} is coming soon. Existing matches and cloud history remain available.`
          : `Enable ${sport.name} in Settings before starting a new game.`
      )
      return
    }
    if (sport.id === 'basketball') {
      const scope = basketballSetupAccountScope(user?.id ?? null)
      const existingDraft = loadBasketballSetupDraft(scope)
      if (
        existingDraft &&
        !basketballSetupDraftMatchesRoute(existingDraft, null) &&
        basketballSetupDraftHasMeaningfulEdits(existingDraft) &&
        !window.confirm('Discard the unfinished Basketball team setup and start a local game?')
      ) {
        return
      }
      if (existingDraft && !basketballSetupDraftMatchesRoute(existingDraft, null)) {
        clearBasketballSetupDraft(scope)
      }
      navigate('/setup?sport=basketball')
      return
    }
    if (hasActiveGame && !prepareActiveGameMutation('new_game_commit')) return
    if (!startNewGame(sport)) return
    navigate('/setup')
  }

  const handleResumeParked = (localGameId: string) => {
    setDashboardError(null)
    clearParkingError()
    if (!prepareActiveGameMutation('resume_commit')) return
    const resumed = resumeParkedGame(localGameId)
    if (!resumed) {
      setDashboardError('That parked game could not be loaded.')
      return
    }
    navigate(routeForResumedGame(resumed))
  }

  const handleDiscardParked = (localGameId: string) => {
    setDashboardError(null)
    clearParkingError()
    if (!window.confirm('Discard this parked game? This cannot be undone.')) {
      return
    }
    if (!discardParkedGame(localGameId)) {
      setDashboardError(
        'This parked game has unsynced cloud stats. Resume and sync it before discarding.'
      )
    }
  }

  if (!sport) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <section className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Sport not found</p>
          <p className="text-sm text-slate-500 mb-4">Choose one of the enabled sport workspaces.</p>
          <button type="button" onClick={() => navigate('/')} className="btn-primary w-full">
            Back to Sports
          </button>
        </section>
      </div>
    )
  }

  if (!availability?.discoverable && sport.id !== 'soccer') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <section className="card max-w-md w-full text-center">
          <p className="text-4xl mb-3">{sport.icon}</p>
          <p className="font-semibold text-slate-700 mb-2">{sport.name} is disabled</p>
          <p className="text-sm text-slate-500 mb-4">
            Enable this sport in Settings before starting or managing games.
          </p>
          <button type="button" onClick={() => navigate('/settings/app')} className="btn-primary w-full">
            Open Settings
          </button>
        </section>
      </div>
    )
  }

  const activeSyncLabel = isBasketballEventLocalOnly(state) && state.cloudSync.status !== 'error'
    ? 'Cloud Sync: local only'
    : activeSyncStatusLabel(state.cloudSync.status, state.cloudSync.lastError)

  return (
    <div className="min-h-screen flex flex-col">
      <header className={`bg-gradient-to-r ${sport.theme.gradient} text-white px-4 py-5`}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="h-8 rounded-full bg-white/20 px-3 text-xs font-semibold flex items-center justify-center active:scale-90 transition-transform"
            aria-label="Back to sports"
          >
            Back
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">
              {sport.icon} {sport.name}
            </h1>
            <p className="text-sm opacity-85">Sport dashboard</p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-4">
        {!availability?.canStartNewGame && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">
              {availability?.releaseStage === 'unreleased'
                ? `${sport.name} is coming soon`
                : `${sport.name} is disabled`}
            </p>
            <p className="text-xs text-amber-800 mt-1">
              Existing local matches and cloud history remain available. New matches are disabled.
            </p>
            {availability?.toggleAvailable && (
              <button
                type="button"
                onClick={() => navigate('/settings/app')}
                className="mt-2 text-xs font-semibold text-amber-900 underline"
              >
                Open Settings
              </button>
            )}
          </section>
        )}

        {(parkingError || dashboardError) && (
          <div className="card bg-amber-50 border-amber-200 text-amber-800 text-sm">
            {dashboardError ?? parkingError}
          </div>
        )}

        {activeOtherSport && (
          <section className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <p className="text-sm font-semibold text-slate-700">
              Active game: {activeOtherSport.icon} {activeOtherSport.name}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Starting a {sport.name} game will park the current active game first.
            </p>
          </section>
        )}

        <section className="card space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-700">Current Game</h2>
              <p className="text-sm text-slate-500">
                {hasActiveForSport ? 'Continue the active local game.' : `Start a new ${sport.name} game.`}
              </p>
            </div>
            <button
              type="button"
              onClick={handleStartNew}
              disabled={!availability?.canStartNewGame}
              className="btn-primary py-2 px-4 text-sm disabled:opacity-50"
            >
              New Game
            </button>
          </div>

          {hasActiveForSport && (
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-blue-800 truncate">
                  {state.gameInfo?.teamName ?? 'Setup in progress'}
                  {state.gameInfo?.opponentName ? ` vs ${state.gameInfo.opponentName}` : ''}
                </p>
                {liveScoreLine && (
                  <p className="text-base font-bold text-blue-800 tabular-nums mt-0.5">
                    {liveScoreLine}
                  </p>
                )}
                {activeSyncLabel && (
                  <p className="text-xs text-blue-500 mt-1">{activeSyncLabel}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => navigate(routeForResumedGame(state))}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold active:scale-95 transition-transform"
              >
                Resume
              </button>
            </div>
          )}
        </section>

        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">Parked Games</h2>
            <span className="text-xs text-slate-400">{parkedForSport.length}</span>
          </div>

          {parkedForSport.length === 0 ? (
            <p className="text-sm text-slate-500">No parked {sport.name} games.</p>
          ) : (
            <div className="space-y-2">
              {parkedForSport.map(game => (
                <div
                  key={game.localGameId}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-700 truncate">
                      {game.teamName} vs {game.opponentName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {game.gameDate ?? 'Date TBD'}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5 truncate" title={parkedSyncLabel(game)}>
                      {parkedSyncLabel(game)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleResumeParked(game.localGameId)}
                      className="bg-slate-800 text-white px-3 py-2 rounded-lg text-sm font-semibold active:scale-95 transition-transform"
                    >
                      Resume
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDiscardParked(game.localGameId)}
                      className="bg-white text-slate-600 px-3 py-2 rounded-lg text-sm font-semibold border border-slate-200 active:scale-95 transition-transform"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold text-slate-700">Manage</h2>
          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => navigate(sportTeamsPath(sport.id))}
              disabled={!isConfigured}
              className="btn-secondary py-3 text-sm disabled:opacity-50"
            >
              Teams
            </button>
            <button
              type="button"
              onClick={() => navigate(sportGamesPath(sport.id))}
              disabled={!isConfigured}
              className="btn-secondary py-3 text-sm disabled:opacity-50"
            >
              Cloud Games
            </button>
            <button
              type="button"
              onClick={() => navigate(sportLeaderboardPath(sport.id))}
              disabled={!isConfigured}
              className="btn-secondary py-3 text-sm disabled:opacity-50"
            >
              Season Stats
            </button>
          </div>
          {!isConfigured && (
            <p className="text-xs text-slate-500">Cloud features are unavailable until Supabase is configured.</p>
          )}
        </section>
      </div>
    </div>
  )
}
