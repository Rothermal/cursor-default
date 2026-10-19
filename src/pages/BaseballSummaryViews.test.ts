import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { BaseballSummaryContent } from './BaseballSummary'
import { baseballSummarySource, type BaseballSummarySource, type BaseballSummaryTab } from '../lib/baseball/summary'
import { endBaseballGame } from '../lib/baseball/commands'
import { saveBaseballPitcherDecisions, baseballEmptyDecisions } from '../lib/baseball/decisions'
import { ballInPlay, ctx, expectOk, pitch, startedGame } from '../lib/baseball/testFixtures'

function selected(kind: BaseballSummarySource['kind']): BaseballSummarySource {
  let state = ballInPlay(pitch(startedGame(), { result: 'ball', pitchLocation: { x: 0.4, y: 0.4 } }), 'home_run')
  state = expectOk(endBaseballGame(state, 'time_limit', ctx()))
  state = expectOk(saveBaseballPitcherDecisions(state, baseballEmptyDecisions(), ctx()))
  state.gameInfo = { teamName: 'Selected Falcons', opponentName: 'Visitors', tournamentName: '', date: '2026-10-19' }
  return { ...baseballSummarySource(state), kind, recorderName: kind === 'local' ? null : 'Remote recorder' }
}
function view(source: BaseballSummarySource, tab: BaseballSummaryTab, correctable = false) {
  return renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(BaseballSummaryContent, { source,
    query: { gameId: 'remote', tab, from: 'games', teamId: 't' }, back: '/games?sport=baseball',
    correctable, onSaveDecisions: vi.fn(), onRefresh: vi.fn() })))
}
describe('BSB-6C all five selected-source views', () => {
  it.each(['cloud_primary', 'canonical'] as const)('renders all five %s views read-only with source-only context', kind => {
    const source = selected(kind)
    for (const tab of ['overview', 'box', 'plays', 'spray', 'pitches'] as const) {
      const html = view(source, tab, true)
      expect(html).toContain('Selected Falcons')
      expect(html).toContain('Remote recorder')
      expect(html).not.toContain('Set decisions')
      expect(html).not.toContain('Change decisions')
      expect(html).not.toContain('/game?tab=timeline')
      expect(html).toContain('/games?sport=baseball')
      if (tab === 'overview') expect(html).toContain('Set with no decisions.')
      if (tab === 'box') expect(html).toContain('Selected Falcons batting')
      if (tab === 'plays') expect(html).toContain('Home run')
      if (tab === 'pitches') expect(html).toContain('Pitch counts')
    }
  })
  it.each(['overview', 'box', 'plays', 'spray', 'pitches'] as const)('withholds every %s detail/total for unhealthy remote data', tab => {
    const source = { ...selected('canonical'), healthy: false, diagnostic: 'Publication is quarantined' }
    const html = view(source, tab)
    expect(html).toContain('Selected Falcons')
    expect(html).toContain('Publication is quarantined')
    expect(html).not.toContain('role="tab"')
    expect(html).not.toContain('<table')
    expect(html).not.toContain('<svg aria-label="Pitch')
    expect(html).not.toContain('Home run')
    expect(html).not.toContain('Set decisions')
  })
  it('preserves decisions and Timeline links only for current correctable local review', () => {
    const source = selected('local')
    expect(view(source, 'overview', true)).toContain('Change decisions')
    expect(view(source, 'plays', true)).toContain('/game?tab=timeline')
    expect(view(source, 'overview', false)).not.toContain('Change decisions')
  })
})
