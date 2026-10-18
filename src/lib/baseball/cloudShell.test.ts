import { beforeEach, describe, expect, it, vi } from 'vitest'
import { baseballSetup } from './testFixtures'
import type { BaseballMatchSetup } from './types'

const rows = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('../gameEvents/cloudShell', () => ({
  loadEventCloudShellRows: vi.fn(async () => rows.current),
  loadEventCloudDataAuthority: vi.fn(),
}))

const { createBaseballIndependentRecorderState, loadBaseballCloudShell } = await import('./cloudSync')

function teamSetup(): BaseballMatchSetup {
  return { ...baseballSetup(), sourceTeamId: 'team-1', sourceSeasonId: 'season-1' }
}

function shellRows(setup: BaseballMatchSetup, overrides: { status?: string; teamId?: string | null } = {}) {
  return {
    game: {
      id: 'cloud-game-1',
      team_id: overrides.teamId === undefined ? setup.sourceTeamId : overrides.teamId,
      season_id: setup.sourceSeasonId,
      created_by: 'user-1',
      tracked_team_name: 'Hawks',
      opponent_name: 'Visitors',
      tournament_name: null,
      game_date: '2026-10-18',
      status: overrides.status ?? 'in_progress',
    },
    setupSnapshot: setup,
    participants: setup.participants.map(participant => ({
      id: `row-${participant.id}`,
      client_participant_id: participant.id,
      client_player_id: participant.playerId,
      display_name: participant.displayName,
      jersey_number: participant.number,
    })),
  }
}

beforeEach(() => {
  rows.current = shellRows(teamSetup())
})

describe('BSB-6B cloud shell', () => {
  it('rebuilds a cloud game with the setup players and an automatic policy', async () => {
    const shell = await loadBaseballCloudShell('cloud-game-1')
    expect(shell.state.sport?.id).toBe('baseball')
    expect(shell.state.players.map(player => player.id)).toEqual(teamSetup().participants.map(entry => entry.playerId))
    expect(shell.state.cloudSync).toMatchObject({
      eventCloudPolicy: 'automatic',
      gameId: 'cloud-game-1',
      teamId: 'team-1',
      seasonId: 'season-1',
    })
    expect(shell.state.cloudSync.playerIdMap['player-t1']).toBe('row-t1')
    expect(shell.cloudToLocalPlayerId['row-t1']).toBe('player-t1')
    expect(shell.state.sportGameState?.sportId === 'baseball' && shell.state.sportGameState.setup).toEqual(teamSetup())
  })

  it('refuses a setup that does not match its game row or participants', async () => {
    rows.current = shellRows(teamSetup(), { teamId: 'team-2' })
    await expect(loadBaseballCloudShell('cloud-game-1')).rejects.toThrow('setup source does not match')

    const renamed = shellRows(teamSetup())
    renamed.participants[0] = { ...renamed.participants[0], display_name: 'Someone else' }
    rows.current = renamed
    await expect(loadBaseballCloudShell('cloud-game-1')).rejects.toThrow('participant identity does not match')

    rows.current = { ...shellRows(teamSetup()), setupSnapshot: { ...teamSetup(), version: 2 } }
    await expect(loadBaseballCloudShell('cloud-game-1')).rejects.toThrow('Cloud Baseball setup is invalid')
  })

  it('starts an independent recorder with an empty stream that is not yet started', async () => {
    const state = await createBaseballIndependentRecorderState('cloud-game-1')
    expect(state.eventStream?.events).toEqual([])
    expect(state.sportGameState?.sportId === 'baseball' && state.sportGameState.projection.status).toBe('pregame')
    expect(state.cloudSync.gameId).toBe('cloud-game-1')
  })

  it('cannot add a recorder to a final game', async () => {
    rows.current = shellRows(teamSetup(), { status: 'final' })
    await expect(createBaseballIndependentRecorderState('cloud-game-1')).rejects.toThrow('Finalized games cannot add a recorder')
  })
})
