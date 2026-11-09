import { describe, expect, it, vi } from 'vitest'
import type { GameState, SportConfig } from '../../types'
import { createInitialState } from '../gameReducer'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { diffGameRoster } from '../rosterRefresh'
import { soccerCloudParticipants } from './cloudSync'
import { soccerEventDetail, soccerEventTitle } from './eventLabels'
import { endSoccerMatch, inspectSoccerHistory, updateSoccerParticipantNumbers } from './live'
import { soccerRecentUndoCandidates } from './recentUndo'
import { resolveSoccerMatchRules } from './rules'
import { applySoccerRosterRefresh, soccerNumberEditMode, soccerRosterRefreshParticipants } from './rosterRefresh'
import { prepareRunningSoccerKickoff } from './runningKickoff.testFixture'
import { createSoccerSportGameState } from './state'
import type { SoccerMatchSetup } from './types'

vi.mock('../supabase', () => ({ supabase: null }))

const soccer: SportConfig = {
  id: 'soccer', name: 'Soccer', icon: 'S',
  theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
  categories: [], scoreLabel: 'Goals',
}
const kickoffAt = Date.parse('2026-11-09T12:00:00.000Z')
const recorderUserId = 'user-1'
const uuid = (index: number) => `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`

function setup(): SoccerMatchSetup {
  return {
    version: 1,
    trackedTeamDesignation: 'home',
    firstPeriodAttackingDirection: 'left_to_right',
    sourceTeamId: 'team-1',
    sourceSeasonId: 'season-1',
    rulesSnapshot: resolveSoccerMatchRules({ gameOverrides: { maxOnFieldPlayers: 2 } }),
    participants: [
      { id: 'match-keeper', kind: 'player', playerId: 'keeper', displayName: 'Keeper', number: '1', initialStatus: 'starter', initialRole: { group: 'goalkeeper', label: null } },
      { id: 'match-defender', kind: 'player', playerId: 'defender', displayName: 'Defender', number: '4', initialStatus: 'starter', initialRole: { group: 'defender', label: null } },
    ],
  }
}

function kickedOff(): GameState {
  const matchSetup = setup()
  const state: GameState = {
    ...createInitialState(),
    sport: soccer,
    gameInfo: { teamName: 'Aces', opponentName: 'Bears', tournamentName: '', tournamentId: null, date: '2026-11-09' },
    players: [
      { id: 'keeper', name: 'Keeper', number: '1', stats: {} },
      { id: 'defender', name: 'Defender', number: '4', stats: {} },
    ],
    sportGameState: createSoccerSportGameState(matchSetup),
  }
  const result = prepareRunningSoccerKickoff(state, matchSetup, {
    recorderUserId,
    occurredAt: new Date(kickoffAt).toISOString(),
    eventIds: [uuid(1), uuid(2), uuid(3)],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function participants(state: GameState) {
  if (state.sportGameState?.sportId !== 'soccer') throw new Error('not soccer')
  return state.sportGameState.projection.participants
}

describe('updateSoccerParticipantNumbers', () => {
  it('records new numbers in one event that Field Undo can take back', () => {
    const state = kickedOff()
    const result = updateSoccerParticipantNumbers(state, [
      { participantId: 'match-keeper', number: ' 13 ' },
      { participantId: 'match-defender', number: '4' },
    ], 'manual', { recorderUserId, nowMs: kickoffAt + 1_000, eventIds: [uuid(4)] })
    if (!result.ok) throw new Error(result.message)
    expect(participants(result.state)['match-keeper'].number).toBe('13')
    expect(participants(result.state)['match-defender'].number).toBe('4')
    const event = inspectSoccerHistory(result.state).activeEvents.find(item => item.id === uuid(4))!
    expect(event.payload).toEqual({ changes: [{ participantId: 'match-keeper', number: '13' }], source: 'manual' })
    expect(soccerEventTitle(event)).toBe('Number change')
    expect(soccerEventDetail(event)).toBe('Roster change: now #13')
    expect(soccerRecentUndoCandidates(inspectSoccerHistory(result.state).activeEvents, { lineupBlockedReason: null }).target?.id).toBe(uuid(4))
    const rebuilt = rebuildGameEventProjection(result.state, gameEventRegistry, gameEventProjectors)
    expect(rebuilt.inspection.complete).toBe(true)
    expect(participants(rebuilt.state)['match-keeper'].number).toBe('13')
    if (result.state.sportGameState?.sportId !== 'soccer') throw new Error('not soccer')
    expect(result.state.sportGameState.setup.participants[0].number).toBe('1')
  })

  it('rejects malformed number-change payloads at the schema', () => {
    const result = updateSoccerParticipantNumbers(kickedOff(), [{ participantId: 'match-keeper', number: '13' }], 'manual', { recorderUserId, nowMs: kickoffAt + 1_000, eventIds: [uuid(5)] })
    if (!result.ok) throw new Error(result.message)
    const event = inspectSoccerHistory(result.state).activeEvents.find(item => item.id === uuid(5))!
    for (const payload of [
      { changes: [], source: 'manual' },
      { changes: [{ participantId: 'match-keeper', number: ' 13' }], source: 'manual' },
      { changes: [{ participantId: 'match-keeper', number: '1' }, { participantId: 'match-keeper', number: '2' }], source: 'manual' },
      { changes: [{ participantId: 'match-keeper', number: '13' }], source: 'other' },
    ]) {
      expect(gameEventRegistry.inspect({ ...event, payload }).ok).toBe(false)
    }
    expect(gameEventRegistry.inspect(event).ok).toBe(true)
  })

  it('refuses unknown players, no-op changes, final games and ended matches', () => {
    const state = kickedOff()
    const options = { recorderUserId, nowMs: kickoffAt + 1_000 }
    expect(updateSoccerParticipantNumbers(state, [{ participantId: 'missing', number: '2' }], 'manual', options).ok).toBe(false)
    expect(updateSoccerParticipantNumbers(state, [{ participantId: 'match-keeper', number: '1' }], 'manual', options))
      .toMatchObject({ ok: false, message: 'Nothing changed.' })
    const final = { ...state, cloudSync: { ...state.cloudSync, gameStatus: 'final' as const } }
    expect(updateSoccerParticipantNumbers(final, [{ participantId: 'match-keeper', number: '2' }], 'manual', options).ok).toBe(false)
    expect(soccerNumberEditMode(final)).toBe('reopen')
    expect(soccerNumberEditMode(state)).toBe('live')
    const ended = endSoccerMatch(state, 'abandoned', options)
    if (!ended.ok) throw new Error(ended.message)
    expect(soccerNumberEditMode(ended.state)).toBe('reopen')
    expect(updateSoccerParticipantNumbers(ended.state, [{ participantId: 'match-keeper', number: '2' }], 'manual', { recorderUserId, nowMs: kickoffAt + 2_000 }).ok).toBe(false)
  })
})

describe('applySoccerRosterRefresh', () => {
  it('compares numbers only and adds roster players to the bench with their roster role', () => {
    const state = kickedOff()
    const diff = diffGameRoster(soccerRosterRefreshParticipants(state), [
      { playerId: 'keeper', name: 'Keeper', number: '13', position: 'soccer:goalkeeper', isActive: true },
      { playerId: 'defender', name: 'Defender', number: '4', position: 'soccer:midfielder', isActive: true },
      { playerId: 'winger', name: 'Winger', number: '7', position: 'soccer:forward', isActive: true },
    ], 'number')
    expect(diff.updates.map(update => update.participantId)).toEqual(['match-keeper'])
    const result = applySoccerRosterRefresh(state, {
      recorderUserId, diff, nowMs: kickoffAt + 1_000,
      updateParticipantIds: ['match-keeper'],
      additionPlayerIds: ['winger'],
    })
    if (!result.ok) throw new Error(result.message)
    expect(participants(result.state)['match-keeper'].number).toBe('13')
    const added = Object.values(participants(result.state)).find(item => item.playerId === 'winger')!
    expect(added).toMatchObject({ number: '7', status: 'bench', role: { group: 'forward' } })
    if (result.state.sportGameState?.sportId !== 'soccer') throw new Error('not soccer')
    expect(soccerCloudParticipants(result.state.sportGameState).find(row => row.client_player_id === 'winger'))
      .toMatchObject({ source_player_id: 'winger', jersey_number: '7' })
  })
})
