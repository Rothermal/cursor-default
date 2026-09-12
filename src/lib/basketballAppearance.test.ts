import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const surfaces = [
  "src/components/basketball/BasketballAddEventChooser.tsx",
  "src/components/basketball/BasketballAdministrationEditor.tsx",
  "src/components/basketball/BasketballFoulFreeThrowEditor.tsx",
  "src/components/basketball/BasketballHistoricalRelatedEventEditor.tsx",
  "src/components/basketball/BasketballHistoricalShotEditor.tsx",
  "src/components/basketball/BasketballHistoricalTimeField.tsx",
  "src/components/basketball/BasketballLineupCorrectionEditor.tsx",
  "src/components/basketball/BasketballRelatedEventEditor.tsx",
  "src/components/basketball/BasketballShotEditor.tsx",
  "src/components/basketball/BasketballTimeline.tsx",
  "src/components/basketball/BasketballValueEventEditor.tsx",
  "src/components/basketball-summary/BasketballOverview.tsx",
  "src/components/basketball-summary/BasketballPlayerDetail.tsx",
  "src/components/basketball-summary/BasketballPlayers.tsx",
  "src/components/basketball-summary/BasketballRecordingSelector.tsx",
  "src/components/basketball-summary/BasketballShotReview.tsx",
  "src/components/basketball-summary/BasketballSummaryClockStatus.tsx",
  "src/components/basketball-summary/BasketballSummaryHeader.tsx",
  "src/components/basketball-summary/BasketballSummaryTabs.tsx",
  "src/components/basketball-summary/BasketballTeamStats.tsx",
  "src/components/shot-chart/BasketballCourt.tsx",
  "src/components/shot-chart/CourtEventPopup.tsx",
  "src/components/shot-chart/ShootingSummary.tsx",
  "src/components/shot-chart/ShotChartPanel.tsx",
  "src/pages/game-summary/GameSummaryShotChartPanel.tsx",
  "src/pages/game-summary/StatCorrectionModal.tsx",
  "src/pages/GameTracker.tsx",
  "src/pages/GameSummary.tsx",
  "src/pages/BasketballSummary.tsx",
  "src/components/StatButton.tsx",
  "src/components/PlayerSelectorStrip.tsx",
  "src/components/team-stats/TeamStatSummary.tsx"
]

describe('Basketball appearance completion inventory', () => {
  it.each(surfaces)('%s has no fixed palette or animated theme changes', path => {
    const source = readFileSync(path, 'utf8')
    expect(source).not.toMatch(/(?:bg|text|border|divide|ring|from|to|fill|stroke|accent)-(?:slate|gray|zinc|neutral|stone|red|rose|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink)-\d+/)
    expect(source).not.toMatch(/(?:bg|text|border|ring)-(?:white|black)\b/)
    expect(source).not.toMatch(/disabled:opacity-\d+/)
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'className') {
        expect(node.getText(tree)).not.toMatch(/\btransition(?:-all|-colors)?(?=[\s'"\x60]|$)/)
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  })
  it('keeps court geometry independent from theme and gives artwork explicit tokens', () => {
    const source = readFileSync('src/components/shot-chart/BasketballCourt.tsx', 'utf8')
    expect(source).not.toMatch(/#[0-9a-f]{3,8}|rgba\(/i)
    for (const token of ['surface', 'line', 'hint', 'made', 'miss', 'tracked', 'opponent']) expect(source).toContain(`var(--court-${token})`)
    expect(source).toContain('r={0.8}')
    expect(source).toContain('x1={shot.x - 0.6}')
    expect(source).toContain('orientBasketballCourtPoint')
    expect(source).not.toContain('data-theme')
  })
  it('retains all stat categories with separate flash, text, and badge tokens', () => {
    const source = readFileSync('src/components/StatButton.tsx', 'utf8')
    for (const color of ['amber', 'sky', 'emerald', 'violet', 'rose', 'slate', 'orange', 'red', 'blue', 'green', 'indigo', 'teal', 'cyan', 'pink']) {
      for (const part of ['surface', 'active', 'content', 'badge', 'badge-content']) expect(source).toContain(`stat-${color}-${part}`)
    }
    expect(source).toContain('flash ? styles.activeBg : styles.bg')
    const buttons = [...source.matchAll(/<button\b[^]*?<\/button>/g)]
    expect(buttons).toHaveLength(4)
    for (const [button] of buttons) {
      expect(button).toContain('disabled:bg-control-disabled')
      expect(button).toContain('disabled:text-content-disabled')
    }
  })
  it('keeps shared editor controls sized and long labels wrapped', () => {
    const source = readFileSync('src/components/basketball/BasketballShotEditor.tsx', 'utf8')
    expect(source).toContain('bg-overlay/[0.45]')
    const close = [...source.matchAll(/<button\b[^]*?<\/button>/g)].filter(([b]) => b.includes('aria-label={`Close'))
    expect(close).toHaveLength(1)
    for (const token of ['h-10', 'w-10', 'shrink-0']) expect(close[0][0]).toContain(token)
    expect(source).toContain('min-h-10 min-w-0 break-words rounded')
    expect(source).toContain('bg-accent text-accent-content shadow-sm')
    expect(source).toContain('<span className="min-w-0 break-words">{message}</span>')
  })
})
