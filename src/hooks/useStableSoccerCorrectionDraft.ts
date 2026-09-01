import { useRef } from 'react'

interface SoccerCorrectionDraft {
  mode?: string
  event?: {
    id: string
    revision: number
  }
}

export function sameSoccerCorrectionDraft<T extends SoccerCorrectionDraft>(
  current: T | null,
  next: T | null
): boolean {
  if (current === next) return true
  if (!current?.event || !next?.event) return false
  return current.mode === next.mode &&
    current.event.id === next.event.id &&
    current.event.revision === next.event.revision
}

export function stabilizeSoccerCorrectionDraft<T extends SoccerCorrectionDraft>(
  holder: { current: T | null },
  next: T | null
): T | null {
  if (!sameSoccerCorrectionDraft(holder.current, next)) {
    holder.current = next
  }
  return holder.current
}

export function useStableSoccerCorrectionDraft<T extends SoccerCorrectionDraft>(draft: T | null): T | null {
  return stabilizeSoccerCorrectionDraft(useRef(draft), draft)
}
