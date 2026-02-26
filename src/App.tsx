import { Routes, Route } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { GameProvider } from './context/GameContext'
import { SettingsProvider } from './context/SettingsContext'
import Auth from './pages/Auth'
import SportSelect from './pages/SportSelect'
import GameSetup from './pages/GameSetup'
import PlayerSetup from './pages/PlayerSetup'
import GameTracker from './pages/GameTracker'
import GameCheckout from './pages/GameCheckout'
import GameSummary from './pages/GameSummary'
import Admin from './pages/Admin'
import Teams from './pages/Teams'
import Games from './pages/Games'

function AppRoutes() {
  const { user, loading, isConfigured } = useAuth()

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
    return <Auth />
  }

  return (
    <SettingsProvider>
      <GameProvider>
        <Routes>
          <Route path="/" element={<SportSelect />} />
          <Route path="/setup" element={<GameSetup />} />
          <Route path="/players" element={<PlayerSetup />} />
          <Route path="/checkout" element={<GameCheckout />} />
          <Route path="/game" element={<GameTracker />} />
          <Route path="/summary" element={<GameSummary />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/games" element={<Games />} />
        </Routes>
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
