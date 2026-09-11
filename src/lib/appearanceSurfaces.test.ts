import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const surfaces = [
  "src/pages/GameSetup.tsx",
  "src/pages/PlayerSetup.tsx",
  "src/pages/GameCheckout.tsx",
  "src/components/basketball/BasketballSetupRulesReview.tsx",
  "src/components/basketball/BasketballOpeningLineupSetup.tsx",
  "src/pages/Leaderboard.tsx",
  "src/pages/TeamStats.tsx",
  "src/pages/TournamentStats.tsx",
  "src/pages/PlayerProfile.tsx",
  "src/pages/CareerStats.tsx",
  "src/components/PlayerStatSummaryTables.tsx",
  "src/components/basketball-aggregate/BasketballPlayerAggregateDestination.tsx",
  "src/components/soccer-aggregate/SoccerPlayerAggregateDestination.tsx",
  "src/components/soccer-aggregate/SoccerAggregateDestination.tsx",
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
  it('wraps Leaderboard team shortcut and legacy heading names', () => {
    const source = readFileSync('src/pages/Leaderboard.tsx', 'utf8')
    for (const pattern of [
      /<p className="([^"]*)">\s*\{s\?\.icon[^]*?\{teamDisplayName\(team\)\}/g,
      /<h2 className="([^"]*)">\s*\{sport\?\.icon[^]*?\{teamDisplayName\(selectedTeam\)\}/g,
    ]) {
      const labels = [...source.matchAll(pattern)]
      expect(labels).toHaveLength(1)
      expect(labels[0][1].split(/\s+/)).toContain('break-words')
    }
  })
  it('bounds both sports Team Stats tournament Explore links', () => {
    const source = readFileSync('src/pages/TeamStats.tsx', 'utf8')
    const links = [...source.matchAll(/className="([^"]*)"\s*>\s*\{tournament.name\}/g)]
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link[1].split(/\s+/)).toContain('max-w-full')
      expect(link[1].split(/\s+/)).toContain('break-words')
    }
  })
  it.each(['TeamStats', 'TournamentStats'])('bounds %s legacy game text beside scores', page => {
    const source = readFileSync(`src/pages/${page}.tsx`, 'utf8')
    const rows = [...source.matchAll(/<div className="([^"]*)">\s*<p className="[^"]*">\{game.game_date\}/g)]
    expect(rows).toHaveLength(1)
    expect(rows[0][1]).toBe('min-w-0 break-words')
  })
  it.each(['CareerStats', 'Leaderboard', 'TeamStats', 'TournamentStats', 'GameSetup', 'PlayerSetup', 'GameCheckout'])('keeps the %s header back button at its fixed size', page => {
    const source = readFileSync(`src/pages/${page}.tsx`, 'utf8')
    const headers = [...source.matchAll(/<header\b[^]*?<\/header>/g)]
    expect(headers).toHaveLength(1)
    const buttons = [...headers[0][0].matchAll(/<button\b[^]*?<\/button>/g)]
    expect(buttons).toHaveLength(1)
    const classes = buttons[0][0].match(/className="([^"]*)"/)?.[1].split(/\s+/)
    for (const token of ['w-8', 'h-8', 'shrink-0']) expect(classes).toContain(token)
  })
  it('keeps opening-lineup status controls readable when disabled', () => {
    const source = readFileSync('src/components/basketball/BasketballOpeningLineupSetup.tsx', 'utf8')
    const buttons = [...source.matchAll(/<button\b[^]*?<\/button>/g)]
      .filter(match => match[0].includes('aria-pressed={participant.initialStatus === option.value}'))
    expect(buttons).toHaveLength(1)
    expect(buttons[0][0]).toContain('disabled:bg-control-disabled')
    expect(buttons[0][0]).toContain('disabled:text-content-disabled')
  })
  it('bounds setup roster names and keeps jersey markers fixed', () => {
    for (const page of ['PlayerSetup', 'GameCheckout']) {
      const source = readFileSync(`src/pages/${page}.tsx`, 'utf8')
      expect(source).toContain('bg-accent text-accent-content w-10 h-10 shrink-0 rounded-full')
      const pattern = page === 'PlayerSetup'
        ? /<span className="([^"]*)">\{player.name\}<\/span>/g
        : /<div className="([^"]*)">\s*<p className="[^"]*">\{player.name\}<\/p>/g
      const labels = [...source.matchAll(pattern)]
      expect(labels).toHaveLength(1)
      for (const token of ['min-w-0', 'break-words']) {
        expect(labels[0][1].split(/\s+/)).toContain(token)
      }
    }
  })
  it('wraps the Profile header player name', () => {
    const source = readFileSync('src/pages/PlayerProfile.tsx', 'utf8')
    const labels = [...source.matchAll(/<p className="([^"]*)">\s*#\{player.jersey_number/g)]
    expect(labels).toHaveLength(1)
    expect(labels[0][1].split(/\s+/)).toContain('break-words')
  })
  it('wraps long Basketball player history source labels', () => {
    const source = readFileSync('src/components/basketball-aggregate/BasketballPlayerAggregateDestination.tsx', 'utf8')
    const labels = [...source.matchAll(/<p className="([^"]*)">\s*\{game.cloudScope === 'personal'/g)]
    expect(labels).toHaveLength(1)
    expect(labels[0][1].split(/\s+/)).toContain('break-words')
  })
  it.each(['Basketball', 'Soccer'])('keeps %s player refresh buttons from shrinking', sport => {
    const source = readFileSync(`src/components/${sport.toLowerCase()}-aggregate/${sport}PlayerAggregateDestination.tsx`, 'utf8')
    const buttons = [...source.matchAll(/<button\b[^]*?<\/button>/g)].map(match => match[0])
    const label = `Refresh ${sport === 'Soccer' ? 'soccer' : sport} statistics`
    const matches = buttons.filter(button => button.includes(`aria-label="${label}"`))
    expect(matches).toHaveLength(1)
    expect(matches[0].match(/className="([^"]*)"/)?.[1].split(/\s+/)).toContain('shrink-0')
  })
  it.each(['Basketball', 'Soccer'])('keeps %s aggregate header buttons from shrinking', sport => {
    const source = readFileSync(`src/components/${sport.toLowerCase()}-aggregate/${sport}AggregateDestination.tsx`, 'utf8')
    const buttons = [...source.matchAll(/<button\b[^]*?<\/button>/g)].map(match => match[0])
    for (const label of ['Back', `Refresh ${sport === 'Soccer' ? 'soccer' : sport} statistics`]) {
      const matches = buttons.filter(button => button.includes(`aria-label="${label}"`))
      expect(matches).toHaveLength(1)
      const classes = matches[0].match(/className="([^"]*)"/)?.[1].split(/\s+/)
      expect(classes).toContain('shrink-0')
    }
  })
  it.each(['Basketball', 'Soccer'])('bounds the %s aggregate sticky player column', sport => {
    const source = readFileSync(`src/components/${sport.toLowerCase()}-aggregate/${sport}AggregateDestination.tsx`, 'utf8')
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
    ['src/components/basketball-aggregate/BasketballPlayerAggregateDestination.tsx', 'w-9 h-9 rounded-lg border border-line'],
    ['src/components/soccer-aggregate/SoccerPlayerAggregateDestination.tsx', 'w-9 h-9 rounded-lg border border-line'],
    ['src/components/soccer-aggregate/SoccerAggregateDestination.tsx', 'w-9 h-9 rounded-lg border border-line'],
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
