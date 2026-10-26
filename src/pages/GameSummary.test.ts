import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sports } from '../config/sports'
import { createInitialState } from '../lib/gameReducer'
import type { GameState } from '../types'
import GameSummary from './GameSummary'

const h = vi.hoisted(() => ({ state: null as GameState | null }))
vi.mock('../context/GameContext', () => ({ useGame: () => ({ state: h.state, flushCloudSync: vi.fn(),
  parkCurrentGame: vi.fn(), prepareActiveGameMutation: vi.fn(), parkingError: null }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' }, isConfigured: false }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: null }))
vi.mock('../hooks/useFinalizeGame', () => ({ useFinalizeGame: () => ({ finalizing: false, finalizeError: null,
  canFinalizeCloudGame: false, handleFinalizeCloudGame: vi.fn() }) }))
vi.mock('../hooks/useReviewShotChart', () => ({ useReviewShotChart: () => ({ summaryShotChart: [],
  isReviewShotChart: false, showShotChartTab: false, shotViewSelection: { kind: 'all' }, setShotViewSelection: vi.fn() }) }))

beforeEach(() => {
  const state = createInitialState()
  h.state = { ...state, sport: sports.find(sport => sport.id === 'hockey')!,
    gameInfo: { teamName: 'Home', opponentName: 'Away', date: '2026-10-25', tournamentName: '' },
    players: [{ id: 'p', name: 'Pat', number: '1', stats: { goal: 2 } }],
    cloudSync: { ...state.cloudSync, gameId: 'cloud', gameStatus: 'in_progress' } }
})

describe.each(['basketball', 'baseball', 'hockey'])('%s retired Summary sync recovery', sportId => {
  it.each([null, 'scheduled', 'in_progress'] as const)('shows retry for a bound %s game without changing facts', gameStatus => {
    h.state = { ...h.state!, sport: sports.find(sport => sport.id === sportId)!,
      cloudSync: { ...h.state!.cloudSync, gameStatus } }
    const before = JSON.stringify(h.state)
    const markup = renderToStaticMarkup(createElement(GameSummary))
    expect(markup).toContain('Retry sync')
    expect(JSON.stringify(h.state)).toBe(before)
  })

  it.each(['unbound', 'final'] as const)('does not offer retry for a %s game', kind => {
    h.state = { ...h.state!, sport: sports.find(sport => sport.id === sportId)!,
      cloudSync: { ...h.state!.cloudSync, ...(kind === 'final' ? { gameStatus: 'final' } : { gameId: null }) } }
    expect(renderToStaticMarkup(createElement(GameSummary))).not.toContain('Retry sync')
  })
})

it('does not add retired-game recovery to the active Football tracker flow', () => {
  h.state = { ...h.state!, sport: sports.find(sport => sport.id === 'football')! }
  expect(renderToStaticMarkup(createElement(GameSummary))).not.toContain('Retry sync')
})
