import { useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { GameProvider, useGame } from './context/GameContext'
import { SettingsProvider } from './context/SettingsContext'
import AppShell from './components/AppShell'
import Auth from './pages/Auth'
import SportSelect from './pages/SportSelect'
import SportDashboard from './pages/SportDashboard'
import GameSetup from './pages/GameSetup'
import PlayerSetup from './pages/PlayerSetup'
import GameTracker from './pages/GameTracker'
import GameCheckout from './pages/GameCheckout'
import GameSummary from './pages/GameSummary'
import Admin from './pages/Admin'
import TeamsList from './pages/TeamsList'
import TeamManage from './pages/TeamManage'
import TeamInfo from './pages/TeamInfo'
import TeamRoster from './pages/TeamRoster'
import TeamSchedule from './pages/TeamSchedule'
import SeasonInfo from './pages/SeasonInfo'
import GameInfo from './pages/GameInfo'
import Games from './pages/Games'
import Leaderboard from './pages/Leaderboard'
import PlayerProfile from './pages/PlayerProfile'
import CareerStats from './pages/CareerStats'
import TeamStats from './pages/TeamStats'
import TournamentStats from './pages/TournamentStats'
import ShotChart from './pages/ShotChart'
import ShotChartPreview from './pages/ShotChartPreview'
import TeamInvite from './pages/TeamInvite'
import AppAccessGate from './pages/AppAccessGate'
import { consumeOAuthReturnPath } from './lib/oauthReturnPath'
import SoccerGameSetup from './pages/SoccerGameSetup'
import SoccerPlayerSetup from './pages/SoccerPlayerSetup'
import SoccerGameTracker from './pages/SoccerGameTracker'
import SoccerCloudReview from './pages/SoccerCloudReview'
import SoccerSummary from './pages/SoccerSummary'

function GameSetupRoute() {
  const { state } = useGame()
  if (state.sport?.id !== 'soccer') return <GameSetup />
  return import.meta.env.DEV ? <SoccerGameSetup /> : <Navigate to="/" replace />
}

function PlayerSetupRoute() {
  const { state } = useGame()
  if (state.sport?.id !== 'soccer') return <PlayerSetup />
  return import.meta.env.DEV ? <SoccerPlayerSetup /> : <Navigate to="/" replace />
}

function GameTrackerRoute() {
  const { state } = useGame()
  if (state.sport?.id !== 'soccer') return <GameTracker />
  if (!import.meta.env.DEV) return <Navigate to="/" replace />
  return state.eventStream?.events.length
    ? <SoccerGameTracker />
    : <Navigate to="/players" replace />
}

function GameCheckoutRoute() {
  const { state } = useGame()
  if (state.sport?.id !== 'soccer') return <GameCheckout />
  return <Navigate to={import.meta.env.DEV ? '/players' : '/'} replace />
}

function GameSummaryRoute() {
  const { state } = useGame()
  const [searchParams] = useSearchParams()
  const isSoccerSummary =
    state.sport?.id === 'soccer' || Boolean(searchParams.get('gameId'))
  if (!isSoccerSummary) return <GameSummary />
  return import.meta.env.DEV ? <SoccerSummary /> : <Navigate to="/" replace />
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
          <p className="text-slate-500 animate-pulse">Loading...</p>
        </div>
      </div>
    )
  }

  if (isConfigured && !user) {
    return (
      <Routes>
        <Route path="/invite/:token" element={<TeamInvite />} />
        <Route path="*" element={<Auth />} />
      </Routes>
    )
  }

  if (isConfigured && user && appAccessLoading && !appAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-500 animate-pulse">Checking account access...</p>
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
        <AppShell>
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
            {import.meta.env.DEV && (
              <Route path="/soccer/review" element={<SoccerCloudReview />} />
            )}
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
        </AppShell>
      </GameProvider>
    </SettingsProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
