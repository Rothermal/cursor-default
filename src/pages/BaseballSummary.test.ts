import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import type { GameState } from '../types'
import BaseballSummary, { BaseballSummaryContent } from './BaseballSummary'
import BaseballBoxScore from '../components/baseball/BaseballBoxScore'
import BaseballPitchPlot from '../components/baseball/BaseballPitchPlot'
import BaseballPlayDetailSheet from '../components/baseball/BaseballPlayDetailSheet'
import BaseballPlayerDetailSheet from '../components/baseball/BaseballPlayerDetailSheet'
import { baseballSummarySource, parseBaseballSummaryQuery, type BaseballSummarySource } from '../lib/baseball/summary'
import { baseballEmptyDecisions } from '../lib/baseball/decisions'
import { endBaseballGame, reopenBaseballGame } from '../lib/baseball/commands'
import { ballInPlay, ctx, expectOk, startedGame } from '../lib/baseball/testFixtures'
import { setCurrentAuthUserId, resetCurrentAuthUserIdForTests } from '../lib/authIdentity'

const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void>, cleanups: [] as Array<() => void>,
  userId: 'account-a' as string | null, query: '', localId: 'local-a', state: null as GameState | null, dispatch: vi.fn(), load: vi.fn(), navigate: vi.fn() }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = h.cursor++
    if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial
    return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }]
  },
  useRef: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = { current: initial }; return h.slots[i] },
  useMemo: (factory: () => unknown, deps: unknown[]) => {
    const i = h.cursor++, previous = h.slots[i] as { deps: unknown[]; value: unknown } | undefined
    if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) h.slots[i] = { deps, value: factory() }
    return (h.slots[i] as { value: unknown }).value
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const i = h.cursor++, previous = h.slots[i] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
      previous?.cleanup?.()
      const slot = { deps, cleanup: undefined as (() => void) | undefined }; h.slots[i] = slot
      h.effects.push(() => { slot.cleanup = effect(); if (slot.cleanup) h.cleanups.push(slot.cleanup) })
    }
  },
}))
vi.mock('react-router-dom', () => ({ Link: 'a', useSearchParams: () => [new URLSearchParams(h.query)], useNavigate: () => h.navigate }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: h.userId ? { id: h.userId } : null }) }))
vi.mock('../context/GameContext', () => ({ useGame: () => ({ state: h.state, dispatch: h.dispatch, activeLocalGameId: h.localId }) }))
vi.mock('../lib/baseball/summarySource', () => ({ loadBaseballSummarySource: (...args: unknown[]) => h.load(...args) }))

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node as ReactElement<Record<string, unknown>>, ...elements(node.props.children)]
}
function render(runEffects = true) {
  h.cursor = 0; h.effects = []
  const tree = elements(BaseballSummary())
  if (runEffects) h.effects.forEach(effect => effect())
  return tree
}
function content(tree: ReturnType<typeof render>) {
  return tree.find(element => element.type === BaseballSummaryContent) as ReactElement<Parameters<typeof BaseballSummaryContent>[0]> | undefined
}
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { resolve, promise } }
function remote(kind: BaseballSummarySource['kind'] = 'cloud_primary') {
  const state = ballInPlay(startedGame(), 'home_run')
  state.gameInfo = { teamName: 'Remote Falcons', opponentName: 'Visitors', tournamentName: '', date: '2026-10-19' }
  return { ...baseballSummarySource(state), kind }
}
function finished() {
  const state = expectOk(endBaseballGame(startedGame(), 'time_limit', ctx()))
  return { ...state, eventStream: { ...state.eventStream!, events: state.eventStream!.events.map(event => ({ ...(event as object), recorderUserId: 'account-a' })) } }
}
beforeEach(() => {
  h.slots = []; h.cursor = 0; h.effects = []; h.cleanups = []; h.userId = 'account-a'; h.query = ''; h.localId = 'local-a'
  h.state = finished(); h.dispatch.mockReset(); h.load.mockReset(); h.navigate.mockReset(); setCurrentAuthUserId(h.userId)
  // A cloud review must not touch local storage at all.
  vi.stubGlobal('localStorage', { getItem: () => { throw Error('storage read') }, setItem: () => { throw Error('storage write') }, removeItem: () => { throw Error('storage remove') } })
})
afterEach(() => { h.cleanups.forEach(cleanup => cleanup()); resetCurrentAuthUserIdForTests(); vi.unstubAllGlobals() })

describe('BSB-6C Summary request lifetime and local decision identity', () => {
  it('uses the remote source with an unrelated local game and never dispatches/persists it', async () => {
    const before = structuredClone(h.state), selected = remote()
    h.query = 'sport=baseball&gameId=remote&from=games&tab=pitches'
    h.load.mockResolvedValue(selected)
    expect(content(render())).toBeUndefined()
    await drain()
    const page = content(render())!
    expect(page.props.source).toBe(selected)
    expect(page.props.correctable).toBe(false)
    expect(page.props.query).toMatchObject({ gameId: 'remote', tab: 'pitches', from: 'games' })
    expect(page.props.onSaveDecisions(baseballEmptyDecisions())).toMatch(/changed/)
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.state).toEqual(before)
  })
  it('hides a previous source immediately on route/tab changes, before effects settle', async () => {
    const pending = deferred<BaseballSummarySource>()
    h.query = 'sport=baseball&gameId=a'; h.load.mockResolvedValueOnce(remote()).mockReturnValue(pending.promise)
    render(); await drain(); const first = content(render())!
    h.query = 'sport=baseball&gameId=b&tab=plays'
    expect(content(render(false))).toBeUndefined()
    expect(first.props.onSaveDecisions(baseballEmptyDecisions())).toMatch(/changed/)
    expect(h.dispatch).not.toHaveBeenCalled()
  })
  it('does not reuse a settled A source after navigating A -> B -> A while reads are pending', async () => {
    h.query = 'sport=baseball&gameId=a'
    h.load.mockResolvedValueOnce(remote()).mockImplementation(() => new Promise(() => {}))
    render(); await drain(); expect(content(render())).toBeDefined()
    h.query = 'sport=baseball&gameId=b'; expect(content(render())).toBeUndefined()
    h.query = 'sport=baseball&gameId=a'; expect(content(render(false))).toBeUndefined()
  })
  it.each(['account', 'route', 'unmount', 'auth-before-render'])('rejects a late %s result and stops its read lifetime', async mode => {
    const pending = deferred<BaseballSummarySource>()
    let guard!: () => void
    h.query = 'sport=baseball&gameId=a'
    h.load.mockImplementationOnce((_state, _id, _deps, current) => { guard = current; return pending.promise })
      .mockImplementation(() => new Promise(() => {}))
    render()
    const oldGuard = guard
    if (mode === 'account') {
      h.userId = 'account-b'; setCurrentAuthUserId(h.userId); render()
      h.userId = 'account-a'; setCurrentAuthUserId(h.userId); render()
    }
    if (mode === 'route') { h.query = 'sport=baseball&gameId=b'; render() }
    if (mode === 'unmount') h.cleanups.forEach(cleanup => cleanup())
    if (mode === 'auth-before-render') setCurrentAuthUserId('account-b')
    expect(oldGuard).toThrow()
    pending.resolve(remote()); await drain()
    if (mode !== 'unmount') expect(content(render(false))).toBeUndefined()
    expect(h.dispatch).not.toHaveBeenCalled()
  })
  it('clears the old source and dialogs when refreshing and handles a later failure without totals', async () => {
    h.query = 'sport=baseball&gameId=a'
    h.load.mockResolvedValueOnce(remote()).mockRejectedValueOnce(Error('unavailable'))
    render(); await drain(); const page = content(render())!
    page.props.onRefresh!()
    expect(content(render())).toBeUndefined()
    await drain()
    const tree = render()
    expect(content(tree)).toBeUndefined()
    expect(tree.some(element => element.props.role === 'alert')).toBe(true)
  })
  it('keeps current ended local decisions editable and preserves original local preferences on save', () => {
    const state = h.state!
    if (state.sportGameState?.sportId !== 'baseball') throw Error('Missing setup')
    state.sportGameState.capturePreferences.trackPitchLocation = false
    const page = content(render())!
    expect(page.props.correctable).toBe(true)
    expect(page.props.onSaveDecisions(baseballEmptyDecisions())).toBeNull()
    const next = h.dispatch.mock.calls[0][0].state as GameState
    expect(next.eventStream!.events.length).toBe(state.eventStream!.events.length + 1)
    expect(next.sportGameState?.sportId === 'baseball' && next.sportGameState.capturePreferences.trackPitchLocation).toBe(false)
  })
  it.each(['game', 'slot', 'account', 'epoch', 'unmount'])('rejects all-empty stale decisions after a %s change', mode => {
    const page = content(render())!, save = page.props.onSaveDecisions
    if (mode === 'game') h.state = finished()
    if (mode === 'slot') h.localId = 'local-b'
    if (mode === 'account') { h.userId = 'account-b'; setCurrentAuthUserId(h.userId) }
    if (mode === 'epoch') {
      h.state = expectOk(reopenBaseballGame(h.state!, 'Correct the result', { ...ctx(), recorderUserId: 'account-a' }))
      h.state = expectOk(endBaseballGame(h.state, 'time_limit', { ...ctx(), recorderUserId: 'account-a' }))
    }
    if (mode === 'unmount') h.cleanups.forEach(cleanup => cleanup())
    else render()
    expect(save(baseballEmptyDecisions())).toMatch(/changed/)
    expect(h.dispatch).not.toHaveBeenCalled()
  })
  it('uses canonical authority rather than local decisions for cloud-final local bindings', async () => {
    h.state = { ...h.state!, cloudSync: { ...h.state!.cloudSync, gameId: 'bound-final', gameStatus: 'final' } }
    h.load.mockResolvedValue(remote('canonical'))
    expect(content(render())).toBeUndefined(); await drain()
    expect(content(render())!.props).toMatchObject({ correctable: false, source: { kind: 'canonical' } })
  })
  it('does not render a foreign recorder local stream or an old account snapshot on account change', () => {
    const old = h.state!
    h.state = { ...old, eventStream: { ...old.eventStream!, events: old.eventStream!.events.map(event => ({ ...(event as object), recorderUserId: 'foreign' })) } }
    expect(content(render())).toBeUndefined()
    h.state = old; render()
    h.userId = 'account-b'; setCurrentAuthUserId(h.userId)
    expect(content(render())).toBeUndefined()
  })
})

describe('BSB-6C source-bound detail and navigation models', () => {
  it('opens remote pitch and player details from the selected source, without correction actions', () => {
    const source = remote()
    const props = { source, query: parseBaseballSummaryQuery(new URLSearchParams('gameId=g&tab=pitches')),
      back: '/games', correctable: false, onSaveDecisions: vi.fn(), onRefresh: null }
    h.slots = []; h.cursor = 0
    let tree = elements(BaseballSummaryContent(props))
    const plot = tree.find(element => element.type === BaseballPitchPlot)!
    ;(plot.props.onOpenPlay as (id: string) => void)(source.inspection.activeEvents[1].id)
    h.cursor = 0
    tree = elements(BaseballSummaryContent(props))
    const play = tree.find(element => element.type === BaseballPlayDetailSheet)!
    expect(play.props.note).toBe('This recording is read-only.')
    expect(play.props.onEdit).toBeUndefined()
    expect(play.props.onRemove).toBeUndefined()
    expect(play.props.detail).toMatchObject({ halfLabel: 'Top 1' })
    h.slots = []; h.cursor = 0
    const boxProps = { ...props, query: { ...props.query, tab: 'box' as const } }
    tree = elements(BaseballSummaryContent(boxProps))
    const box = tree.find(element => element.type === BaseballBoxScore)!
    ;(box.props.onOpenPlayer as (id: string) => void)(source.sport!.setup.participants[0].id)
    h.cursor = 0
    tree = elements(BaseballSummaryContent(boxProps))
    expect(tree.some(element => element.type === BaseballPlayerDetailSheet)).toBe(true)
    expect(h.dispatch).not.toHaveBeenCalled()
  })
  it('preserves every cloud query field on tab changes', () => {
    const source = remote()
    h.cursor = 0; h.slots = []
    const tree = elements(BaseballSummaryContent({ source, query: parseBaseballSummaryQuery(new URLSearchParams('sport=baseball&gameId=g&from=game-info&teamId=t')),
      back: '/game-info?gameId=g&teamId=t', correctable: false, onSaveDecisions: vi.fn(), onRefresh: null }))
    const tabs = tree.filter(element => element.props.role === 'tab')
    expect(tabs).toHaveLength(5)
    for (const tab of tabs) {
      ;(tab.props.onClick as () => void)()
      const target = h.navigate.mock.calls[h.navigate.mock.calls.length - 1][0] as string
      expect(parseBaseballSummaryQuery(new URLSearchParams(target.split('?')[1]))).toMatchObject({ gameId: 'g', from: 'game-info', teamId: 't' })
      expect(target).toContain('sport=baseball')
    }
  })
})
