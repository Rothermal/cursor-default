import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { GameProvider, useGame } from './context/GameContext'
import { SettingsProvider } from './context/SettingsContext'
import { gameSetupRouteTarget, loadTeamSportId } from './lib/gameSetupRoute'
import { gameSetupPath } from './lib/teamInfo'
import { supabase } from './lib/supabase'
import { captureAuthIdentity, isCurrentAuthIdentity } from './lib/authIdentity'
import { isLegacyBaseballGame } from './lib/baseball/releasePolicy'
import { isLegacyGameForSport } from './lib/legacyGameRetirement'
import AppShell from './components/AppShell'
import Auth from './pages/Auth'
import ShotChartPreview from './pages/ShotChartPreview'
import AppAccessGate from './pages/AppAccessGate'
import { consumeOAuthReturnPath } from './lib/oauthReturnPath'
import { isSoccerSummaryRoute } from './lib/soccer/summary'
import { isBasketballSummaryRoute } from './lib/basketball/summary'
import { isBaseballSummaryRoute } from './lib/baseball/summary'
import { isHockeySummaryRoute } from './lib/hockey/summary'
import PwaStatus from './components/PwaStatus'
import RouteChunkBoundary from './components/RouteChunkBoundary'

// Route-level code splitting (RTN-0): each page is its own precached chunk so
// no single asset approaches the PWA precache limit.
const SportSelect = lazy(() => import('./pages/SportSelect'))
const SportDashboard = lazy(() => import('./pages/SportDashboard'))
const GameSetup = lazy(() => import('./pages/GameSetup'))
const PlayerSetup = lazy(() => import('./pages/PlayerSetup'))
const GameTracker = lazy(() => import('./pages/GameTracker'))
const GameCheckout = lazy(() => import('./pages/GameCheckout'))
const GameSummary = lazy(() => import('./pages/GameSummary'))
const Admin = lazy(() => import('./pages/Admin'))
const TeamsList = lazy(() => import('./pages/TeamsList'))
const TeamManage = lazy(() => import('./pages/TeamManage'))
const TeamInfo = lazy(() => import('./pages/TeamInfo'))
const TeamRoster = lazy(() => import('./pages/TeamRoster'))
const TeamSchedule = lazy(() => import('./pages/TeamSchedule'))
const SeasonInfo = lazy(() => import('./pages/SeasonInfo'))
const GameInfo = lazy(() => import('./pages/GameInfo'))
const Games = lazy(() => import('./pages/Games'))
const Leaderboard = lazy(() => import('./pages/Leaderboard'))
const PlayerProfile = lazy(() => import('./pages/PlayerProfile'))
const CareerStats = lazy(() => import('./pages/CareerStats'))
const TeamStats = lazy(() => import('./pages/TeamStats'))
const TournamentStats = lazy(() => import('./pages/TournamentStats'))
const ShotChart = lazy(() => import('./pages/ShotChart'))
const TeamInvite = lazy(() => import('./pages/TeamInvite'))
const SavedOpponents = lazy(() => import('./pages/SavedOpponents'))
const SoccerGameSetup = lazy(() => import('./pages/SoccerGameSetup'))
const SoccerPlayerSetup = lazy(() => import('./pages/SoccerPlayerSetup'))
const SoccerGameTracker = lazy(() => import('./pages/SoccerGameTracker'))
const SoccerCloudReview = lazy(() => import('./pages/SoccerCloudReview'))
const SoccerSummary = lazy(() => import('./pages/SoccerSummary'))
const BasketballSummary = lazy(() => import('./pages/BasketballSummary'))
const BaseballSummary = lazy(() => import('./pages/BaseballSummary'))
const BaseballCloudSummaryRoute = lazy(() => import('./pages/BaseballCloudSummaryRoute'))
const HockeySummary = lazy(() => import('./pages/HockeySummary'))
const HockeyGameSetup = lazy(() => import('./pages/HockeyGameSetup'))
const HockeyGameTracker = lazy(() => import('./pages/HockeyGameTracker'))
const BaseballEventSetup = lazy(() => import('./pages/BaseballEventSetup'))
const BaseballGameTracker = lazy(() => import('./pages/BaseballGameTracker'))
const AppearancePreview = import.meta.env.DEV ? lazy(() => import('./pages/AppearancePreview')) : null

function GameSetupRoute() {
  const { state } = useGame()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const requestedSport = searchParams.get('sport')
  const teamId = searchParams.get('teamId')
  const activeSportId = state.sport?.id ?? null
  const identity = user ? captureAuthIdentity(user.id) : null
  const teamScope = JSON.stringify([teamId, identity])
  const [attempt, setAttempt] = useState(0)
  const [teamSport, setTeamSport] = useState<{ scope: string; sportId: string | null } | null>(null)
  useEffect(() => {
    if (!teamId) return
    let cancelled = false
    const currentIdentity = user ? captureAuthIdentity(user.id) : null
    void loadTeamSportId(currentIdentity ? supabase : null, teamId).then(sportId => {
      if (!cancelled && (!currentIdentity || isCurrentAuthIdentity(currentIdentity))) setTeamSport({ scope: teamScope, sportId })
    })
    return () => {
      cancelled = true
    }
  }, [teamId, teamScope, user, attempt])

  const target = gameSetupRouteTarget({
    requestedSport,
    teamId,
    activeSportId,
    teamSportId: teamSport?.scope === teamScope ? teamSport.sportId : undefined,
  })
  switch (target) {
    case 'soccer':
      return <SoccerGameSetup />
    // HockeyGameSetup applies the hockeyEvent creation policy and shows the notice when off.
    // Once Hockey is released (HKY-6C), every new Hockey game opens it.
    case 'hockey_events':
      return requestedSport === 'hockey'
        ? <HockeyGameSetup />
        : <Navigate to={`${gameSetupPath(teamId ?? '', 'hockey')}&events=1`} replace />
    // BaseballEventSetup applies the baseballEvent creation policy and shows the notice when off.
    case 'baseball_events':
      return <BaseballEventSetup key={JSON.stringify([teamId, identity])} />
    case 'resolve_team_sport':
      return <p className="p-6 text-center text-sm text-content-muted animate-pulse">Loading team...</p>
    case 'unavailable_team':
      return <main className="mx-auto max-w-lg space-y-3 px-4 py-6">
        <p role="alert" className="text-danger-content">The selected team is unavailable or does not match this sport. No game was changed.</p>
        <button type="button" className="btn-secondary" onClick={() => { setTeamSport(null); setAttempt(value => value + 1) }}>Retry team</button>
        <Link className="btn-secondary inline-block" to="/sports">Back to Sports</Link>
      </main>
    default:
      if (!requestedSport && !teamId && state.sport?.id === 'hockey') return <Navigate to={isLegacyGameForSport(state, 'hockey') ? '/summary' : '/game'} replace />
      if (!requestedSport && !teamId && isLegacyGameForSport(state, 'basketball')) return <Navigate to="/summary" replace />
      return <GameSetup />
  }
}

function PlayerSetupRoute() {
  const { state } = useGame()
  if (isLegacyGameForSport(state, 'basketball')) return <Navigate to="/summary" replace />
  if (state.sport?.id === 'hockey') return <Navigate to={isLegacyGameForSport(state, 'hockey') ? '/summary' : '/game'} replace />
  if (state.sport?.id === 'baseball') return <Navigate to={isLegacyBaseballGame(state) ? '/summary' : '/game'} replace />
  if (state.sport?.id !== 'soccer') return <PlayerSetup />
  return <SoccerPlayerSetup />
}

function GameTrackerRoute() {
  const { state } = useGame()
  if (isLegacyGameForSport(state, 'basketball')) return <Navigate to="/summary" replace />
  // Hockey event games never fall through to the legacy stat grid.
  if (state.sport?.id === 'hockey') return isLegacyGameForSport(state, 'hockey')
    ? <Navigate to="/summary" replace /> : <HockeyGameTracker />
  // Baseball event games never fall through to the legacy stat grid either.
  if (state.sport?.id === 'baseball') return isLegacyBaseballGame(state)
    ? <Navigate to="/summary" replace /> : <BaseballGameTracker />
  if (state.sport?.id !== 'soccer') return <GameTracker />
  return state.eventStream?.events.length
    ? <SoccerGameTracker />
    : <Navigate to="/players" replace />
}

function GameCheckoutRoute() {
  const { state } = useGame()
  if (isLegacyGameForSport(state, 'basketball')) return <Navigate to="/summary" replace />
  if (state.sport?.id === 'hockey') return <Navigate to={isLegacyGameForSport(state, 'hockey') ? '/summary' : '/game'} replace />
  if (state.sport?.id === 'baseball') return <Navigate to={isLegacyBaseballGame(state) ? '/summary' : '/game'} replace />
  if (state.sport?.id !== 'soccer') return <GameCheckout />
  return <Navigate to="/players" replace />
}

function GameSummaryRoute() {
  const [searchParams] = useSearchParams()
  const gameId = searchParams.get('gameId')
  const requestedSport = searchParams.get('sport')
  if (gameId && (!requestedSport || requestedSport === 'baseball')) {
    return <BaseballCloudSummaryRoute gameId={gameId} requestedSport={requestedSport}><SportGameSummaryRoute /></BaseballCloudSummaryRoute>
  }
  return <SportGameSummaryRoute />
}

function SportGameSummaryRoute() {
  const { state, activeLocalGameId } = useGame()
  const [searchParams] = useSearchParams()
  if (isBasketballSummaryRoute(state, searchParams)) return <BasketballSummary />
  // Baseball event games never fall through to the legacy grid Summary.
  if (isBaseballSummaryRoute(state, searchParams)) return <BaseballSummary />
  // Hockey event games, local or cloud by gameId, open the Hockey Summary (HKY-6A1).
  if (isHockeySummaryRoute(state, searchParams)) return <HockeySummary />
  if (!isSoccerSummaryRoute(state.sport?.id, searchParams)) return <GameSummary key={`${activeLocalGameId}:${state.cloudSync.gameId}`} />
  return <SoccerSummary />
}

function AppRoutes() {
  const {
    user,
    loading,
    isConfigured,
    appAccess,
    appAccessLoading,
    appAccessError,
    refreshAppAccess,
    signOut,
  } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!user || (isConfigured && appAccess?.status !== 'active')) return

    const returnPath = consumeOAuthReturnPath()
    if (returnPath) {
      navigate(returnPath, { replace: true })
    }
  }, [appAccess?.status, isConfigured, navigate, user])

  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.location.hash.includes('/dev/shot-chart')
  ) {
    return <ShotChartPreview />
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-2">📊</div>
          <p className="text-content-muted animate-pulse">Loading...</p>
        </div>
      </div>
    )
  }

  if (isConfigured && !user) {
    return (
      <RouteChunkBoundary>
        <Routes>
          <Route path="/invite/:token" element={<TeamInvite />} />
          <Route path="*" element={<Auth />} />
        </Routes>
      </RouteChunkBoundary>
    )
  }

  if (isConfigured && user && appAccessLoading && !appAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-content-muted animate-pulse">Checking account access...</p>
      </div>
    )
  }

  if (isConfigured && user && (!appAccess || appAccess.status !== 'active')) {
    return (
      <AppAccessGate
        status={appAccess?.status ?? 'unavailable'}
        email={user.email ?? null}
        error={appAccessError}
        checking={appAccessLoading}
        onRefresh={() => void refreshAppAccess()}
        onSignOut={() => void signOut()}
      />
    )
  }

  return (
    <SettingsProvider>
      <GameProvider>
        <PwaStatus />
        <AppShell>
          <RouteChunkBoundary>
          <Routes>
            <Route path="/" element={<SportSelect />} />
            <Route path="/sports" element={<SportSelect />} />
            <Route path="/sport/:sportId" element={<SportDashboard />} />
            <Route path="/setup" element={<GameSetupRoute />} />
            <Route path="/players" element={<PlayerSetupRoute />} />
            <Route path="/checkout" element={<GameCheckoutRoute />} />
            <Route path="/game" element={<GameTrackerRoute />} />
            <Route path="/shot-chart" element={<ShotChart />} />
            <Route path="/summary" element={<GameSummaryRoute />} />
            <Route path="/settings" element={<Admin />} />
            <Route path="/settings/account" element={<Admin />} />
            <Route path="/settings/app" element={<Admin />} />
            <Route path="/settings/sports" element={<Admin />} />
            <Route path="/settings/sports/:sportId" element={<Admin />} />
            <Route path="/settings/data" element={<Admin />} />
            <Route path="/settings/advanced" element={<Admin />} />
            <Route path="/admin" element={<Navigate to="/settings" replace />} />
            <Route path="/teams" element={<TeamsList />} />
            <Route path="/team" element={<TeamInfo />} />
            <Route path="/team/manage" element={<TeamManage />} />
            <Route path="/invite/:token" element={<TeamInvite />} />
            <Route path="/team/roster" element={<TeamRoster />} />
            <Route path="/team/schedule" element={<TeamSchedule />} />
            <Route path="/team/season" element={<SeasonInfo />} />
            <Route path="/game-info" element={<GameInfo />} />
            <Route path="/games" element={<Games />} />
            <Route path="/opponents" element={<SavedOpponents />} />
            <Route path="/soccer/review" element={<SoccerCloudReview />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/player" element={<PlayerProfile />} />
            <Route path="/player-info" element={<PlayerProfile />} />
            <Route path="/career" element={<CareerStats />} />
            <Route path="/team-stats" element={<TeamStats />} />
            <Route path="/tournament-stats" element={<TournamentStats />} />
            {import.meta.env.DEV && (
              <Route path="/dev/shot-chart" element={<ShotChartPreview />} />
            )}
          </Routes>
          </RouteChunkBoundary>
        </AppShell>
      </GameProvider>
    </SettingsProvider>
  )
}

export default function App() {
  if (AppearancePreview && window.location.hash.split('?')[0] === '#/dev/appearance') {
    return <Suspense fallback={<div className="min-h-screen bg-canvas text-content p-4" role="status">Loading...</div>}><AppearancePreview /></Suspense>
  }
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
