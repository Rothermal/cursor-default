import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const surfaces = [
  "src/components/basketball-aggregate/BasketballAggregateDestination.tsx",
  "src/components/basketball/BasketballRecorderManager.tsx",
  "src/components/basketball/BasketballFinalizationPanel.tsx",
  "src/pages/GameInfo.tsx",
  "src/pages/Games.tsx",
  "src/pages/TeamRoster.tsx",
  "src/pages/TeamSchedule.tsx",
  "src/pages/SeasonInfo.tsx",
  "src/pages/Teams.tsx",
  "src/components/AccessUnavailable.tsx",
  "src/components/TeamInviteLinksPanel.tsx",
  "src/components/settings/BasketballTeamSettingsPanel.tsx",
  "src/components/settings/SoccerTeamSettingsPanel.tsx",
  "src/components/settings/BasketballLegacySeasonImport.tsx",
  "src/components/soccer/SoccerFormationEditor.tsx",
  "src/components/soccer/SoccerLineupDefaultsEditor.tsx",
  "src/components/soccer/SoccerRulesOverrideEditor.tsx",
  "src/pages/TeamInfo.tsx",
  "src/components/SegmentedControl.tsx",
  "src/components/team-info/GameCard.tsx",
  "src/components/team-info/PlayerRow.tsx",
  "src/components/team-info/QuickStatsCard.tsx",
  "src/components/team-info/RecentResultsCard.tsx",
  "src/components/team-info/RecordBadge.tsx",
  "src/components/team-info/ResultBadge.tsx",
  "src/components/team-info/RosterPreviewCard.tsx",
  "src/components/team-info/SchedulePreviewCard.tsx",
  "src/components/team-info/TeamHero.tsx",
  "src/components/team-info/TeamMembersCard.tsx",
  "src/components/team-info/TeamOverviewCards.tsx",
  "src/components/team-info/TournamentCard.tsx",
  "src/pages/SportSelect.tsx",
  "src/pages/SportDashboard.tsx",
  "src/App.tsx",
  "src/components/ConfirmDialog.tsx",
  "src/components/AppShell.tsx",
  "src/pages/Auth.tsx",
  "src/pages/AppAccessGate.tsx",
  "src/pages/TeamInvite.tsx",
  "src/components/PwaStatus.tsx",
  "src/pages/Admin.tsx",
  "src/components/settings/AccountSettings.tsx",
  "src/components/settings/AppAccessPanel.tsx",
  "src/components/settings/SoccerSettings.tsx",
  "src/components/settings/BasketballSettings.tsx",
  "src/components/settings/BasketballRulesSettingsFields.tsx",
  "src/components/AuditTrailPanel.tsx",
  "src/components/MergePlayerWizard.tsx",
  "src/components/PlayerGuardiansDialog.tsx",
  "src/components/SeasonTeamStatsEditor.tsx"
]

const rawColor = /(?:bg|text|border|divide|ring|from|via|to|fill|stroke|placeholder|caret|accent|outline|decoration|shadow)-(?:(?:[a-z]+-)+\d{2,3}\b|\[(?:#|(?:rgb|hsl|oklch|oklab|lab|lch|color)\())/
const fixedColor = /(?:bg|text|border|divide|ring|from|via|to|fill|stroke|placeholder|caret|accent|outline|decoration|shadow)-(?:white|black)(?:[\s/'"\x60]|$)/

const colorTransition = /\btransition(?:-all|-colors)?(?=[\s'"\x60]|$)/

describe('Converted application surface color ownership', () => {
  it('bounds the Basketball aggregate sticky player column', () => {
    const source = readFileSync('src/components/basketball-aggregate/BasketballAggregateDestination.tsx', 'utf8')
    const cells = [...source.matchAll(/<th className="(sticky left-0[^"]*)"/g)]
    expect(cells).toHaveLength(2)
    for (const cell of cells) expect(cell[1]).toContain('w-[180px] min-w-[180px] max-w-[180px]')
  })
  it('keeps Cloud Games status badges single-line beside wrapping team names', () => {
    const source = readFileSync('src/pages/Games.tsx', 'utf8')
    const badges = [...source.matchAll(/<span className=\{`([^`]*\$\{statusBadge\(game\.status\)\}[^`]*)`\}>/g)]
    expect(badges).toHaveLength(1)
    expect(badges[0][1]).toContain('shrink-0 whitespace-nowrap')
    const names = [...source.matchAll(/<p className="([^"]*)">\s*\{sport\?\.icon[^]*?\{team \? teamDisplayName\(team\)/g)]
    expect(names).toHaveLength(1)
    expect(names[0][1]).toContain('min-w-0 break-words')
  })
  it.each([
    ['src/components/basketball-aggregate/BasketballAggregateDestination.tsx', 'w-9 h-9 rounded-lg border border-line'],
    ['src/components/settings/BasketballTeamSettingsPanel.tsx', 'grid h-9 w-9 shrink-0'],
    ['src/components/settings/SoccerTeamSettingsPanel.tsx', 'h-9 w-9 shrink-0 grid'],
    ['src/components/soccer/SoccerFormationEditor.tsx', 'h-9 rounded-md border border-line px-3'],
    ['src/components/basketball/BasketballFinalizationPanel.tsx', 'mt-3 min-h-11 w-full bg-accent'],
  ])('keeps disabled fill and text on standalone controls in %s', (path, prefix) => {
    const source = readFileSync(path, 'utf8')
    const classes = source.match(/className="[^"]*"/g)?.filter(value => value.includes(prefix)) ?? []
    expect(classes).toHaveLength(1)
    expect(classes[0]).toContain('disabled:bg-control-disabled')
    expect(classes[0]).toContain('disabled:text-content-disabled')
    expect(classes[0]).not.toMatch(/disabled:opacity-(?!100\b)\d+/)
  })
  it('keeps Team Info grid panels within their tracks for long names', () => {
    for (const name of ['RosterPreviewCard', 'SchedulePreviewCard', 'TeamMembersCard', 'TournamentCard']) {
      expect(readFileSync(`src/components/team-info/${name}.tsx`, 'utf8')).toContain('card min-w-0')
    }
  })
  it('keeps result badges on one line beside truncated opponent names', () => {
    expect(readFileSync('src/components/team-info/ResultBadge.tsx', 'utf8')).toContain('shrink-0 whitespace-nowrap')
  })
  it.each(surfaces)('%s uses semantic utility colors', path => {
    let source = readFileSync(path, 'utf8')
    if (path === 'src/components/soccer/SoccerFormationEditor.tsx') {
      // Fixed field artwork, not application surfaces. Keep the exception exact.
      for (const [literal, count] of [
        ['border-emerald-800 bg-emerald-600', 1],
        ['border-white/80', 4],
        ['border-white bg-white text-slate-900', 1],
        ['border-dashed border-white/90 bg-emerald-800/80 text-white', 1],
      ] as const) {
        expect(source.split(literal)).toHaveLength(count + 1)
        source = source.split(literal).join('')
      }
    }
    expect(source).not.toMatch(rawColor)
    expect(source).not.toMatch(fixedColor)
    expect(source).not.toMatch(colorTransition)
  })
  it.each(['transition', 'transition-all', 'transition-colors', 'hover:transition-all', 'className="transition"', "'transition-colors'", '`transition-all`'])('rejects color transition %s', value => {
    expect(value).toMatch(colorTransition)
  })
  it.each(['transition-transform', 'transition-opacity', 'transition-shadow', 'transition-none', 'hover:transition-transform'])('allows non-color transition %s', value => {
    expect(value).not.toMatch(colorTransition)
  })
  it.each(['text-zinc-500', 'bg-sky-600', 'bg-[#ff0000]', 'bg-[rgb(255,0,0)]', 'ring-offset-slate-50', 'fill-rose-500', 'placeholder:text-teal-500', 'via-yellow-100'])('rejects raw color %s', value => {
    expect(value).toMatch(rawColor)
  })
  it.each(['text-2xl', 'border-t-2', 'ring-offset-2', 'divide-y-2', 'shadow-md', 'grid-cols-12', 'w-1/2', 'text-content-muted', 'bg-surface/95'])('allows non-palette utility %s', value => {
    expect(value).not.toMatch(rawColor)
    expect(value).not.toMatch(fixedColor)
  })
  it('preserves Google brand paths while theming the auth controls', () => {
    const auth = readFileSync('src/pages/Auth.tsx', 'utf8')
    for (const color of ['#4285F4', '#34A853', '#FBBC05', '#EA4335']) expect(auth).toContain(color)
    expect(auth).toContain('bg-surface')
  })
  it('keeps appearance controls out of the production Settings panel', () => {
    expect(readFileSync('src/pages/Admin.tsx', 'utf8')).not.toContain('setTheme')
    expect(readFileSync('vite.config.ts', 'utf8')).toContain('data-appearance-preview="${command === \'serve\'}"')
  })
})
