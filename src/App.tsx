import { Routes, Route } from 'react-router-dom'
import { GameProvider } from './context/GameContext'
import SportSelect from './pages/SportSelect'
import GameSetup from './pages/GameSetup'
import PlayerSetup from './pages/PlayerSetup'
import GameTracker from './pages/GameTracker'
import GameSummary from './pages/GameSummary'

export default function App() {
  return (
    <GameProvider>
      <Routes>
        <Route path="/" element={<SportSelect />} />
        <Route path="/setup" element={<GameSetup />} />
        <Route path="/players" element={<PlayerSetup />} />
        <Route path="/game" element={<GameTracker />} />
        <Route path="/summary" element={<GameSummary />} />
      </Routes>
    </GameProvider>
  )
}
