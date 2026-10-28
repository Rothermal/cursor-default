import { useEffect, useMemo, useRef, type PointerEvent } from 'react'
import { createSurfaceGesture, type SurfacePointer } from '../lib/surfaceGesture'

export function useSurfaceGestures({ enabled, onTap, onHold }: {
  enabled: boolean
  onTap: (point: SurfacePointer) => void
  onHold: (point: SurfacePointer, target: EventTarget | null) => void
}) {
  const callbacks = useRef({ onTap, onHold })
  callbacks.current = { onTap, onHold }
  const target = useRef<EventTarget | null>(null)
  const gesture = useMemo(() => createSurfaceGesture({
    onTap: point => callbacks.current.onTap(point),
    onHold: point => callbacks.current.onHold(point, target.current),
  }), [])

  useEffect(() => {
    if (!enabled) { gesture.cancel(); return }
    const anotherPointer = (event: globalThis.PointerEvent) => gesture.otherPointer(event.pointerId)
    document.addEventListener('pointerdown', anotherPointer, true)
    window.addEventListener('scroll', gesture.cancel, true)
    window.addEventListener('resize', gesture.cancel)
    window.addEventListener('blur', gesture.cancel)
    document.addEventListener('visibilitychange', gesture.cancel)
    return () => {
      gesture.cancel()
      document.removeEventListener('pointerdown', anotherPointer, true)
      window.removeEventListener('scroll', gesture.cancel, true)
      window.removeEventListener('resize', gesture.cancel)
      window.removeEventListener('blur', gesture.cancel)
      document.removeEventListener('visibilitychange', gesture.cancel)
    }
  }, [enabled, gesture])

  return enabled ? {
    onPointerDownCapture: (event: PointerEvent<SVGSVGElement>) => {
      if (!event.isPrimary || event.button !== 0) { gesture.cancel(); return }
      target.current = event.target
      gesture.start(event)
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    onPointerMoveCapture: (event: PointerEvent<SVGSVGElement>) => gesture.move(event),
    onPointerUpCapture: (event: PointerEvent<SVGSVGElement>) => gesture.end(event),
    onPointerCancelCapture: () => gesture.cancel(),
    onLostPointerCapture: () => gesture.cancel(),
  } : {}
}
