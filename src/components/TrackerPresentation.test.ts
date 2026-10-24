import { describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import TrackerSideSelector from './TrackerSideSelector'
import { EventCloudStatus } from './game-events/EventCloudSync'
import HockeyRink from './hockey/HockeyRink'
import { hockeyRinkLocation } from '../lib/hockey/rinkGeometry'
import { createInitialState } from '../lib/gameReducer'
import { sports } from '../config/sports'
import type { GameState } from '../types'

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node as ReactElement<Record<string, unknown>>, ...elements(node.props.children)]
}

describe('Shared tracker presentation', () => {
  it.each([['tracked', false], ['tracked', true], ['opponent', false], ['opponent', true]] as const)(
    'preserves canonical Hockey tap mapping for %s / flipped=%s', (captureSide, flipped) => {
      const onLocation = vi.fn()
      const rink = elements(HockeyRink({ trackedDirection: 'left_to_right', captureSide, flipped, trapezoid: true, onLocation }))
        .find(element => element.props['aria-label'] === 'Hockey rink')!
      ;(rink.props.onClick as (event: unknown) => void)({ clientX: 70, clientY: 65,
        currentTarget: { getBoundingClientRect: () => ({ left: 10, top: 5, width: 200, height: 100 }) } })
      expect(onLocation).toHaveBeenCalledExactlyOnceWith(hockeyRinkLocation(0.3, 0.6, flipped, captureSide === 'tracked' ? 'left_to_right' : 'right_to_left'))
    }
  )
  it('exposes full team names, pressed state and explicit side callbacks', () => {
    const labels = { tracked: 'A very long tracked team nickname', opponent: 'A very long visiting team nickname' }
    const onChange = vi.fn()
    const buttons = elements(TrackerSideSelector({ side: 'opponent', labels, onChange })).filter(element => element.type === 'button')
    expect(buttons.map(element => element.props.children)).toEqual([labels.tracked, labels.opponent])
    expect(buttons.map(element => element.props['aria-pressed'])).toEqual([false, true])
    expect(buttons.map(element => element.props.title)).toEqual([labels.tracked, labels.opponent])
    ;(buttons[0].props.onClick as () => void)()
    expect(onChange).toHaveBeenCalledExactlyOnceWith('tracked')
    expect(buttons[0].props.className).toContain('[overflow-wrap:anywhere]')
  })
  it.each([
    [{ eventCloudPolicy: 'local_only' }, 'Saved on this device only.'],
    [{ eventCloudPolicy: 'automatic', status: 'syncing' }, 'Syncing to the cloud…'],
    [{ eventCloudPolicy: 'automatic', status: 'offline' }, 'Offline. Events sync when you reconnect.'],
    [{ eventCloudPolicy: 'automatic', status: 'synced' }, 'Synced to the cloud.'],
    [{ eventCloudPolicy: 'automatic', status: 'error', lastError: 'Checkpoint failed' }, 'Checkpoint failed'],
    [{ eventCloudPolicy: 'automatic', gameStatus: 'final' }, 'Finalized in the cloud.'],
    [{ eventCloudPolicy: 'automatic', gameId: 'cloud-game', status: 'idle' }, 'Waiting to sync.'],
  ] as Array<[Partial<GameState['cloudSync']>, string]>)('reports routine status honestly for %j', (cloudSync, label) => {
    const base = createInitialState()
    const state: GameState = { ...base, sport: sports.find(sport => sport.id === 'hockey')!, gameDataAuthority: 'sport_events',
      cloudSync: { ...base.cloudSync, ...cloudSync } }
    const before = JSON.stringify(state)
    expect(EventCloudStatus({ state }).props.children).toBe(label)
    expect(JSON.stringify(state)).toBe(before)
  })
})
