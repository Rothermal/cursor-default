import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import BaseballCloudSummaryRoute from './BaseballCloudSummaryRoute'
import BaseballSummary from './BaseballSummary'
import { resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from '../lib/authIdentity'

const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effect: null as (() => (() => void)) | null,
  cleanup: null as (() => void) | null, userId: 'account-a', resolve: vi.fn(), gameId: 'requested-l' }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = initial
    return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }]
  },
  useEffect: (effect: () => (() => void)) => { h.effect = effect },
}))
vi.mock('react-router-dom', () => ({ Link: 'a', Navigate: 'navigate', useSearchParams: () => [new URLSearchParams('teamId=team-l')] }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: h.userId } }) }))
vi.mock('../context/GameContext', () => ({ useGame: () => { throw Error('Routing must not inspect or hydrate unrelated active game A') } }))
vi.mock('../lib/baseball/summaryRoute', () => ({ resolveBaseballCloudSummaryRoute: (...args: unknown[]) => h.resolve(...args) }))
vi.mock('./BaseballSummary', () => ({ default: 'baseball-summary' }))

const sibling = createElement('sibling-summary')
function render(runEffect = false) {
  h.cursor = 0
  const keyed = BaseballCloudSummaryRoute({ gameId: h.gameId, requestedSport: 'baseball', children: sibling })
  const inspect = keyed.type as (props: typeof keyed.props) => ReactElement
  const result = inspect(keyed.props)
  if (runEffect) h.cleanup = h.effect!()
  return result
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node as ReactElement<Record<string, unknown>>, ...elements(node.props.children)]
}
const drain = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
beforeEach(() => { h.slots = []; h.cursor = 0; h.userId = 'account-a'; h.gameId = 'requested-l'; h.effect = null; h.cleanup = null; h.resolve.mockReset(); setCurrentAuthUserId(h.userId) })
afterEach(() => { h.cleanup?.(); resetCurrentAuthUserIdForTests() })

describe('BSB-6C cloud Summary dispatch', () => {
  it('sends proven legacy L to requested Game Info, never active-game A Summary', async () => {
    h.resolve.mockResolvedValue('legacy')
    render(true); await drain()
    const route = render()
    expect(route.type).toBe(Navigate)
    expect(route.props).toMatchObject({ to: '/game-info?gameId=requested-l&teamId=team-l', replace: true })
  })
  it('dispatches proven event authority and preserves sibling fallback', async () => {
    h.resolve.mockResolvedValue('baseball'); render(true); await drain()
    expect(render().type).toBe(BaseballSummary)
    h.slots = []; h.resolve.mockResolvedValue('other'); render(true); await drain()
    expect(render()).toBe(sibling)
  })
  it('keeps an unreadable setup out of all Summary fallbacks', async () => {
    h.resolve.mockRejectedValue(Error('setup access failed')); render(true); await drain()
    const tree = elements(render())
    expect(tree.some(element => element.props.role === 'alert')).toBe(true)
    expect(tree.some(element => element.type === BaseballSummary || element.type === Navigate)).toBe(false)
  })
  it('cancels unmounted metadata requests before they can dispatch', async () => {
    let finish!: (value: string) => void, guard!: () => void
    h.resolve.mockImplementation((_id, _sport, _deps, current) => { guard = current; return new Promise(resolve => { finish = resolve }) })
    render(true); h.cleanup!()
    expect(guard).toThrow()
    finish('baseball'); await drain()
    expect(render().type).not.toBe(BaseballSummary)
  })
})
