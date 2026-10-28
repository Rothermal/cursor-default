import { describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import TrackerSideSelector from './TrackerSideSelector'
import { EventCloudStatus } from './game-events/EventCloudSync'
import HockeyRink from './hockey/HockeyRink'
import { createInitialState, gameReducer } from '../lib/gameReducer'
import { buildGameSyncFingerprint, withLastSyncedGameFingerprint } from '../lib/gameSyncFingerprint'
import { sports } from '../config/sports'
import type { GameState } from '../types'

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node as ReactElement<Record<string, unknown>>, ...elements(node.props.children)]
}

function statusMarkup(state: GameState) {
  return renderToStaticMarkup(createElement(EventCloudStatus, { state }))
}

function boundGame(sportId: string): GameState {
  const base = createInitialState()
  return { ...base, sport: sports.find(sport => sport.id === sportId)!, gameDataAuthority: 'sport_events',
    gameInfo: { teamName: 'Home', opponentName: 'Away', date: '2026-10-24', tournamentName: '', tournamentId: null },
    cloudSync: { ...base.cloudSync, gameId: 'cloud-game', status: 'synced',
      ...(sportId === 'soccer' ? {} : { eventCloudPolicy: 'automatic' as const }) } }
}

describe('Shared tracker presentation', () => {
  it.each([['tracked', false], ['tracked', true], ['opponent', false], ['opponent', true]] as const)(
    'renders Hockey side context for %s / flipped=%s', (captureSide, flipped) => {
      // Actual tap/hold coordinates are exercised through the DOM in TrackerSurfaceGestures.test.
      const markup = renderToStaticMarkup(createElement(HockeyRink, {
        trackedDirection: 'left_to_right', captureSide, flipped, trapezoid: true,
        trackedLabel: 'Home', opponentLabel: 'Away', onLocation: vi.fn(),
      }))
      expect(markup).toContain(`${captureSide === 'tracked' ? 'Home' : 'Away'} attack`)
      expect(markup.includes('rotate-180')).toBe(flipped)
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
    expect(statusMarkup(state)).toContain(label)
    expect(JSON.stringify(state)).toBe(before)
  })
  it.each(['soccer', 'hockey', 'baseball'])('keeps a clean %s game synced after offline-to-idle reconnect', sportId => {
    const synced = withLastSyncedGameFingerprint(boundGame(sportId))
    const offline = gameReducer(synced, { type: 'SET_CLOUD_SYNC_STATE', cloudSync: { status: 'offline' } })
    expect(statusMarkup(offline)).toContain('Offline. Events sync when you reconnect.')
    const reconnected = gameReducer(offline, { type: 'SET_CLOUD_SYNC_STATE', cloudSync: { status: 'idle' } })
    const before = JSON.stringify(reconnected)
    expect(buildGameSyncFingerprint(reconnected)).toBe(reconnected.cloudSync.lastSyncedGameFingerprint)
    expect(statusMarkup(reconnected)).toContain('Synced to the cloud.')
    expect(JSON.stringify(reconnected)).toBe(before)
  })
  it.each(['soccer', 'hockey', 'baseball'])('keeps changed %s payloads pending despite an existing cloud id', sportId => {
    const synced = withLastSyncedGameFingerprint(boundGame(sportId))
    const changed = { ...synced, notes: 'Not uploaded yet', cloudSync: { ...synced.cloudSync, status: 'idle' as const } }
    const before = JSON.stringify(changed)
    expect(statusMarkup(changed)).toContain('Waiting to sync.')
    expect(JSON.stringify(changed)).toBe(before)
  })
  it('requires a bound game and a matching acknowledgment before calling idle synced', () => {
    const missingAck = boundGame('hockey')
    missingAck.cloudSync.status = 'idle'
    expect(statusMarkup(missingAck)).toContain('Waiting to sync.')
    const unbound = withLastSyncedGameFingerprint(missingAck)
    unbound.cloudSync.gameId = null
    expect(statusMarkup(unbound)).toContain('Waiting to sync.')
  })
  it.each([
    ['offline', 'Offline. Events sync when you reconnect.'],
    ['syncing', 'Syncing to the cloud…'],
    ['error', 'Checkpoint failed'],
  ] as const)('keeps %s status ahead of a matching fingerprint', (status, message) => {
    const clean = withLastSyncedGameFingerprint(boundGame('hockey'))
    const state = { ...clean, cloudSync: { ...clean.cloudSync, status, lastError: 'Checkpoint failed' } }
    expect(statusMarkup(state)).toContain(message)
  })
  it('does not mistake pending conflict-audit work for a completed sync', () => {
    const clean = withLastSyncedGameFingerprint(boundGame('hockey'))
    const state = { ...clean, cloudSync: { ...clean.cloudSync, status: 'idle' as const,
      pendingEventConflictResolutions: [{ eventId: 'event', conflictId: 'conflict', resolution: 'remote' as const }] } }
    expect(statusMarkup(state)).toContain('Waiting to sync.')
  })
})
