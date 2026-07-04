import { Navigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'

/**
 * Legacy route: the court now lives inline on the Game Tracker (`/game`).
 * Kept only so old links/bookmarks to `#/shot-chart` keep working; non-basketball
 * or missing game state falls back to home (same guard as the old page).
 */
export default function ShotChart() {
  const { state } = useGame()
  const { sport, gameInfo } = state
  const allowed = Boolean(sport && sport.id === 'basketball' && gameInfo)
  return <Navigate to={allowed ? '/game' : '/'} replace />
}
