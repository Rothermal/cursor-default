import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { legacyBasketballShotActorError } from './legacyCourtCapture'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import CourtEventPopup from '../../components/shot-chart/CourtEventPopup'

describe('legacy court shot attribution', () => {
  it.each([TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID])('rejects team shots for %s', id => {
    expect(legacyBasketballShotActorError({ id, name: 'Team', number: '', stats: {} })).toContain('Choose a tracked player')
  })
  it('rejects missing and individual opponent actors but accepts a tracked individual', () => {
    expect(legacyBasketballShotActorError(undefined)).not.toBeNull()
    expect(legacyBasketballShotActorError({ id: 'p', name: 'P', number: '7', stats: {}, teamSide: 'opponent' })).not.toBeNull()
    expect(legacyBasketballShotActorError({ id: 'p', name: 'P', number: '7', stats: {} })).toBeNull()
  })
  it('disables both shot buttons before entering a follow-up, without disabling other stats', () => {
    const html = renderToStaticMarkup(createElement(CourtEventPopup, {
      playerLabel: 'Team', players: [], activePlayerId: TEAM_PLAYER_HOME_ID, shotType: '2pt',
      onSelectPlayer: () => {}, onPick: () => {}, onCancel: () => {}, shotDisabledMessage: 'Choose a player',
    }))
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Made<\/button>/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Missed<\/button>/)
    expect(html).toMatch(/<button(?:(?!disabled)[^>])*>Off Reb<\/button>/)
  })
})
