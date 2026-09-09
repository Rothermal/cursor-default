import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const surfaces = [
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

describe('THM-2 shell and Settings color ownership', () => {
  it.each(surfaces)('%s uses semantic utility colors', path => {
    const source = readFileSync(path, 'utf8')
    expect(source).not.toMatch(/(?:bg|text|border|divide|ring|from|to)-(?:slate|gray|blue|red|amber|emerald|green|orange|purple|indigo)-\d+/)
    expect(source).not.toMatch(/(?:bg|text|border)-(?:white|black)(?:[\s/'"\x60]|$)/)
    expect(source).not.toContain('transition-colors')
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
