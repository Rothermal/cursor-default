import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppearanceSettings from '../components/settings/AppearanceSettings'

const appearance = vi.hoisted(() => ({ theme: 'light', error: null as string | null, setTheme: vi.fn() }))
vi.mock('../context/AppearanceContext', () => ({ useAppearance: () => appearance }))

describe('AppearanceSettings rendered states', () => {
  beforeEach(() => {
    appearance.theme = 'light'
    appearance.error = null
    vi.stubGlobal('document', { documentElement: { dataset: { appearancePreview: 'true' } } })
    vi.stubGlobal('window', { statkeeperAppearance: {} })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('renders nothing when the document release gate is off', () => {
    document.documentElement.dataset.appearancePreview = 'false'
    expect(renderToStaticMarkup(createElement(AppearanceSettings))).toBe('')
  })
  it('disables both controls and shows the fallback error when bootstrap is missing', () => {
    vi.stubGlobal('window', {})
    appearance.error = 'Appearance controls are unavailable. Reload to retry.'
    const html = renderToStaticMarkup(createElement(AppearanceSettings))
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0])
    expect(buttons).toHaveLength(2)
    for (const button of buttons) expect(button).toContain('disabled=""')
    expect(html).toContain('role="alert"')
    expect(html).toContain(appearance.error)
  })
  it.each(['light', 'dark'])('renders only %s as selected', theme => {
    appearance.theme = theme
    const html = renderToStaticMarkup(createElement(AppearanceSettings))
    const buttons = [...html.matchAll(/<button\b[^>]*>[^]*?<\/button>/g)].map(match => match[0])
    expect(buttons).toHaveLength(2)
    for (const [index, button] of buttons.entries()) {
      const selected = (index === 0 ? 'light' : 'dark') === theme
      expect(button).toContain(`aria-pressed="${selected}"`)
      expect(button).not.toContain('disabled=""')
      if (selected) {
        expect(button).toContain('bg-accent text-accent-content')
      } else {
        expect(button).toContain('text-content-muted hover:bg-control-hover')
        expect(button).not.toContain('bg-accent text-accent-content')
      }
    }
  })
})
