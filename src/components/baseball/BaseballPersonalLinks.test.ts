import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import BaseballPersonalLinks from './BaseballPersonalLinks'
import { AGGREGATE_USER, aggregateUuid, MAP_FINGERPRINT } from '../../lib/baseball/aggregateTestFixtures'
import { setCurrentAuthUserId, resetCurrentAuthUserIdForTests } from '../../lib/authIdentity'
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void>, cleanups: [] as Array<() => void>, load: vi.fn(), link: vi.fn(), linked: vi.fn(), signal: null as AbortSignal | null }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = { current: initial }; return h.slots[i] },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => { const i = h.cursor++, old = h.slots[i] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (!old || deps.some((v,n) => !Object.is(v,old.deps[n]))) { old?.cleanup?.(); const slot = { deps, cleanup: undefined as (() => void) | undefined }; h.slots[i] = slot; h.effects.push(() => { slot.cleanup = effect(); if (slot.cleanup) h.cleanups.push(slot.cleanup) }) } },
}))
vi.mock('react-router-dom', () => ({ Link: 'a', useSearchParams: () => [new URLSearchParams()] }))
vi.mock('../../hooks/useModalFocus', () => ({ useModalFocus: vi.fn() }))
vi.mock('../../lib/baseball/personalLinkReview', async original => ({ ...await original<typeof import('../../lib/baseball/personalLinkReview')>(), loadBaseballPersonalLinkSheet: (...args: unknown[]) => h.load(...args) }))
vi.mock('../../lib/baseball/personalIdentity', () => ({ createBaseballPersonalIdentityClient: (_user: string, options: { signal?: AbortSignal }) => { h.signal = options.signal ?? null; return { link: (...args: unknown[]) => h.link(...args) } } }))
const gameId = aggregateUuid(901), target = aggregateUuid(902)
let props = { gameId, userId: AGGREGATE_USER, localGameId: `cloud:${gameId}`, onLinked: () => h.linked() as Promise<void> }
let storage: Map<string,string>
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node as ReactElement<Record<string,unknown>>, ...elements(node.props.children)]
}
function render() { h.cursor = 0; h.effects = []; const tree = elements(BaseballPersonalLinks(props)); h.effects.forEach(effect => effect()); return tree }
const click = (tree: ReturnType<typeof render>, text: string) => (tree.find(row => row.type === 'button' && row.props.children === text)!.props.onClick as () => void)()
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const data = () => ({ participants: [{ id: 't1', displayName: 'Frozen Batter' }], players: [{ id: target, displayName: 'My Player' }],
  review: { gameId, participantSourceMap: { t1: null }, mapFingerprint: MAP_FINGERPRINT, activePublicationId: aggregateUuid(903) } })
async function reviewed() {
  click(render(), 'Review player links'); render(); await drain(); let tree = render()
  const select = tree.filter(row => row.type === 'select')[1]
  ;(select.props.onChange as (event: unknown) => void)({ target: { value: target } })
  ;(tree.find(row => row.type === 'textarea')!.props.onChange as (event: unknown) => void)({ target: { value: 'Correct player history' } })
  tree = render(); return tree
}
beforeEach(() => {
  h.slots = []; h.cleanups = []; h.load.mockReset(); h.link.mockReset(); h.linked.mockReset(); h.signal = null
  props = { gameId, userId: AGGREGATE_USER, localGameId: `cloud:${gameId}`, onLinked: () => h.linked() as Promise<void> }
  h.load.mockResolvedValue(data()); h.linked.mockResolvedValue(undefined); setCurrentAuthUserId(AGGREGATE_USER)
  storage = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string,value: string) => { storage.set(key,value) }, removeItem: (key: string) => { storage.delete(key) } })
})
afterEach(() => { h.cleanups.forEach(cleanup => cleanup()); resetCurrentAuthUserIdForTests(); vi.unstubAllGlobals() })
describe('BSB-7B creator personal-link sheet lifetime', () => {
  it('persists the complete immutable reviewed intent before dispatch; historical receipts never mutate lifecycle', async () => {
    const tree = await reviewed()
    h.link.mockImplementation(async intent => {
      expect([...storage.values()].map(value => JSON.parse(value))).toContainEqual(intent)
      return { acknowledged: true, receipt: { lifecycleAuthority: 'unverified', historicalReopen: { publicationId: 'P1' } } }
    })
    click(tree, 'Reopen and link'); await drain()
    expect(h.linked).toHaveBeenCalledOnce()
    const intent = h.link.mock.calls[0][0]
    expect(intent.reviewed).toMatchObject({ expectedPublicationId: aggregateUuid(903), reason: 'Correct player history' })
    expect([...storage.keys()].every(key => key.startsWith('statkeeper_baseball_link_intent:'))).toBe(true)
  })
  it.each(['close','unmount','account','game'] as const)('retains uncertain intent and never invokes status/lifecycle callbacks after %s', async mode => {
    const tree = await reviewed(), pending = deferred<{ acknowledged: boolean }>()
    h.link.mockReturnValue(pending.promise); click(tree, 'Reopen and link'); await drain()
    expect(storage.size).toBe(1)
    if (mode === 'close') (tree.find(row => row.props['aria-label'] === 'Close player links')!.props.onClick as () => void)()
    if (mode === 'unmount') h.cleanups.forEach(cleanup => cleanup())
    if (mode === 'account') { setCurrentAuthUserId('other'); setCurrentAuthUserId(AGGREGATE_USER) }
    if (mode === 'game') { props = { ...props, gameId: aggregateUuid(950) }; render() }
    pending.resolve({ acknowledged: true }); await drain()
    expect(h.linked).not.toHaveBeenCalled(); expect(storage.size).toBe(1)
    if (mode === 'close' || mode === 'unmount' || mode === 'game') expect(h.signal?.aborted).toBe(true)
  })
  it('retries the original stored operation after closing and reopening the review', async () => {
    let tree = await reviewed()
    h.link.mockRejectedValueOnce(Error('Response lost')).mockResolvedValueOnce({ acknowledged: true })
    click(tree, 'Reopen and link'); await drain()
    const original = h.link.mock.calls[0][0]
    tree = render(); (tree.find(row => row.props['aria-label'] === 'Close player links')!.props.onClick as () => void)()
    render(); click(render(), 'Review player links'); render(); await drain(); tree = render()
    click(tree, 'Retry pending link'); await drain()
    expect(h.link.mock.calls[1][0]).toEqual(original)
    expect(h.linked).toHaveBeenCalledOnce()
  })
})
