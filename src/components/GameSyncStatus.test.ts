import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import GameSyncStatus from './GameSyncStatus'
import Scoreboard from './Scoreboard'
import { createInitialState } from '../lib/gameReducer'
import { sports } from '../config/sports'
import type { GameState } from '../types'

const harness = vi.hoisted(() => ({ state: null as unknown }))
vi.mock('../context/GameContext', () => ({ useGame: () => ({ state: harness.state, dispatch: vi.fn() }) }))
beforeEach(() => { harness.state = { ...createInitialState(), sport: sports.find(sport => sport.id === 'basketball')!,
  gameInfo: { teamName: 'Falcons', opponentName: 'Wolves', date: '2026-10-17', tournamentName: '', tournamentId: null },
} satisfies GameState })

describe('routine game sync presentation', () => {
  it.each([
    ['offline', 'offline'], ['syncing', 'syncing...'], ['synced', 'connected'], ['error', 'error'],
  ] as const)('preserves the %s status label', (status, label) => {
    ;(harness.state as GameState).cloudSync.status = status
    expect(renderToStaticMarkup(createElement(GameSyncStatus))).toContain(`Cloud Sync: ${label}`)
  })
  it('distinguishes a confirmed save from an available connection', () => {
    Object.assign((harness.state as GameState).cloudSync, { status: 'synced', lastSyncedAt: '2026-10-17T16:00:00Z' })
    expect(renderToStaticMarkup(createElement(GameSyncStatus))).toContain('Cloud Sync: saved')
  })
  it('does not hide errors behind local-only presentation', () => {
    const state = harness.state as GameState
    state.gameDataAuthority = 'sport_events'
    state.cloudSync.eventCloudPolicy = 'local_only'
    expect(renderToStaticMarkup(createElement(GameSyncStatus))).toContain('Cloud Sync: local only')
    state.cloudSync.status = 'error'
    expect(renderToStaticMarkup(createElement(GameSyncStatus))).toContain('Cloud Sync: error')
  })
  it('keeps database diagnostics and the idle empty state', () => {
    const state = harness.state as GameState
    expect(renderToStaticMarkup(createElement(GameSyncStatus))).toBe('')
    Object.assign(state.cloudSync, { status: 'error', lastError: "Could not find the table 'public.games'" })
    expect(renderToStaticMarkup(createElement(GameSyncStatus))).toContain('Cloud Sync: run migrations')
    state.cloudSync.lastError = 'infinite recursion detected in policy'
    expect(renderToStaticMarkup(createElement(GameSyncStatus))).toContain('Cloud Sync: apply 005 migration')
  })
  it('lets the compact tracker move routine status without removing repair alerts', () => {
    Object.assign((harness.state as GameState).cloudSync, { status: 'offline', repairedPlayerLinks: ['Avery'] })
    const compact = renderToStaticMarkup(createElement(Scoreboard, { compact: true, readOnly: true, showSyncStatus: false }))
    expect(compact).not.toContain('Cloud Sync:')
    expect(compact).toContain('Fixed a duplicate cloud link for Avery')
    expect(renderToStaticMarkup(createElement(Scoreboard))).toContain('Cloud Sync: offline')
  })
})
