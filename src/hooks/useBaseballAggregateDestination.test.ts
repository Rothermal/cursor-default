import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { useBaseballAggregateDestination, allocateBaseballRefreshGeneration } from './useBaseballAggregateDestination'
import { BaseballDestinationRoute } from '../components/baseball-aggregate/BaseballDestinationRoute'
import { setCurrentAuthUserId, resetCurrentAuthUserIdForTests } from '../lib/authIdentity'
import type { BaseballAggregateLoadScope } from '../lib/baseball/aggregateTypes'
import type { BaseballRulesVariant } from '../lib/baseball/types'

const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void>, cleanups: [] as Array<() => void>,
  userId: 'a' as string | null, query: 'sport=baseball&teamId=t', events: vi.fn(), legacy: vi.fn(), metadata: vi.fn(), from: vi.fn(), navigate: vi.fn() }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial
    return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = { current: initial }; return h.slots[i] },
  useMemo: (factory: () => unknown, deps: unknown[]) => memo(factory, deps),
  useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const i = h.cursor++, old = h.slots[i] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (!old || deps.some((value,index) => !Object.is(value, old.deps[index]))) {
      old?.cleanup?.(); const slot = { deps, cleanup: undefined as (() => void) | undefined }; h.slots[i] = slot
      h.effects.push(() => { slot.cleanup = effect(); if (slot.cleanup) h.cleanups.push(slot.cleanup) })
    }
  },
}))
function memo(factory: () => unknown, deps: unknown[]) {
  const i = h.cursor++, old = h.slots[i] as { deps: unknown[]; value: unknown } | undefined
  if (!old || deps.some((value,index) => !Object.is(value,old.deps[index]))) h.slots[i] = { deps, value: factory() }
  return (h.slots[i] as { value: unknown }).value
}
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: h.userId ? { id: h.userId } : null, isConfigured: true }) }))
vi.mock('react-router-dom', () => ({ Link: 'a', useSearchParams: () => [new URLSearchParams(h.query)], useNavigate: () => h.navigate }))
vi.mock('../lib/baseball/aggregateTransport', () => ({ loadBaseballAggregates: (...args: unknown[]) => h.events(...args) }))
vi.mock('../lib/baseball/legacyAggregates', () => ({ loadBaseballLegacyAggregates: (...args: unknown[]) => h.legacy(...args), BASEBALL_LEGACY_STATS: [] }))
vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => {
  h.from(table)
  const q = { select: () => q, eq: () => q, order: () => q, in: () => q, range: () => q, abortSignal: () => q, single: () => q,
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(h.metadata(table)).then(resolve,reject) }
  return q
} } }))
const empty = () => ({ aggregate: { players: [], games: [], teams: [], exclusions: [], quality: 'complete', unlinkedAppearances: 0, filteredVariantCount: 0, variant: 'baseball' }, metrics: {} })
const defer = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
function render<T>(run: () => T, effects = true): T { h.cursor = 0; h.effects = []; const value = run(); if (effects) h.effects.forEach(effect => effect()); return value }
let scope: BaseballAggregateLoadScope = { type: 'team', id: 't' }, source: 'events' | 'legacy' = 'events', variant: BaseballRulesVariant = 'baseball'
function useDestinationHarness() { return useBaseballAggregateDestination({ scope, teamIds: [], source, variant }) }
const hook = useDestinationHarness
beforeEach(() => {
  h.slots = []; h.cleanups = []; h.userId = 'a'; h.query = 'sport=baseball&teamId=t'; h.events.mockReset(); h.legacy.mockReset(); h.metadata.mockReset(); h.from.mockReset(); h.navigate.mockReset()
  scope = { type: 'team', id: 't' }; source = 'events'; variant = 'baseball'; setCurrentAuthUserId('a')
  h.events.mockResolvedValue(empty()); h.legacy.mockResolvedValue({ players: [], games: [], reviewOnly: [], exclusions: [], quality: 'complete' })
  h.metadata.mockImplementation(table => ({ data: table === 'teams' ? { id: 't', name: 'Falcons', nickname: null, season_id: 's', seasons: { id: 's', name: 'Fall', sport: 'baseball' } } : table === 'players' ? { id: 'p', first_name: 'Player', last_name: null, nickname: null } : [], error: null }))
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible' })
  vi.stubGlobal('localStorage', { getItem: () => { throw Error('storage read') }, setItem: () => { throw Error('storage write') } })
})
afterEach(() => { h.cleanups.forEach(cleanup => cleanup()); resetCurrentAuthUserIdForTests(); vi.unstubAllGlobals() })
describe('BSB-7B aggregate hook lifetime', () => {
  it('forwards user, variant and unique refresh generations and clears loaded data immediately', async () => {
    render(hook); await drain(); const first = render(hook)
    expect(first.result?.source).toBe('events')
    const firstOptions = h.events.mock.calls[0][1]
    expect(firstOptions).toMatchObject({ userId: 'a', variant: 'baseball', refreshGeneration: expect.any(Number) })
    first.refresh(); expect(render(hook).result).toBeNull()
    await drain(); expect(h.events.mock.calls[1][1].refreshGeneration).toBeGreaterThan(firstOptions.refreshGeneration)
    expect(allocateBaseballRefreshGeneration()).not.toBe(h.events.mock.calls[1][1].refreshGeneration)
  })
  it.each(['scope','variant','source','account'] as const)('hides old data before effects on %s change, including A -> B -> A', async change => {
    render(hook); await drain(); expect(render(hook).result).not.toBeNull()
    if (change === 'scope') scope = { type: 'team', id: 'other' }
    if (change === 'variant') variant = 'softball_fastpitch'
    if (change === 'source') source = 'legacy'
    if (change === 'account') { h.userId = 'b'; setCurrentAuthUserId('b') }
    expect(render(hook,false).result).toBeNull()
    scope = { type: 'team', id: 't' }; variant = 'baseball'; source = 'events'
    if (change === 'account') { h.userId = 'a'; setCurrentAuthUserId('a') }
    expect(render(hook,false).result).toBeNull()
  })
  it.each(['scope','account','unmount','auth-before-render'] as const)('rejects a late %s result', async change => {
    const pending = defer<ReturnType<typeof empty>>()
    h.events.mockReturnValueOnce(pending.promise).mockImplementation(() => new Promise(() => {})); render(hook); await drain()
    if (change === 'scope') { scope = { type: 'team', id: 'other' }; render(hook) }
    if (change === 'account') { h.userId = 'b'; setCurrentAuthUserId('b'); render(hook); h.userId = 'a'; setCurrentAuthUserId('a'); render(hook) }
    if (change === 'unmount') h.cleanups.forEach(cleanup => cleanup())
    if (change === 'auth-before-render') { setCurrentAuthUserId('b'); setCurrentAuthUserId('a') }
    pending.resolve(empty()); await drain()
    expect(render(hook,false).result).toBeNull()
  })
  it('shows a refresh failure without old totals or a legacy fallback', async () => {
    render(hook); await drain(); const first = render(hook)
    h.events.mockRejectedValueOnce(Error('Backend update required')); first.refresh(); render(hook); await drain()
    const next = render(hook); expect(next.result).toBeNull(); expect(next.error).toContain('Backend update')
    expect(h.legacy).not.toHaveBeenCalled()
  })
})
describe('BSB-7B outer metadata lifetime and historical identity', () => {
  const route = () => BaseballDestinationRoute({ kind: 'profile', fallback: createElement('div', { id: 'legacy' }) })
  it.each([true,false])('preserves sibling-sport Career navigation (explicit Baseball: %s)', async explicit => {
    h.query = `playerId=p${explicit ? '&sport=baseball' : ''}`
    h.metadata.mockImplementation(table => ({ error: null, data: table === 'team_players'
      ? ['baseball','hockey','basketball'].map(sport => ({ teams: { seasons: { sport } } }))
      : { id: 'p', first_name: 'Player', last_name: null, nickname: null } }))
    const career = () => BaseballDestinationRoute({ kind: 'career', fallback: createElement('div', { id: 'legacy' }) })
    render(career); await drain(); const page = render(career) as ReactElement
    const Component = page.type as (props: unknown) => ReactNode
    h.cleanups.forEach(cleanup => cleanup()); h.cleanups = []; h.slots = []
    const content = render(() => Component(page.props))
    function nodes(node: ReactNode): ReactElement<Record<string,unknown>>[] {
      if (Array.isArray(node)) return node.flatMap(nodes)
      if (!isValidElement<{ children?: ReactNode }>(node)) return []
      return [node as ReactElement<Record<string,unknown>>, ...nodes(node.props.children)]
    }
    const select = nodes(content).find(row => row.type === 'select' && row.props.value === 'baseball')!
    expect(select).toBeDefined()
    if (!explicit) expect(h.navigate).toHaveBeenCalledWith('/career?playerId=p&sport=baseball', { replace: true })
    ;(select.props.onChange as (event: unknown) => void)({ target: { value: 'hockey' } })
    expect(h.navigate).toHaveBeenLastCalledWith('/career?playerId=p&sport=hockey', { replace: true })
  })
  it('routes a Baseball profile without current roster-junction access or generic legacy reads', async () => {
    h.query = 'teamId=t&playerId=p'
    render(route); await drain(); const result = render(route) as ReactElement
    expect(typeof result?.type).toBe('function')
    expect((result!.type as { name: string }).name).toBe('BaseballRouteContent')
    expect(h.from.mock.calls.map(row => row[0])).not.toContain('team_players')
  })
  it('uses a frozen identity from authorized canonical history when players RLS hides a removed roster player', async () => {
    h.query = 'sport=baseball&teamId=t&playerId=p'
    h.metadata.mockImplementation(table => table === 'players' ? { data: null, error: { code: 'PGRST116' } } : { data: { id: 't', name: 'Team', season_id: 's', seasons: { sport: 'baseball' } }, error: null })
    h.events.mockResolvedValue({ ...empty(), aggregate: { ...empty().aggregate, players: [{ playerId: 'p', displayName: 'Frozen historical name', number: '9' }] } })
    render(route); await drain(); const tree = render(route) as ReactElement
    expect((tree!.props as { metadata: { player: { displayName: string } } }).metadata.player.displayName).toBe('Frozen historical name')
  })
  it.each(['route','account','unmount','auth-before-render'] as const)('never adopts stale %s metadata', async change => {
    const pending = defer<{ data: unknown; error: null }>()
    h.query = 'teamId=t&playerId=p'; h.metadata.mockReturnValueOnce(pending.promise).mockImplementation(() => new Promise(() => {}))
    render(route)
    if (change === 'route') { h.query = 'teamId=other&playerId=p'; render(route) }
    if (change === 'account') { h.userId = 'b'; setCurrentAuthUserId('b'); render(route); h.userId = 'a'; setCurrentAuthUserId('a'); render(route) }
    if (change === 'unmount') h.cleanups.forEach(cleanup => cleanup())
    if (change === 'auth-before-render') { setCurrentAuthUserId('b'); setCurrentAuthUserId('a') }
    pending.resolve({ data: { id: 't', seasons: { sport: 'baseball' } }, error: null }); await drain()
    const tree = render(route,false) as ReactElement
    expect((tree!.type as { name: string }).name).not.toBe('BaseballRouteContent')
  })
})
