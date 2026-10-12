/** Tap-vs-scroll handling shared by the Basketball court drawings. */
import { useRef } from 'react'

const TAP_DEBOUNCE_MS = 120
/**
 * Screen-px movement beyond which a pointer gesture counts as a scroll, not a tap (D9).
 * 10px rejected too many real taps in device testing (fingers drift a few px); 18px keeps
 * taps forgiving while a deliberate scroll flick still travels well past it.
 */
const TAP_MOVE_TOLERANCE_PX = 18

interface PendingTap {
  pointerId: number
  /** Screen coords at pointer-down: tap location and movement reference. */
  clientX: number
  clientY: number
}

/** Convert a screen-space point to SVG user units via the SVG's current transform. */
export function clientPointToCourt(
  element: SVGGraphicsElement,
  clientX: number,
  clientY: number
): { x: number; y: number } | null {
  const svg = element.ownerSVGElement
  if (!svg) return null
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const svgPt = pt.matrixTransform(ctm.inverse())
  return {
    x: Math.round(svgPt.x * 10) / 10,
    y: Math.round(svgPt.y * 10) / 10,
  }
}

/**
 * Tap-vs-scroll discrimination (D9): the tap fires on pointer-up, and only when the
 * pointer stayed within TAP_MOVE_TOLERANCE_PX of the pointer-down point. A scroll
 * gesture either moves past the tolerance or triggers `pointercancel` when the
 * browser takes over panning (`touch-action: pan-y`) — both clear the pending tap.
 * `onTap` receives the SVG user-space point of the pointer-down.
 */
export function useCourtTapHandlers(onTap: ((point: { x: number; y: number }) => void) | undefined) {
  const lastTapAtRef = useRef(0)
  const pendingTapRef = useRef<PendingTap | null>(null)

  const onPointerDown = (e: React.PointerEvent<SVGRectElement>) => {
    pendingTapRef.current = {
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
    }
  }

  const onPointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    const pending = pendingTapRef.current
    if (!pending || pending.pointerId !== e.pointerId) return
    const dx = e.clientX - pending.clientX
    const dy = e.clientY - pending.clientY
    if (dx * dx + dy * dy > TAP_MOVE_TOLERANCE_PX * TAP_MOVE_TOLERANCE_PX) {
      pendingTapRef.current = null
    }
  }

  const onPointerCancel = (e: React.PointerEvent<SVGRectElement>) => {
    if (pendingTapRef.current?.pointerId === e.pointerId) {
      pendingTapRef.current = null
    }
  }

  const onPointerUp = (e: React.PointerEvent<SVGRectElement>) => {
    const pending = pendingTapRef.current
    if (!pending || pending.pointerId !== e.pointerId) return
    pendingTapRef.current = null
    if (!onTap) return

    const dx = e.clientX - pending.clientX
    const dy = e.clientY - pending.clientY
    if (dx * dx + dy * dy > TAP_MOVE_TOLERANCE_PX * TAP_MOVE_TOLERANCE_PX) return

    const now = Date.now()
    if (now - lastTapAtRef.current < TAP_DEBOUNCE_MS) return
    lastTapAtRef.current = now

    const point = clientPointToCourt(e.currentTarget, pending.clientX, pending.clientY)
    if (point) onTap(point)
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}

