import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SoccerShotDetailsEditor, SoccerShotDetailsReview } from './SoccerShotDetails'
import { createSoccerEvent } from '../../lib/soccer/events'
import { shotDetailDraft } from '../../lib/soccer/shotDetails'
import type { GameEvent } from '../../lib/gameEvents/types'

describe('Soccer shot detail presentation', () => {
  it.each(['soccer.shot', 'soccer.own_goal', 'soccer.shootout_kick'])('hides empty %s Timeline detail but retains expanded review', eventType => {
    const event = createSoccerEvent({ eventType: 'soccer.shot', occurredAt: '2026-09-14T00:00:00Z',
      payload: { outcome: 'goal', situation: 'open_play' }, recorderUserId: null,
      sequence: 1, period: { id: 'regulation-1', order: 1 }, elapsedMs: 0,
      location: { x: 0.8, y: 0.5, attackingDirection: 'left_to_right' },
      actors: [{ kind: 'team', role: 'shooter', label: 'Team' }] }) as GameEvent
    event.eventType = eventType
    event.payload = eventType === 'soccer.shot' ? event.payload
      : eventType === 'soccer.own_goal' ? {} : { outcome: 'scored', anonymousKickerSlot: null }
    expect(renderToStaticMarkup(createElement(SoccerShotDetailsReview, { event, collapsed: true }))).toBe('')
    const expanded = renderToStaticMarkup(createElement(SoccerShotDetailsReview, { event }))
    expect(expanded).toContain('Body part: Unspecified')
    expect(expanded).toContain('Placement unrecorded')
    event.payload.goalPlacement = { x: 0.25, y: 0.75 }
    expect(renderToStaticMarkup(createElement(SoccerShotDetailsReview, { event, collapsed: true }))).toContain('<details')
  })

  it('keeps capture collapsed, and only offers Header outside shootouts', () => {
    for (const shootout of [false, true]) {
      const html = renderToStaticMarkup(createElement(SoccerShotDetailsEditor, {
        value: shotDetailDraft(), onChange: () => {}, goal: true, shootout,
      }))
      expect(html).toContain('<details class=')
      expect(html).not.toContain(' open=""')
      expect(html.includes('value="header"')).toBe(!shootout)
      expect(html).toContain('Goal mouth, facing the goal')
      expect(html).toContain('Goal placement horizontal')
      expect(html).toContain('Goal placement vertical')
      expect(html.includes('Approach angle unavailable')).toBe(!shootout)
    }
  })

  it('omits placement and approach controls for non-goals', () => {
    const html = renderToStaticMarkup(createElement(SoccerShotDetailsEditor, {
      value: shotDetailDraft(), onChange: () => {}, goal: false,
    }))
    expect(html).toContain('Body part')
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('Goal placement')
  })

  it('reviews recorded detail without inventing absent placement', () => {
    const event = createSoccerEvent({ eventType: 'soccer.shot', occurredAt: '2026-09-14T00:00:00Z',
      payload: { outcome: 'goal', situation: 'open_play', bodyPart: 'header' }, recorderUserId: null,
      sequence: 1, period: { id: 'regulation-1', order: 1 }, elapsedMs: 0,
      location: { x: 0.8, y: 0.5, attackingDirection: 'left_to_right' },
      actors: [{ kind: 'team', role: 'shooter', label: 'Team' }] })
    const html = renderToStaticMarkup(createElement(SoccerShotDetailsReview, { event, collapsed: true }))
    expect(html).toContain('Shot details - Header')
    expect(html).toContain('Placement unrecorded')
    expect(html).toContain('Approach: 0 degrees')
    expect(event.payload).not.toHaveProperty('goalPlacement')
  })
})
