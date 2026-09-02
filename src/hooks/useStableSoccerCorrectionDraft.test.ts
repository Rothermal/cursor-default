import { describe, expect, it } from 'vitest'
import {
  sameSoccerCorrectionDraft,
  stabilizeSoccerCorrectionDraft,
} from './useStableSoccerCorrectionDraft'

interface TestDraft {
  mode: 'live' | 'edit'
  event?: {
    id: string
    revision: number
  }
}

describe('sameSoccerCorrectionDraft', () => {
  it('treats fresh wrappers for the same event revision as one correction', () => {
    const current: TestDraft = { mode: 'edit', event: { id: 'shot-1', revision: 2 } }
    const rerendered: TestDraft = { mode: 'edit', event: { id: 'shot-1', revision: 2 } }

    expect(sameSoccerCorrectionDraft(current, rerendered)).toBe(true)
  })

  it('refreshes a correction when its event or revision changes', () => {
    const current: TestDraft = { mode: 'edit', event: { id: 'shot-1', revision: 2 } }

    expect(sameSoccerCorrectionDraft(current, {
      mode: 'edit',
      event: { id: 'shot-1', revision: 3 },
    })).toBe(false)
    expect(sameSoccerCorrectionDraft(current, {
      mode: 'edit',
      event: { id: 'shot-2', revision: 2 },
    })).toBe(false)
    expect(sameSoccerCorrectionDraft(current, {
      mode: 'live',
      event: { id: 'shot-1', revision: 2 },
    })).toBe(false)
  })

  it('keeps live draft initialization tied to caller identity', () => {
    const current: TestDraft = { mode: 'live' }

    expect(sameSoccerCorrectionDraft(current, current)).toBe(true)
    expect(sameSoccerCorrectionDraft(current, { mode: 'live' })).toBe(false)
    expect(sameSoccerCorrectionDraft(current, null)).toBe(false)
  })
})

describe('stabilizeSoccerCorrectionDraft', () => {
  it('holds the first wrapper until the correction identity changes', () => {
    const first: TestDraft = { mode: 'edit', event: { id: 'shot-1', revision: 2 } }
    const holder: { current: TestDraft | null } = { current: first }
    const rerendered: TestDraft = { mode: 'edit', event: { id: 'shot-1', revision: 2 } }
    const revised: TestDraft = { mode: 'edit', event: { id: 'shot-1', revision: 3 } }

    expect(stabilizeSoccerCorrectionDraft(holder, rerendered)).toBe(first)
    expect(holder.current).toBe(first)
    expect(stabilizeSoccerCorrectionDraft(holder, revised)).toBe(revised)
    expect(holder.current).toBe(revised)
  })

  it('clears on close and reinitializes when the same correction reopens', () => {
    const first: TestDraft = { mode: 'edit', event: { id: 'shot-1', revision: 2 } }
    const holder: { current: TestDraft | null } = { current: first }
    const reopened: TestDraft = { mode: 'edit', event: { id: 'shot-1', revision: 2 } }

    expect(stabilizeSoccerCorrectionDraft(holder, null)).toBeNull()
    expect(stabilizeSoccerCorrectionDraft(holder, reopened)).toBe(reopened)
    expect(holder.current).toBe(reopened)
  })
})
