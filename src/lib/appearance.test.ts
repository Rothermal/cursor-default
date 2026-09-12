import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { resolveAppearanceRuntime } from './appearanceRuntime'

const source = readFileSync('public/appearance.js', 'utf8')
function boot(raw: string | null = null, enabled = true, blocked = false) {
  const values = new Map<string, string>()
  if (raw !== null) values.set('statkeeper_appearance', raw)
  const root = { dataset: { appearancePreview: String(enabled), theme: '' }, style: { colorScheme: '' } }
  const meta = { content: '' }
  const storage = {
    getItem: (key: string) => { if (blocked) throw new Error('blocked'); return values.get(key) ?? null },
    setItem: (key: string, value: string) => { if (blocked) throw new Error('blocked'); values.set(key, value) },
  }
  let onStorage: (event: { key: string | null; storageArea: unknown }) => void = () => {}
  const win = { addEventListener: (_: string, callback: typeof onStorage) => { onStorage = callback } } as unknown as Window
  runInNewContext(source, {
    window: win, localStorage: storage,
    document: { documentElement: root, querySelector: (selector: string) => selector === 'meta[name="theme-color"]' ? meta : null },
    getComputedStyle: () => ({ getPropertyValue: () => root.dataset.theme === 'dark' ? '24 25 28' : '244 245 247' }),
  })
  return { runtime: win.statkeeperAppearance!, values, root, meta, storage, event: (key: string | null, storageArea: unknown = storage) => onStorage({ key, storageArea }) }
}
describe('appearance bootstrap/runtime contract', () => {
  it('keeps the build gate, static meta and Light-only splash contract explicit', () => {
    const config = readFileSync('vite.config.ts', 'utf8')
    const html = readFileSync('index.html', 'utf8')
    expect(config).toContain('data-appearance-preview="${command === \'serve\' || APPEARANCE_RELEASE_ENABLED}"')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<meta name="theme-color" content="#f4f5f7" />')
    expect(config).toContain("background_color: '#f4f5f7'")
    expect(config).toContain("theme_color: '#35383e'")
    expect(html.indexOf('appearance.css')).toBeLessThan(html.indexOf('appearance.js'))
    expect(html.indexOf('appearance.js')).toBeLessThan(html.indexOf('/src/main.tsx'))
  })
  it('survives missing bootstrap with a stable, non-writing Light fallback', () => {
    expect(readFileSync('src/context/AppearanceContext.tsx', 'utf8'))
      .toContain('resolveAppearanceRuntime(window.statkeeperAppearance)')
    const runtime = resolveAppearanceRuntime(undefined)
    const snapshot = runtime.getSnapshot()
    runtime.setTheme('dark')
    runtime.subscribe(() => { throw new Error('must not notify') })()
    expect(runtime.getSnapshot()).toBe(snapshot)
    expect(snapshot.theme).toBe('light')
    expect(resolveAppearanceRuntime(undefined)).toBe(runtime)
    const live = boot().runtime
    expect(resolveAppearanceRuntime(live)).toBe(live)
  })
  it('keeps palette text pairs readable in both modes', () => {
    const css = readFileSync('public/appearance.css', 'utf8')
    const palettes = css.split(/:root\[data-theme=['"]dark['"]\]/)
    expect(palettes).toHaveLength(2)
    const config = runInNewContext(readFileSync('tailwind.config.js', 'utf8').replace('export default', 'globalThis.config ='))
    const aliases = Object.keys(config.theme.extend.colors).sort()
    expect(aliases.length).toBeGreaterThan(0)
    const luminance = (rgb: number[]) => rgb.map(value => {
      const s = value / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0)
    for (const palette of palettes) {
      const tokens = Object.fromEntries([...palette.matchAll(/--([a-z-]+):\s*(\d+ \d+ \d+)/g)].map(match => [match[1], luminance(match[2].split(' ').map(Number))]))
      expect(Object.keys(tokens).sort()).toEqual(aliases)
      for (const name of aliases) expect(config.theme.extend.colors[name]).toBe(`rgb(var(--${name}) / <alpha-value>)`)
      for (const [foreground, background] of [
        ['content', 'canvas'], ['content', 'surface'], ['content-muted', 'surface'],
        ['content-subtle', 'surface'], ['content', 'surface-elevated'],
        ['content-disabled', 'control-disabled'], ['content-muted', 'control'],
        ['content-muted', 'control-hover'],
        ['accent-content', 'accent'], ['danger-action-content', 'danger-action'],
        ...['info', 'success', 'warning', 'danger'].map(name => [`${name}-content`, name]),
        ...['amber', 'sky', 'emerald', 'violet', 'rose', 'slate', 'orange', 'red', 'blue', 'green', 'indigo', 'teal', 'cyan', 'pink']
          .flatMap(color => [
            [`stat-${color}-content`, `stat-${color}-surface`],
            [`stat-${color}-content`, `stat-${color}-active`],
            [`stat-${color}-badge-content`, `stat-${color}-badge`],
          ]),
        ['court-hint', 'court-surface'],
      ]) {
        const a = tokens[foreground], b = tokens[background]
        expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), `${foreground}/${background}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
  it.each([null, '', '{', '{}', 'null', '[]', '{"version":2,"theme":"dark"}', '{"version":1,"theme":"system"}', '{"version":1,"theme":"dark","extra":true}'])('defaults malformed records to Light: %s', raw => {
    expect(boot(raw).runtime.getSnapshot().theme).toBe('light')
  })
  it('applies saved Dark before React and shares the exact runtime document writer', () => {
    const app = boot('{"version":1,"theme":"dark"}')
    expect(app.root.dataset.theme).toBe('dark')
    expect(app.root.style.colorScheme).toBe('dark')
    expect(app.meta.content).toBe('rgb(24 25 28)')
    app.runtime.setTheme('light')
    expect(app.meta.content).toBe('rgb(244 245 247)')
    expect(JSON.parse(app.values.get('statkeeper_appearance')!)).toEqual({ version: 1, theme: 'light' })
  })
  it('supports rollback to Light without erasing a saved Dark choice', () => {
    const raw = '{"version":1,"theme":"dark"}'
    const app = boot(raw, false)
    app.runtime.setTheme('dark')
    expect(app.runtime.getSnapshot().theme).toBe('light')
    expect(app.values.get('statkeeper_appearance')).toBe(raw)
  })
  it('applies session-only changes if storage is blocked', () => {
    const app = boot(null, true, true)
    app.runtime.setTheme('dark')
    expect(app.runtime.getSnapshot()).toEqual({ theme: 'dark', error: "Appearance couldn't be saved. It may reset on reload." })
  })
  it('subscribes across tabs, ignores unrelated storage and handles removal/clear', () => {
    const app = boot()
    let calls = 0
    const stop = app.runtime.subscribe(() => calls++)
    app.values.set('statkeeper_appearance', '{"version":1,"theme":"dark"}')
    app.event('statkeeper_settings')
    expect(calls).toBe(0)
    app.event('statkeeper_appearance', {})
    expect(calls).toBe(0)
    app.event('statkeeper_appearance')
    expect(app.runtime.getSnapshot().theme).toBe('dark')
    app.values.clear()
    app.event(null)
    expect(app.runtime.getSnapshot().theme).toBe('light')
    stop()
    app.event('statkeeper_appearance')
    expect(calls).toBe(2)
  })
  it('does not write game data or legacy settings', () => {
    const app = boot()
    app.values.set('statkeeper_settings', '{}')
    app.values.set('statkeeper_game', '{"untouched":true}')
    app.runtime.setTheme('dark')
    app.values.set('statkeeper_settings', '{"legacy":true}')
    expect(app.runtime.getSnapshot().theme).toBe('dark')
    expect(app.values.get('statkeeper_game')).toBe('{"untouched":true}')
    expect(app.values.size).toBe(3)
  })
})
