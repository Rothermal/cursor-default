import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('wires the selected beneficiary direction into both dialog capture paths', () => {
  const source = readFileSync('src/components/soccer/SoccerShotCaptureDialog.tsx', 'utf8')
  const tree = ts.createSourceFile('dialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations: ts.VariableDeclaration[] = []
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) declarations.push(node)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  const initializer = (name: string) => declarations.find(node => node.name.getText(tree) === name)?.initializer
  const direction = initializer('captureDirection')
  expect(direction && ts.isCallExpression(direction)).toBe(true)
  if (!direction || !ts.isCallExpression(direction)) throw new Error('Direction call missing')
  expect(direction.expression.getText(tree)).toBe('soccerScoringDirection')
  expect(direction.arguments.map(argument => argument.getText(tree))).toEqual(['teamSide', 'trackedDirection'])

  const location = initializer('eventLocation')
  expect(location && ts.isConditionalExpression(location)).toBe(true)
  if (!location || !ts.isConditionalExpression(location) || !ts.isObjectLiteralExpression(location.whenTrue)) {
    throw new Error('Located capture branch missing')
  }
  const storedDirection = location.whenTrue.properties.find(property =>
    ts.isPropertyAssignment(property) && property.name.getText(tree) === 'attackingDirection')
  expect(storedDirection && ts.isPropertyAssignment(storedDirection) && storedDirection.initializer.getText(tree)).toBe('captureDirection')

  // Both the own-goal and ordinary-shot commands must receive this same location.
  const inputs = declarations.filter(node => node.name.getText(tree) === 'input')
  expect(inputs).toHaveLength(2)
  for (const input of inputs) {
    const unwrapped = input.initializer && ts.isSatisfiesExpression(input.initializer) ? input.initializer.expression : input.initializer
    // The shot input goes through the shared `buildSoccerShotInput` builder.
    const object = unwrapped && ts.isCallExpression(unwrapped) && unwrapped.expression.getText(tree) === 'buildSoccerShotInput'
      ? unwrapped.arguments[0]
      : unwrapped
    if (!object || !ts.isObjectLiteralExpression(object)) throw new Error('Capture input missing')
    const property = object.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText(tree) === 'location')
    expect(property && ts.isPropertyAssignment(property) && property.initializer.getText(tree)).toBe('eventLocation')
  }
})

it('opens live Field and Quick Goal shots with the suggested restart source', () => {
  const tracker = readFileSync('src/pages/SoccerGameTracker.tsx', 'utf8')
  expect(tracker).toContain('openQuickShot(liveShotDraft(capturePreferences.teamSide, location))')
  expect(tracker).toContain("openQuickShot(liveShotDraft(capturePreferences.teamSide, null, 'goal'))")
  expect(tracker).toMatch(/suggestSoccerShotSource\(inspection\.activeEvents,/)
  // Only live incident captures raise the penalty kick prompt.
  expect(tracker).toContain("if (applied && result.ok && incidentDraft?.mode === 'live')")

  const dialog = readFileSync('src/components/soccer/SoccerShotCaptureDialog.tsx', 'utf8')
  // Draft defaults never override an edited event's own situation or source.
  expect(dialog).toContain('const draftSituation = event ? undefined : initializationDraft.situation')
  expect(dialog).toContain("shot?.payload.sourceEventId ?? (event ? null : initializationDraft.sourceEventId) ?? ''")
})

it('routes live shots to the compact sheet and hands off to the full dialog', () => {
  const tracker = readFileSync('src/pages/SoccerGameTracker.tsx', 'utf8')
  const sheet = readFileSync('src/components/soccer/SoccerQuickShotSheet.tsx', 'utf8')
  const dialog = readFileSync('src/components/soccer/SoccerShotCaptureDialog.tsx', 'utf8')
  // Penalty prompt uses the compact sheet; edits keep the full dialog.
  expect(tracker).toMatch(/openQuickShot\(\{\s*teamSide: penaltyPrompt\.teamSide/)
  expect(tracker).toMatch(/setCaptureDraft\(\{\s*mode: 'edit'/)
  expect(tracker).toContain('lastShooterId={soccerLastTrackedShooterId(inspection.activeEvents)}')
  expect(tracker).toMatch(/onMoreDetails=\{draft => \{\s*setQuickShotDraft\(null\)\s*setCaptureDraft\(draft\)/)
  // The compact sheet records through the same builder as the full dialog.
  expect(sheet).toContain('buildSoccerShotInput(soccerQuickShotSelection({')
  expect(sheet).toContain('recordSoccerShot(state, input, { recorderUserId })')
  expect(dialog).toContain('const input = buildSoccerShotInput({')
  // Hand-off fields are read only for new shots, never over an edited event.
  expect(dialog).toContain('const draftShooterId = event ? undefined : initializationDraft.shooterId')
  expect(dialog).toContain("primary?.participantId ?? (event ? null : initializationDraft.primaryCreatorId) ?? ''")
  expect(sheet).toMatch(/moreDetails = \(\) => onMoreDetails\(\{\s*mode: 'live',/)
})
