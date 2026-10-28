/** Normalized display coordinates inside an xMidYMid-meet SVG, excluding letterboxing. */
export function surfacePoint(
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  point: { clientX: number; clientY: number },
  width: number,
  height: number
): { x: number; y: number } | null {
  const scale = Math.min(bounds.width / width, bounds.height / height)
  if (!Number.isFinite(scale) || scale <= 0) return null
  const drawnWidth = width * scale, drawnHeight = height * scale
  const x = (point.clientX - bounds.left - (bounds.width - drawnWidth) / 2) / drawnWidth
  const y = (point.clientY - bounds.top - (bounds.height - drawnHeight) / 2) / drawnHeight
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null
}
