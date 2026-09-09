import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

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
    document: { documentElement: root, querySelector: () => meta },
    getComputedStyle: () => ({ getPropertyValue: () => root.dataset.theme === 'dark' ? '24 25 28' : '244 245 247' }),
  })
  return { runtime: win.statkeeperAppearance, values, root, meta, storage, event: (key: string | null, storageArea: unknown = storage) => onStorage({ key, storageArea }) }
}
describe('appearance bootstrap/runtime contract', () => {
  it('keeps palette text pairs readable in both modes', () => {
    const css = readFileSync('public/appearance.css', 'utf8')
    const palettes = css.split(":root[data-theme='dark']")
    const luminance = (rgb: number[]) => rgb.map(value => {
      const s = value / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0)
    for (const palette of palettes) {
      const tokens = Object.fromEntries([...palette.matchAll(/--([a-z-]+):\s*(\d+ \d+ \d+)/g)].map(match => [match[1], luminance(match[2].split(' ').map(Number))]))
      for (const [foreground, background] of [
        ['content', 'canvas'], ['content', 'surface'], ['content-muted', 'surface'],
        ['content-subtle', 'surface'], ['content', 'surface-elevated'],
        ['accent-content', 'accent'], ['danger-action-content', 'danger-action'],
        ...['info', 'success', 'warning', 'danger'].map(name => [`${name}-content`, name]),
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
  it('keeps production Light without erasing a saved future Dark choice', () => {
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
