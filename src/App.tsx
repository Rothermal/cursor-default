import { Routes, Route } from 'react-router-dom'
import { GameProvider } from './context/GameContext'
import { SettingsProvider } from './context/SettingsContext'
import SportSelect from './pages/SportSelect'
import GameSetup from './pages/GameSetup'
import PlayerSetup from './pages/PlayerSetup'
import GameTracker from './pages/GameTracker'
import GameSummary from './pages/GameSummary'
import Admin from './pages/Admin'

export default function App() {
  return (
    <SettingsProvider>
      <GameProvider>
        <Routes>
          <Route path="/" element={<SportSelect />} />
          <Route path="/setup" element={<GameSetup />} />
          <Route path="/players" element={<PlayerSetup />} />
          <Route path="/game" element={<GameTracker />} />
          <Route path="/summary" element={<GameSummary />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </GameProvider>
    </SettingsProvider>
  )
}
