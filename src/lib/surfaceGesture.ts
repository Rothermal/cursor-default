export interface SurfacePointer {
  pointerId: number
  clientX: number
  clientY: number
}

/** One pointer, one action. Browser pan/zoom and cancellation always win. */
export function createSurfaceGesture({
  onTap,
  onHold,
  holdMs = 500,
  moveTolerance = 18,
}: {
  onTap: (point: SurfacePointer) => void
  onHold: (point: SurfacePointer) => void
  holdMs?: number
  moveTolerance?: number
}) {
  let pending: SurfacePointer | null = null
  let held = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
    pending = null
    held = false
  }
  const moved = (point: SurfacePointer) => pending && Math.hypot(
    point.clientX - pending.clientX, point.clientY - pending.clientY
  ) > moveTolerance
  return {
    cancel,
    start(point: SurfacePointer) {
      if (pending) { cancel(); return }
      pending = { pointerId: point.pointerId, clientX: point.clientX, clientY: point.clientY }
      held = false
      timer = setTimeout(() => {
        if (!pending) return
        held = true
        onHold(pending)
      }, holdMs)
    },
    move(point: SurfacePointer) {
      if (pending?.pointerId === point.pointerId && moved(point)) cancel()
    },
    end(point: SurfacePointer) {
      if (pending?.pointerId !== point.pointerId) return
      const tap = !held && !moved(point) ? pending : null
      cancel()
      if (tap) onTap(tap)
    },
    otherPointer(pointerId: number) {
      if (pending && pending.pointerId !== pointerId) cancel()
    },
  }
}
