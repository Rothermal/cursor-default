import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PlayerSetup from './PlayerSetup'
import { createInitialState } from '../lib/gameReducer'
import { sports } from '../config/sports'
import { DEFAULT_BASKETBALL_PERSONAL_SETTINGS } from '../lib/basketball/settings'
import { createBasketballSetupDraft, createBasketballSetupDraftEvent, reconcileBasketballSetupTrackedRoster, saveBasketballSetupDraft } from '../lib/basketball/setupDraft'

const harness = vi.hoisted(() => ({ state: null as unknown }))
vi.mock('../context/GameContext', () => ({ useGame: () => ({ state: harness.state, dispatch: vi.fn(), activeLocalGameId: 'game-a' }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null, isConfigured: false }) }))
vi.mock('../context/SettingsContext', () => ({ useSettings: () => ({ basketballSettings: DEFAULT_BASKETBALL_PERSONAL_SETTINGS, basketballSettingsSync: { revision: null } }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: null }))
beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) }, removeItem: (key: string) => { store.delete(key) } })
  harness.state = { ...createInitialState(), sport: sports.find(sport => sport.id === 'basketball')!, gameDataAuthority: 'sport_events',
    gameInfo: { teamName: 'Home', opponentName: 'Away', tournamentName: '', tournamentId: null, date: '2026-09-21' },
    players: [{ id: 'p1', name: 'Alex', number: '1', stats: {} }] }
})
function draft(gameId: string) {
  const base = createBasketballSetupDraft({ accountScope: 'anonymous', source: { kind: 'personal', teamName: 'Home', seasonId: null, seasonName: '' } })
  base.authority = 'sport_events'
  base.committedLocalGameId = gameId
  base.event = createBasketballSetupDraftEvent({ authority: 'personal', revision: null, settings: DEFAULT_BASKETBALL_PERSONAL_SETTINGS, matchOverrides: {}, cloudIntent: 'local_only' })
  const next = reconcileBasketballSetupTrackedRoster(base, [{ playerId: 'p1', displayName: 'Alex', number: '1', position: 'PG', initialStatus: 'starter' }])
  const saved = saveBasketballSetupDraft(next)
  if (!saved.ok) throw Error(saved.error)
}
describe('Basketball player setup review and roster context', () => {
  it.each(['missing', 'other-game'])('blocks start and offers review when the draft is %s', kind => {
    if (kind === 'other-game') draft('game-b')
    const html = renderToStaticMarkup(createElement(PlayerSetup))
    expect(html).toContain('Review Game Setup')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Start Game/)
    expect(html).not.toContain('>Position</label>')
  })
  it('shows saved position and starter context only for the matching reviewed game', () => {
    draft('game-a')
    const html = renderToStaticMarkup(createElement(PlayerSetup))
    expect(html).not.toContain('Review Game Setup')
    expect(html).toContain('Starter')
    expect(html).toContain('<option selected="">PG</option>')
  })
})
