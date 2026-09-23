import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactNode } from 'react'
import SportDashboard from './SportDashboard'
import { createInitialState } from '../lib/gameReducer'
import { LOCAL_GAME_DELETE_WARNING } from '../lib/localGameDiscard'

const harness = vi.hoisted(() => ({ discard: vi.fn(), confirm: vi.fn() }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: (value: unknown) => [value, vi.fn()], useMemo: (fn: () => unknown) => fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => ({ sportId: 'basketball' }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isConfigured: false, user: null }) }))
vi.mock('../context/SettingsContext', () => ({ useSettings: () => ({ isSportEnabled: () => true }) }))
vi.mock('../context/GameContext', () => ({ useGame: () => ({ state: createInitialState(), activeLocalGameId: null, parkingError: null,
  clearParkingError: vi.fn(), discardParkedGame: harness.discard,
  parkedGames: [{ localGameId: 'parked', sportId: 'basketball', sportName: 'Basketball', teamName: 'Home', opponentName: 'Away', syncDirty: true, syncStatus: 'idle' }] }) }))
function findDelete(node: ReactNode): (() => void) | undefined {
  if (Array.isArray(node)) return node.map(findDelete).find(Boolean)
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return undefined
  if (node.type === 'button' && node.props.children === 'Delete local copy') return node.props.onClick
  return findDelete(node.props.children)
}
beforeEach(() => { harness.discard.mockReset(); harness.confirm.mockReset(); vi.stubGlobal('window', { confirm: harness.confirm }) })
describe('parked local deletion confirmation', () => {
  it('does nothing on cancel', () => {
    harness.confirm.mockReturnValue(false)
    findDelete(SportDashboard())!()
    expect(harness.confirm).toHaveBeenCalledWith(LOCAL_GAME_DELETE_WARNING)
    expect(harness.discard).not.toHaveBeenCalled()
  })
  it('passes explicit unsynced acknowledgement only after confirmation', () => {
    harness.confirm.mockReturnValue(true)
    findDelete(SportDashboard())!()
    expect(harness.discard).toHaveBeenCalledWith('parked', { allowUnsyncedLocalDelete: true })
  })
})
