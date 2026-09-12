import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APPEARANCE_RELEASE_ENABLED } from './appearanceReleasePolicy'

describe('appearance release', () => {
  it('keeps production selection behind one rollback switch', () => {
    expect(APPEARANCE_RELEASE_ENABLED).toBeTypeOf('boolean')
    expect(readFileSync('vite.config.ts', 'utf8')).toContain("command === 'serve' || APPEARANCE_RELEASE_ENABLED")
  })
  it('allows mobile zoom for the release accessibility checks', () => {
    const html = readFileSync('index.html', 'utf8')
    expect(html).toContain('content="width=device-width, initial-scale=1.0"')
    expect(html).not.toMatch(/user-scalable=no|maximum-scale=1/)
  })
  it('uses pressed buttons, explicit disabled colors and an accessible persistence error', () => {
    const source = readFileSync('src/components/settings/AppearanceSettings.tsx', 'utf8')
    for (const contract of ['aria-pressed={theme === value}', 'disabled={unavailable}', 'onClick={() => setTheme(value)}',
      'disabled:bg-control-disabled', 'disabled:text-content-disabled', 'role="alert"', 'bg-accent text-accent-content']) {
      expect(source).toContain(contract)
    }
    expect(source).not.toMatch(/GameContext|SettingsContext|supabase|localStorage/)
  })
  it('keeps all JSX surface utility colors semantic', () => {
    for (const root of ['src']) {
      for (const path of readdirSync(root, { recursive: true }).map(String).filter(path => path.endsWith('.tsx'))) {
        const source = readFileSync(`${root}/${path}`, 'utf8')
        expect(source, path).not.toMatch(/(?:bg|text|border(?:-[xytrbl])?|ring(?:-offset)?|divide|fill|stroke|from|via|to|accent)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|rose|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink)-\d+)\b/)
      }
    }
  })
})
