import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { lockBodyScroll } from '../lib/bodyScrollLock'

export const PHONE_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 600px) and (max-width: 1100px) and (pointer: coarse)'
type LockableOrientation = ScreenOrientation & { lock?: (orientation: 'landscape') => Promise<void> }

/** Device-local presentation only: never dispatches a game command. */
export function useTrackerFocus(enabled: boolean, rootRef: RefObject<HTMLDivElement>) {
  const [focused, setFocused] = useState(false)
  const suppressed = useRef(false)
  const generation = useRef(0)
  const ownsFullscreen = useRef(false)
  const ownsOrientation = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const historyToken = useRef(`court-focus-${Date.now()}-${Math.random()}`)

  const releaseBrowser = useCallback(() => {
    generation.current++
    if (ownsOrientation.current) {
      screen.orientation?.unlock?.()
      ownsOrientation.current = false
    }
    if (rootRef.current && document.fullscreenElement === rootRef.current) {
      void document.exitFullscreen?.().catch(() => {})
    }
    ownsFullscreen.current = false
  }, [rootRef])

  const exit = useCallback(() => {
    suppressed.current = true
    setFocused(false)
    releaseBrowser()
  }, [releaseBrowser])

  const expand = useCallback(async () => {
    const root = rootRef.current
    if (!enabled || !root) return
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setFocused(true)
    const request = ++generation.current
    try {
      if (!root.requestFullscreen || document.fullscreenElement) return
      await root.requestFullscreen()
      if (generation.current !== request) {
        if (document.fullscreenElement === root) await document.exitFullscreen?.()
        return
      }
      ownsFullscreen.current = true
      const orientation = screen.orientation as LockableOrientation | undefined
      if (orientation?.lock) {
        await orientation.lock('landscape')
        if (generation.current !== request) orientation.unlock()
        else ownsOrientation.current = true
      }
    } catch { /* Browser fullscreen/rotation is optional; the in-app layout remains usable. */ }
  }, [enabled, rootRef])

  useEffect(() => {
    if (!enabled) { exit(); return }
    const landscape = window.matchMedia('(orientation: landscape)')
    const phone = window.matchMedia(PHONE_LANDSCAPE_QUERY)
    const update = () => {
      // A portrait software keyboard can make the viewport wider than it is tall.
      const landscapeScreen = screen.orientation?.type
        ? screen.orientation.type.startsWith('landscape') : landscape.matches
      if (!landscapeScreen) {
        suppressed.current = false
        setFocused(false)
        releaseBrowser()
      } else if (phone.matches && !suppressed.current) {
        setFocused(true)
      }
    }
    update()
    landscape.addEventListener('change', update)
    phone.addEventListener('change', update)
    screen.orientation?.addEventListener('change', update)
    return () => {
      landscape.removeEventListener('change', update)
      phone.removeEventListener('change', update)
      screen.orientation?.removeEventListener('change', update)
    }
  }, [enabled, exit, releaseBrowser])

  useEffect(() => {
    const changed = () => {
      if (ownsFullscreen.current && document.fullscreenElement !== rootRef.current) exit()
    }
    document.addEventListener('fullscreenchange', changed)
    return () => { document.removeEventListener('fullscreenchange', changed); releaseBrowser() }
  }, [exit, releaseBrowser, rootRef])

  useEffect(() => {
    if (!focused || !enabled) return
    const root = rootRef.current
    if (!root) return
    const releaseScroll = lockBodyScroll(document.body)
    const token = historyToken.current
    // A same-URL entry lets browser/Android Back leave focus without leaving the game.
    history.pushState({ ...history.state, trackerFocus: token }, '')
    const back = () => exit()
    window.addEventListener('popstate', back)
    const frame = requestAnimationFrame(() => {
      if (!root.querySelector('[role="dialog"][aria-modal="true"]')) {
        root.querySelector<HTMLButtonElement>('[aria-label="Exit focused court"]')?.focus()
      }
    })
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || root.querySelector('[role="dialog"][aria-modal="true"]')) return
      const disclosures = Array.from(root.querySelectorAll<HTMLDetailsElement>('details[open]'))
      if (event.key === 'Escape' && disclosures.length) {
        event.preventDefault()
        disclosures.forEach(disclosure => { disclosure.open = false })
        disclosures[0].querySelector('summary')?.focus()
        return
      }
      if (event.key === 'Escape') { event.preventDefault(); exit(); return }
      if (event.key !== 'Tab') return
      const controls = Array.from(root.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], summary, select, input, [tabindex="0"]'
      )).filter(element => element.getClientRects().length > 0)
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        event.preventDefault(); first?.focus()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('popstate', back)
      window.removeEventListener('keydown', keydown)
      releaseScroll()
      if (history.state?.trackerFocus === token) history.back()
      requestAnimationFrame(() => {
        if (returnFocus.current?.isConnected) returnFocus.current.focus()
      })
    }
  }, [enabled, exit, focused, rootRef])

  return { focused: enabled && focused, expand, exit }
}
