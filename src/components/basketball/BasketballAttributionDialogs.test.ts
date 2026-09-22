import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import BasketballQuickFreeThrowDialog from './BasketballQuickFreeThrowDialog'
import CourtEventPopup from '../shot-chart/CourtEventPopup'
import ActorSelect from '../ActorSelect'
import { playersWithTeamPlaceholders, TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../../lib/teamPlayers'

// Exercise real component callbacks; browser effects and layout are checked separately.
const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = initial
    return [harness.slots[index], (value: unknown) => { harness.slots[index] = value }]
  },
  useRef: (current: unknown) => ({ current }),
  useEffect: () => {},
}))
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node as ReactElement<Record<string, unknown>>, ...elements(node.props.children)]
}
function button(tree: ReactNode, label: string) {
  const found = elements(tree).find(element => element.type === 'button' && element.props.children === label)
  if (!found) throw Error(`Missing ${label}`)
  return found.props as { disabled?: boolean; onClick: () => void }
}
beforeEach(() => { harness.slots = []; harness.cursor = 0 })

describe('live attribution dialog review regressions', () => {
  it('blocks missing and stale standalone shooters without selecting a replacement', () => {
    const onRecord = vi.fn()
    const props = { teamName: 'Home', candidates: [{ value: 'p1', label: 'One' }], trips: [],
      defaultPlayerId: null, error: null, onTrip: vi.fn(), onRecord, onClose: vi.fn() }
    const render = (candidates = props.candidates) => { harness.cursor = 0; return BasketballQuickFreeThrowDialog({ ...props, candidates }) }
    let tree = render()
    for (const label of ['Made', 'Miss']) {
      expect(button(tree, label).disabled).toBe(true)
      button(tree, label).onClick()
    }
    expect(onRecord).not.toHaveBeenCalled()
    const select = elements(tree).find(element => element.type === ActorSelect)!
    ;(select.props.onChange as (id: string) => void)('p1')
    tree = render()
    expect(button(tree, 'Made').disabled).toBe(false)
    button(tree, 'Made').onClick()
    expect(onRecord).toHaveBeenCalledWith('p1', true)
    onRecord.mockClear()
    tree = render([{ value: 'p2', label: 'Two' }])
    expect(button(tree, 'Made').disabled).toBe(true)
    button(tree, 'Made').onClick()
    expect(onRecord).not.toHaveBeenCalled()
  })
  it.each([TEAM_PLAYER_OPP_ID, TEAM_PLAYER_HOME_ID])('preserves the existing assist policy for %s in the actual popup', shooter => {
    const onPick = vi.fn()
    const players = playersWithTeamPlaceholders([
      { id: 'home1', name: 'Home one', number: '1', stats: {} },
      { id: 'away7', name: 'Away seven', number: '7', stats: {}, teamSide: 'opponent' },
    ], 'Home', 'Away')!
    const render = () => { harness.cursor = 0; return CourtEventPopup({ playerLabel: 'Team', players,
      activePlayerId: shooter, onSelectPlayer: vi.fn(), shotType: '2pt', onPick, onCancel: vi.fn() }) }
    let tree = render()
    const keyTarget = elements(tree).find(element => element.props.onKeyDownCapture)!
    ;(keyTarget.props.onKeyDownCapture as (event: { key: string }) => void)({ key: 'Enter' })
    button(tree, 'Made').onClick()
    if (shooter === TEAM_PLAYER_OPP_ID) {
      expect(onPick).toHaveBeenCalledWith({ kind: 'shot', made: true, shotType: '2pt' })
    } else {
      expect(onPick).not.toHaveBeenCalled()
      tree = render()
      const select = elements(tree).find(element => element.type === ActorSelect && element.props.label === 'Assisted by')!
      expect(select.props.options).toEqual([{ value: 'home1', label: '#1 Home one' }])
    }
  })
})
