import { describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import { createInitialState } from '../gameReducer'
import { isHockeySummaryRoute } from '../hockey/summary'
import { isBasketballSummaryRoute } from '../basketball/summary'
import { baseballSummaryBackPath, baseballSummaryPath, isBaseballSummaryRoute, parseBaseballSummaryQuery } from './summary'
import { resolveBaseballCloudSummaryRoute } from './summaryRoute'
import { startedGame } from './testFixtures'

describe('BSB-6C explicit navigation and authority probe', () => {
  it('round-trips every tab with the entire cloud navigation context', () => {
    for (const tab of ['overview', 'box', 'plays', 'spray', 'pitches'] as const) {
      const query = { gameId: 'game 1', tab, from: 'game-info' as const, teamId: 'team 1' }
      const params = new URLSearchParams(baseballSummaryPath(query).split('?')[1])
      expect(params.get('sport')).toBe('baseball')
      expect(parseBaseballSummaryQuery(params)).toEqual(query)
      expect(baseballSummaryBackPath(query)).toBe('/game-info?gameId=game+1&teamId=team+1')
      expect(baseballSummaryBackPath({ ...query, from: 'games' })).toBe('/games?sport=baseball')
      expect(isBaseballSummaryRoute(createInitialState(), params)).toBe(true)
      expect(isHockeySummaryRoute(createInitialState(), params)).toBe(false)
      expect(isBasketballSummaryRoute(createInitialState(), params)).toBe(false)
    }
  })
  it('preserves local legacy and sibling dispatch, while quarantining missing event data', () => {
    const local = startedGame()
    expect(isBaseballSummaryRoute({ ...local, sportGameState: null, eventStream: null }, new URLSearchParams())).toBe(true)
    expect(isBaseballSummaryRoute({ ...createInitialState(), sport: sports.find(sport => sport.id === 'baseball')! }, new URLSearchParams())).toBe(false)
    expect(isBaseballSummaryRoute(local, new URLSearchParams('sport=hockey&gameId=g'))).toBe(false)
    expect(isBaseballSummaryRoute(local, new URLSearchParams('sport=basketball'))).toBe(false)
  })
  it.each(['baseball', null])('proves bare Baseball setup as %s before fallback', async setupSport => {
    const d = { loadSport: vi.fn(async () => 'baseball'), loadSetupSport: vi.fn(async () => setupSport) }
    expect(await resolveBaseballCloudSummaryRoute('g', null, d)).toBe(setupSport === 'baseball' ? 'baseball' : 'legacy')
    expect(d.loadSetupSport).toHaveBeenCalledWith('g')
  })
  it.each(['soccer', 'hockey', 'basketball', null])('leaves %s cloud routes untouched', async sport => {
    const d = { loadSport: async () => sport, loadSetupSport: vi.fn(async () => sport) }
    expect(await resolveBaseballCloudSummaryRoute('g', null, d)).toBe('other')
    expect(d.loadSetupSport).toHaveBeenCalledTimes(1)
  })
  it('fails closed on unreadable setup, mismatched sport or cancelled metadata', async () => {
    const d = { loadSport: async () => 'baseball', loadSetupSport: vi.fn(async () => { throw Error('inaccessible setup') }) }
    await expect(resolveBaseballCloudSummaryRoute('g', 'baseball', d)).rejects.toThrow('inaccessible setup')
    await expect(resolveBaseballCloudSummaryRoute('g', 'baseball', { ...d, loadSport: async () => 'hockey', loadSetupSport: async () => 'hockey' })).rejects.toThrow('not Baseball')
    let active = true
    const authority = vi.fn()
    await expect(resolveBaseballCloudSummaryRoute('g', null, { loadSport: async () => { active = false; return 'baseball' }, loadSetupSport: authority }, () => { if (!active) throw Error('cancelled') })).rejects.toThrow('cancelled')
    expect(authority).not.toHaveBeenCalled()
  })
  it('uses persisted Baseball setup instead of active sport or a missing historical row tag', async () => {
    expect(await resolveBaseballCloudSummaryRoute('g', null, { loadSport: async () => null, loadSetupSport: async () => 'baseball' })).toBe('baseball')
    await expect(resolveBaseballCloudSummaryRoute('g', null, { loadSport: async () => 'baseball', loadSetupSport: async () => 'hockey' })).rejects.toThrow(/incompatible/)
  })
})
