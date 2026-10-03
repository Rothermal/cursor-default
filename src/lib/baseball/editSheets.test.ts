import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import BaseballCorrectionPreviewSheet from '../../components/baseball/BaseballCorrectionPreviewSheet'
import BaseballEditPlay from '../../components/baseball/BaseballEditPlay'
import BaseballPlayDetailSheet from '../../components/baseball/BaseballPlayDetailSheet'
import BaseballRepairAttributionSheet from '../../components/baseball/BaseballRepairAttributionSheet'
import type { GameState } from '../../types'
import { adjustBaseballScore, substituteBaseball } from './commands'
import { previewBaseballEdit, previewBaseballRemoval, removeBaseballPlay, type BaseballCorrectionPreview } from './corrections'
import {
  baseballCaptureEdit,
  baseballEditTarget,
  baseballMismatchedRoles,
  baseballRoleLabel,
  baseballSubstitutionEditDraft,
  type BaseballEditTarget,
} from './edits'
import { baseballPlayDetail } from './recentPlays'
import { baseballSubstitutionChoices } from './substitutionOptions'
import { ballInPlay, ctx, expectOk, pitches, startedGame, threeUpThreeDown } from './testFixtures'
import { baseballActiveEvents } from './units'

const names = { tracked: 'Aces', opponent: 'Visitors' }
const newest = (state: GameState) => baseballActiveEvents(state).slice(-1)[0]!
const noop = () => undefined

function target(state: GameState, id: string): BaseballEditTarget {
  const result = baseballEditTarget(state, id)
  if (!result.ok) throw new Error(result.message)
  return result.target
}

function renderEdit(t: BaseballEditTarget) {
  return renderToStaticMarkup(createElement(BaseballEditPlay, {
    target: t,
    label: 'Play',
    halfLabel: 'Top 1',
    names,
    trackPitchLocation: false,
    trackBattedBallLocation: false,
    onCancel: noop,
    onPreview: noop,
  }))
}

describe('Baseball edit sheets', () => {
  it('reopens a pitch on the pad and says what was recorded', () => {
    const state = pitches(startedGame(), 'ball')
    const markup = renderEdit(target(state, newest(state).id))
    expect(markup).toContain('Edit: Play')
    expect(markup).toContain('Recorded: <span class="font-semibold">Ball</span>')
    expect(markup).toContain('aria-label="Pitch pad"')
    expect(markup).toContain('the game as it stood before this play')
  })

  it('seeds a tracked substitution with the recorded option, and the score adjustment form', () => {
    let state = threeUpThreeDown(startedGame())
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'pinch_hitter', incomingId: 't10', outgoingId: 't1' }, ctx()))
    const t = target(state, newest(state).id)
    if (t.seed.kind !== 'substitution') throw new Error('not a substitution')
    const draft = baseballSubstitutionEditDraft(baseballSubstitutionChoices(t.prefix), t.seed.changes)
    expect(draft).toMatchObject({ kind: 'pinch_hitter', groupKey: expect.any(String), optionKey: expect.any(String) })
    expect(renderEdit(t)).toContain('Aces substitution')

    state = expectOk(adjustBaseballScore(state, 'tracked', 2, 'missed runs', ctx()))
    const markup = renderEdit(target(state, newest(state).id))
    expect(markup).toContain('aria-label="Score adjustment"')
    expect(markup).toContain('value="2"')
    expect(markup).toContain('value="missed runs"')
  })

  it('the preview names an edit and who is recorded', () => {
    const state = ballInPlay(startedGame(), 'out', { fielders: [6, 3] })
    const t = target(state, newest(state).id)
    if (t.seed.kind !== 'capture' || t.seed.capture.source !== 'pitch' || !t.seed.capture.battedBall) throw new Error('not a ball in play')
    const capture = { ...t.seed.capture, battedBall: { ...t.seed.capture.battedBall, inPlay: { ...t.seed.capture.battedBall.inPlay, fielders: [4, 3] } } }
    const result = previewBaseballEdit(state, baseballCaptureEdit(t, capture, t.seed.movements.map(movement =>
      movement.to === 'out' ? { ...movement, fielders: [4, 3] } : movement)), names)
    if (!result.ok) throw new Error(result.message)
    const markup = renderToStaticMarkup(createElement(BaseballCorrectionPreviewSheet, {
      preview: result.preview as BaseballCorrectionPreview,
      error: null,
      onCancel: noop,
      onConfirm: noop,
    }))
    expect(markup).toContain('aria-label="Edit play"')
    expect(markup).toContain('>Edit</h2>')
    expect(markup).toContain('Who is recorded')
    expect(markup).toContain('Fielder at 2B: now recorded as #4 Player 4')
    expect(markup).toContain('Save with these changes')
  })

  it('the detail sheet offers Edit and Repair attribution, and the repair sheet lists the roles', () => {
    let state = expectOk(substituteBaseball(startedGame(), 'tracked', { kind: 'defensive', position: 6, incomingId: 't10', outgoingId: 't6' }, ctx()))
    const sub = newest(state)
    state = ballInPlay(state, 'out', { fielders: [6, 3] })
    const out = newest(state)
    const removal = previewBaseballRemoval(state, sub.id, names)
    if (!removal.ok) throw new Error(removal.message)
    state = expectOk(removeBaseballPlay(state, removal.preview, names, { now: new Date(Date.UTC(2026, 9, 2, 13)).toISOString(), confirmed: true }))

    const detail = renderToStaticMarkup(createElement(BaseballPlayDetailSheet, {
      detail: baseballPlayDetail(state, out.id, names)!,
      onClose: noop,
      onRemove: noop,
      onEdit: noop,
      onRepair: noop,
    }))
    expect(detail).toContain('Edit…')
    expect(detail).toContain('Repair attribution…')
    expect(detail).toContain('Remove…')

    const blocked = renderToStaticMarkup(createElement(BaseballPlayDetailSheet, {
      detail: baseballPlayDetail(state, out.id, names)!,
      onClose: noop,
      onRemove: noop,
      onEdit: null,
      editBlocked: 'This entry cannot be edited.',
    }))
    expect(blocked).not.toContain('Edit…')
    expect(blocked).toContain('This entry cannot be edited.')

    const roles = baseballMismatchedRoles(state, out.id)
    const repair = renderToStaticMarkup(createElement(BaseballRepairAttributionSheet, {
      label: 'Out',
      halfLabel: 'Top 1',
      roles,
      selected: roles.map(entry => entry.role),
      onChange: noop,
      error: null,
      onCancel: noop,
      onPreview: noop,
    }))
    expect(repair).toContain('Fielder at SS')
    expect(repair).toContain('checked=""')
  })

  it('names stamped roles', () => {
    expect(['batter', 'pitcher', 'fielder_2', 'fielder_9'].map(baseballRoleLabel)).toEqual(['Batter', 'Pitcher', 'Fielder at C', 'Fielder at RF'])
  })
})
