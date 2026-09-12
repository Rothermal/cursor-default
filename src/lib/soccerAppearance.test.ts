import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const surfaces = ['src/pages', 'src/components'].flatMap(root =>
  readdirSync(root, { recursive: true }).map(String)
    .filter(path => /(?:^|[/\\])Soccer[^/\\]*\.tsx$/.test(path))
    .map(path => `${root}/${path.replace(/\\/g, '/')}`))

describe('Soccer appearance inventory', () => {
  it('covers the complete Soccer workspace and review inventory', () => {
    expect(surfaces.length).toBeGreaterThanOrEqual(38)
  })
  it('keeps Tracker tabs selected and inactive colors distinct', () => {
    const path = 'src/pages/SoccerGameTracker.tsx'
    const tree = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const tab = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'TabButton')
    expect(tab).toBeDefined()
    const branches: string[][] = []
    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'className') {
        const findSelection = (child: ts.Node) => {
          if (ts.isConditionalExpression(child) && child.condition.getText(tree) === 'active' &&
            ts.isStringLiteral(child.whenTrue) && ts.isStringLiteral(child.whenFalse)) {
            branches.push([child.whenTrue.text, child.whenFalse.text])
          }
          ts.forEachChild(child, findSelection)
        }
        findSelection(node)
      } else {
        ts.forEachChild(node, visit)
      }
    }
    if (tab) visit(tab)
    expect(branches).toEqual([[
      'border-success-line text-success-content',
      'border-transparent text-content-muted',
    ]])
  })
  it.each(surfaces)('%s uses semantic presentation colors', path => {
    const source = readFileSync(path, 'utf8')
    expect(source).not.toMatch(/(?:bg|text|border|divide|ring|accent|from|to)-(?:slate|gray|emerald|green|blue|indigo|amber|yellow|red|rose|sky|orange)-\d+/)
    expect(source).not.toMatch(/(?:bg|text|border|ring)-(?:white|black)\b/)
    expect(source).not.toMatch(/disabled:opacity-\d+/)
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'className') {
        expect(node.getText(tree)).not.toMatch(/\btransition-(?:all|colors)\b/)
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  })
  it('keeps pitch geometry and marker meaning separate from surrounding theme', () => {
    const field = readFileSync('src/components/soccer/SoccerField.tsx', 'utf8')
    expect(field).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    for (const token of ['surface', 'line', 'tracked', 'opponent', 'ink', 'yellow-card', 'red-card']) {
      expect(field).toContain(`var(--pitch-${token})`)
    }
    expect(field).toContain('soccerFieldLocation(')
    expect(field).toContain('clusterSoccerMarkerPoints(')
    expect(field).toContain('ring-offset-surface')
    expect(field).not.toContain('data-theme')
    const palettes = readFileSync('public/appearance.css', 'utf8').split(/:root\[data-theme=['"]dark['"]\]/)
    const pitch = (css: string) => [...css.matchAll(/--pitch-([a-z-]+):\s*([\d ]+);/g)].map(match => [match[1], match[2]])
    expect(pitch(palettes[0])).toHaveLength(7)
    expect(pitch(palettes[0])).toEqual(pitch(palettes[1]))
  })
})
