import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import BasketballClockStrip from './BasketballClockStrip'
import BasketballLineupSheet from './BasketballLineupSheet'
import { createInitialState } from '../../lib/gameReducer'
import { prepareBasketballGameStart } from '../../lib/basketball/commands'
import { getBasketballRulesProfile, upgradeBasketballRulesDraftToV3 } from '../../lib/basketball/profiles'
import { buildGameSyncFingerprint } from '../../lib/gameSyncFingerprint'
import { DEFAULT_SETTINGS } from '../../lib/settingsStorage'
import { playersWithTeamPlaceholders } from '../../lib/teamPlayers'
import { sports } from '../../config/sports'
import type { GameState } from '../../types'

// Run request effects and close callbacks with persistent hooks; browser layout is checked separately.
const harness = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, effects: [] as Array<() => unknown>, frames: [] as FrameRequestCallback[],
}))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial
    return [harness.slots[index], (value: unknown) => {
      harness.slots[index] = typeof value === 'function' ? value(harness.slots[index]) : value
    }]
  },
  useRef: (current: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = { current }
    return harness.slots[index]
  },
  useEffect: (effect: () => unknown, deps: unknown[]) => {
    const index = harness.cursor++
    const previous = harness.slots[index] as unknown[] | undefined
    if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) harness.effects.push(effect)
    harness.slots[index] = deps
  },
  useMemo: (factory: () => unknown) => factory(), useCallback: (callback: unknown) => callback,
}))

const STARTER = '70000000-0000-4000-8000-000000000101'
const BENCH = '70000000-0000-4000-8000-000000000102'
type Props = Parameters<typeof BasketballClockStrip>[0]
let props: Props
let tools: { open: boolean }
let internalLauncher: HTMLButtonElement

function launcher() {
  return { focus: vi.fn() } as unknown as HTMLButtonElement
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node as ReactElement<Record<string, unknown>>, ...elements(node.props.children)]
}
function render() {
  harness.cursor = 0
  harness.effects = []
  const tree = elements(BasketballClockStrip(props))
  for (const element of tree) {
    const ref = (element as unknown as { ref?: { current: unknown } }).ref
    if (element.type === 'details') {
      expect(element.props.open).toBeUndefined()
      if (ref) ref.current = tools
    }
    if (element.type === 'button' && element.props['aria-label'] === 'Lineup' && ref) ref.current = internalLauncher
  }
  for (const effect of harness.effects) effect()
  return tree
}
function sheet() {
  const element = render().find(element => element.type === BasketballLineupSheet)
  if (!element) throw new Error('Missing lineup sheet')
  return element.props as Parameters<typeof BasketballLineupSheet>[0]
}
function request(externalLauncher: HTMLButtonElement) {
  props.requestedLineupLauncher = externalLauncher
  props.requestedLineupSide = 'tracked'
  render()
}
function openInternal() {
  tools.open = true
  const button = render().find(element => element.type === 'button' && element.props['aria-label'] === 'Lineup')!
  ;(button.props.onClick as () => void)()
}
function flushFocus() {
  for (const frame of harness.frames.splice(0)) frame(0)
}
function save() {
  sheet().onCommit({
    teamSide: 'tracked', participantIds: [BENCH], reasonCode: 'other', reasonNote: 'Test lineup', overrideReason: null,
  })
}

beforeEach(() => {
  harness.slots = []; harness.effects = []; harness.frames = []
  tools = { open: false }
  internalLauncher = launcher()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-18T12:00:01.000Z'))
  vi.stubGlobal('window', {
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    requestAnimationFrame: (callback: FrameRequestCallback) => { harness.frames.push(callback); return harness.frames.length },
  })
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const base: GameState = {
    ...createInitialState(), sport: sports.find(sport => sport.id === 'basketball')!, gameDataAuthority: 'sport_events',
    gameInfo: { teamName: 'Falcons', opponentName: 'Wolves', date: '2026-10-18', tournamentName: '', tournamentId: null },
    players: playersWithTeamPlaceholders([
      { id: 'p1', name: 'Avery', number: '1', stats: {} },
      { id: 'p2', name: 'Blake', number: '2', stats: {} },
    ], 'Falcons', 'Wolves')!,
  }
  const result = prepareBasketballGameStart(base, {
    recorderUserId: null, occurredAt: '2026-10-18T12:00:00.000Z', reviewedSetup: {
      rulesSnapshot: upgradeBasketballRulesDraftToV3(getBasketballRulesProfile('nfhs', 1)!.rules, 'nfhs'),
      rulesSource: { profileId: 'nfhs', profileVersion: 1, personalRevision: null, teamRevision: null, hasExplicitMatchOverrides: true },
      sourceTeamId: null, sourceSeasonId: null, courtOrientation: 'standard',
      version3Setup: {
        participants: [
          { id: STARTER, playerId: 'p1', displayName: 'Avery', number: '1', teamSide: 'tracked', initialStatus: 'starter', position: null, captain: false },
          { id: BENCH, playerId: 'p2', displayName: 'Blake', number: '2', teamSide: 'tracked', initialStatus: 'bench', position: null, captain: false },
        ],
        openingLineups: { tracked: { participantIds: [STARTER], shortHandedReason: 'Test lineup' }, opponent: null },
      },
    },
  })
  if (!result.ok) throw new Error(result.message)
  props = {
    state: result.state, recorderUserId: null, settings: DEFAULT_SETTINGS.basketball,
    canOverrideEqualPlay: false, compact: true,
    onRequestedLineupOpened: () => { props.requestedLineupSide = null },
    onAddParticipant: vi.fn(), onState: vi.fn(next => { props.state = next }),
  }
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Basketball lineup launcher focus', () => {
  it.each([false, true])('returns Cancel to the external launcher with clock tools open=%s unchanged', open => {
    tools.open = open
    const external = launcher()
    const before = buildGameSyncFingerprint(props.state)
    request(external)
    sheet().onClose()
    flushFocus()
    expect(external.focus).toHaveBeenCalledOnce()
    expect(internalLauncher.focus).not.toHaveBeenCalled()
    expect(tools.open).toBe(open)
    expect(render().some(element => element.type === BasketballLineupSheet)).toBe(false)
    expect(props.onState).not.toHaveBeenCalled()
    expect(buildGameSyncFingerprint(props.state)).toBe(before)
  })
  it.each([false, true])('returns Save to the external launcher with clock tools open=%s unchanged', open => {
    tools.open = open
    const external = launcher()
    const count = props.state.eventStream!.events.length
    request(external)
    save()
    flushFocus()
    expect(props.onState).toHaveBeenCalledOnce()
    expect(props.state.eventStream!.events).toHaveLength(count + 1)
    expect(props.state.eventStream!.events[count]).toMatchObject({ eventType: 'basketball.substitution' })
    expect(external.focus).toHaveBeenCalledOnce()
    expect(internalLauncher.focus).not.toHaveBeenCalled()
    expect(tools.open).toBe(open)
    expect(render().some(element => element.type === BasketballLineupSheet)).toBe(false)
  })
  it.each(['cancel', 'save'])('preserves the open tools and internal launcher on %s', action => {
    openInternal()
    if (action === 'save') save()
    else sheet().onClose()
    flushFocus()
    expect(internalLauncher.focus).toHaveBeenCalledOnce()
    expect(tools.open).toBe(true)
  })
  it('keeps a rejected Save open without moving focus or recording', () => {
    const external = launcher()
    request(external)
    sheet().onCommit({ teamSide: 'tracked', participantIds: [STARTER], reasonCode: null, reasonNote: null, overrideReason: null })
    flushFocus()
    expect(sheet().errorMessage).toContain('Change the Basketball lineup')
    expect(external.focus).not.toHaveBeenCalled()
    expect(internalLauncher.focus).not.toHaveBeenCalled()
    expect(props.onState).not.toHaveBeenCalled()
    expect(tools.open).toBe(false)
  })
  it.each(['external', 'internal'])('hands Add Participant the %s launcher without stealing dialog focus', source => {
    const external = launcher()
    if (source === 'external') request(external)
    else openInternal()
    sheet().onAddParticipant!('tracked')
    flushFocus()
    expect(props.onAddParticipant).toHaveBeenCalledWith('tracked', source === 'external' ? external : internalLauncher)
    expect(external.focus).not.toHaveBeenCalled()
    expect(internalLauncher.focus).not.toHaveBeenCalled()
    expect(props.onState).not.toHaveBeenCalled()
    expect(render().some(element => element.type === BasketballLineupSheet)).toBe(false)
    expect(tools.open).toBe(source === 'internal')
  })
})
