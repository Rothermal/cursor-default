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

export function useStableSoccerCorrectionDraft<T extends SoccerCorrectionDraft>(draft: T | null): T | null {
  const stableDraft = useRef(draft)
  if (!sameSoccerCorrectionDraft(stableDraft.current, draft)) {
    stableDraft.current = draft
  }
  return stableDraft.current
}
