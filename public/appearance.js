/* Blocking bootstrap and runtime share one parser and document writer. */
;(function () {
  const key = 'statkeeper_appearance'
  const enabled = document.documentElement.dataset.appearancePreview === 'true'
  const listeners = new Set()
  let snapshot
  function parse(raw) {
    try {
      const value = JSON.parse(raw)
      return value && Object.keys(value).length === 2 && value.version === 1 &&
        (value.theme === 'light' || value.theme === 'dark') ? value.theme : 'light'
    } catch { return 'light' }
  }
  function apply(theme, error) {
    const effective = enabled && theme === 'dark' ? 'dark' : 'light'
    document.documentElement.dataset.theme = effective
    document.documentElement.style.colorScheme = effective
    const color = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim()
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.content = 'rgb(' + color + ')'
    snapshot = { theme: effective, error }
    listeners.forEach(listener => listener())
  }
  let initial = 'light'
  try { initial = parse(localStorage.getItem(key)) } catch { /* Storage is optional. */ }
  apply(initial, null)
  window.statkeeperAppearance = {
    parse,
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    setTheme(theme) {
      if (theme !== 'light' && theme !== 'dark') return
      if (!enabled) return
      let error = null
      try { localStorage.setItem(key, JSON.stringify({ version: 1, theme })) }
      catch { error = "Appearance couldn't be saved. It may reset on reload." }
      apply(theme, error)
    },
  }
  window.addEventListener('storage', event => {
    try {
      if (event.storageArea !== localStorage || (event.key !== key && event.key !== null)) return
      apply(parse(localStorage.getItem(key)), null)
    } catch { /* Keep the current session choice if storage becomes unavailable. */ }
  })
})()
