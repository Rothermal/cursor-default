import { describe, expect, it } from 'vitest'
import { createInitialState } from './gameReducer'
import { sports } from '../config/sports'
import { LOCAL_GAME_DELETE_WARNING, localGameDiscardError } from './localGameDiscard'

describe('explicit local-copy deletion', () => {
  const state = { ...createInitialState(), sport: sports.find(sport => sport.id === 'basketball')!,
    gameInfo: { teamName: 'Home', opponentName: 'Away', tournamentName: '', tournamentId: null, date: '2026-09-22' },
    players: [{ id: 'p1', name: 'Alex', number: '1', stats: {} }],
    cloudSync: { ...createInitialState().cloudSync, teamId: 'team', gameId: 'cloud-game' } }
  const input = { state, dirty: true, active: false, syncing: false }
  it('keeps ordinary unsynced discard blocked', () => {
    expect(localGameDiscardError(input)).toContain('unsynced')
  })
  it('allows an explicitly acknowledged parked local deletion without changing game state', () => {
    const before = JSON.stringify(state)
    expect(localGameDiscardError({ ...input, options: { allowUnsyncedLocalDelete: true } })).toBeNull()
    expect(JSON.stringify(state)).toBe(before)
  })
  it('permits deleting pre-first-sync team games without uploading', () => {
    expect(localGameDiscardError({ ...input, state: { ...state, cloudSync: { ...state.cloudSync, gameId: null } },
      options: { allowUnsyncedLocalDelete: true } })).toBeNull()
  })
  it('rejects stale confirmation after the game becomes active', () => {
    expect(localGameDiscardError({ ...input, active: true, options: { allowUnsyncedLocalDelete: true } })).toContain('now active')
  })
  it('rejects deletion during sync even with explicit acknowledgement', () => {
    expect(localGameDiscardError({ ...input, syncing: true, options: { allowUnsyncedLocalDelete: true } })).toContain('sync is in progress')
  })
  it('warns about irreversible unsynced loss and distinguishes local and cloud data', () => {
    expect(LOCAL_GAME_DELETE_WARNING).toContain('without uploading')
    expect(LOCAL_GAME_DELETE_WARNING).toContain('cloud data will not be deleted or changed')
    expect(LOCAL_GAME_DELETE_WARNING).toContain('export')
  })
})
