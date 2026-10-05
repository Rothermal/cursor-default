import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { GameInfo } from '../../types'
import { eventFinalizationPreviewSideLabels } from './finalizationLabels'

const inspected = { tracked: 'Hockey Blades', opponent: 'Hockey Rivals' }

function gameInfo(teamName: string, opponentName: string): GameInfo {
  return { teamName, opponentName, tournamentName: '', tournamentId: null, date: '2026-10-04' }
}

describe('finalization labels name the inspected cloud game (PR #474 review)', () => {
  it('labels the review from the loaded primary stream, whatever game is active on this device', () => {
    // Another game active locally plays no part: only the primary stream and the inspected game are inputs.
    const primary = { gameInfo: gameInfo('Hockey Blades', 'Hockey Rivals') }
    expect(eventFinalizationPreviewSideLabels(primary, inspected)).toEqual(inspected)
    expect(eventFinalizationPreviewSideLabels(
      { gameInfo: { ...gameInfo('Blades', 'Rivals'), teamNickname: 'Blades U12', opponentNickname: null } },
      inspected
    )).toEqual({ tracked: 'Blades U12', opponent: 'Rivals' })
  })

  it('falls back to the inspected game, never to generic sides, when the stream has no names', () => {
    expect(eventFinalizationPreviewSideLabels({ gameInfo: null }, inspected)).toEqual(inspected)
    expect(eventFinalizationPreviewSideLabels(null, inspected)).toEqual(inspected)
    expect(eventFinalizationPreviewSideLabels({ gameInfo: gameInfo(' ', '') }, inspected)).toEqual(inspected)
  })

  it('keeps the active game out of the shared panel labels and the Hockey caller', () => {
    const panel = readFileSync('src/components/game-events/EventFinalizationPanel.tsx', 'utf8')
    expect(panel).not.toContain('baseState.gameInfo')
    expect(panel).toContain('eventFinalizationPreviewSideLabels(preview?.projection.state, sideLabels)')
    // The published-result card reads the inspected game's names.
    expect(panel).toContain('>{sideLabels.tracked}<')
    expect(panel).toContain('>{sideLabels.opponent}<')

    const gameInfoPage = readFileSync('src/pages/GameInfo.tsx', 'utf8')
    const hockeyCall = gameInfoPage.slice(
      gameInfoPage.indexOf('<HockeyFinalizationPanel'),
      gameInfoPage.indexOf('onFinalized', gameInfoPage.indexOf('<HockeyFinalizationPanel'))
    )
    expect(hockeyCall).toContain('sideLabels={inspectedSideLabels}')
    expect(hockeyCall).not.toContain('baseState')
    expect(gameInfoPage).toContain("opponent: game?.opponent_name || 'Opponent'")
  })
})
