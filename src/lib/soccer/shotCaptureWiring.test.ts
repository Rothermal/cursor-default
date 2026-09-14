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
    const object = input.initializer && ts.isSatisfiesExpression(input.initializer) ? input.initializer.expression : input.initializer
    if (!object || !ts.isObjectLiteralExpression(object)) throw new Error('Capture input missing')
    const property = object.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText(tree) === 'location')
    expect(property && ts.isPropertyAssignment(property) && property.initializer.getText(tree)).toBe('eventLocation')
  }
})
