import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps view rotation distinct from attacking-direction changes', () => {
  const tracker = readFileSync('src/pages/SoccerGameTracker.tsx', 'utf8')
  const field = readFileSync('src/components/soccer/SoccerField.tsx', 'utf8')
  expect(tracker).toContain('Switch attacking direction')
  expect(field).toContain('Flip field view')
})

it('prefills countdown correction from added time before the clamped primary value', () => {
  const form = readFileSync('src/components/soccer/SoccerLiveActionDialog.tsx', 'utf8')
  expect(form).toContain("displayValue?.overrun?.replace(/^\\+/, '') ?? displayValue?.primary")
  expect(form).toContain('useState(Boolean(displayValue?.overrun))')
  expect(form).toContain('adjustSoccerDisplayedClock(state, elapsedMs, options, addedTime)')
})
