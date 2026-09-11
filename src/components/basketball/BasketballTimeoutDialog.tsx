import { useEffect, useState } from 'react'
import { Clock3, X } from 'lucide-react'
import {
  formatBasketballTimeoutInventory,
  type BasketballChargedTimeoutKind,
  type BasketballNeutralTimeoutKind,
  type BasketballTimeoutCapture,
  type BasketballTimeoutInventory,
} from '../../lib/basketball/timeoutCommands'
import type { BasketballTeamSide } from '../../lib/basketball/types'

interface BasketballTimeoutDialogProps {
  trackedTeamName: string
  opponentName: string
  inventory: BasketballTimeoutInventory
  defaultSide: BasketballTeamSide
  errorMessage?: string | null
  onSubmit: (input: BasketballTimeoutCapture) => void
  onClose: () => void
}

export default function BasketballTimeoutDialog({
  trackedTeamName,
  opponentName,
  inventory,
  defaultSide,
  errorMessage,
  onSubmit,
  onClose,
}: BasketballTimeoutDialogProps) {
  const [mode, setMode] = useState<'charged' | 'neutral'>('charged')
  const [teamSide, setTeamSide] = useState<BasketballTeamSide>(defaultSide)
  const [chargedKind, setChargedKind] = useState<BasketballChargedTimeoutKind>('full')
  const [neutralKind, setNeutralKind] = useState<BasketballNeutralTimeoutKind>('media')

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const selectedInventory = inventory[teamSide]
  const submitDisabled = mode === 'charged' && selectedInventory.exhausted

  const submit = () => {
    if (submitDisabled) return
    onSubmit(mode === 'charged'
      ? { mode: 'charged', teamSide, kind: chargedKind }
      : { mode: 'neutral', kind: neutralKind })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/40 px-3 pb-3 pt-12 sm:items-center sm:p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-timeout-title"
        className="max-h-[calc(100dvh-3.75rem)] w-full max-w-lg overflow-y-auto rounded-lg border border-line bg-surface shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
          <div className="min-w-0">
            <h2 id="basketball-timeout-title" className="text-base font-bold text-content">Record timeout</h2>
            <p className="text-xs text-content-muted">{inventory.scopeLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-content-muted" aria-label="Close timeout sheet">
            <X size={18} aria-hidden />
          </button>
        </header>

        <form className="space-y-4 px-4 py-4" onSubmit={event => { event.preventDefault(); submit() }}>
          <div className="grid grid-cols-2 rounded-lg bg-surface-muted p-1" role="group" aria-label="Timeout owner">
            {([['charged', 'Team'], ['neutral', 'Game']] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setMode(value)} aria-pressed={mode === value} className={`min-h-11 rounded-md px-3 py-2 text-sm font-semibold ${mode === value ? 'bg-surface text-content shadow-sm' : 'text-content-muted'}`}>
                {label}
              </button>
            ))}
          </div>

          {mode === 'charged' ? (
            <>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Charged team">
                {([['tracked', trackedTeamName], ['opponent', opponentName]] as const).map(([side, name]) => {
                  const sideInventory = inventory[side]
                  return (
                    <button
                      key={side}
                      type="button"
                      onClick={() => setTeamSide(side)}
                      aria-pressed={teamSide === side}
                      className={`min-h-16 rounded-lg border px-3 py-2 text-left ${teamSide === side ? 'border-info-line bg-info' : 'border-line bg-surface'}`}
                    >
                      <span className="block break-words text-sm font-semibold text-content">{name}</span>
                      <span className={`block text-xs ${sideInventory.exhausted ? 'font-semibold text-danger-content' : 'text-content-muted'}`}>
                        {formatBasketballTimeoutInventory(sideInventory)}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="grid grid-cols-2 rounded-lg bg-surface-muted p-1" role="group" aria-label="Charged timeout class">
                {([['full', 'Full'], ['thirty_second', '30-second']] as const).map(([kind, label]) => (
                  <button key={kind} type="button" onClick={() => setChargedKind(kind)} aria-pressed={chargedKind === kind} className={`min-h-11 rounded-md px-3 py-2 text-sm font-semibold ${chargedKind === kind ? 'bg-surface text-content shadow-sm' : 'text-content-muted'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 rounded-lg bg-surface-muted p-1" role="group" aria-label="Neutral timeout class">
                {([['media', 'Media'], ['official', 'Official']] as const).map(([kind, label]) => (
                  <button key={kind} type="button" onClick={() => setNeutralKind(kind)} aria-pressed={neutralKind === kind} className={`min-h-11 rounded-md px-3 py-2 text-sm font-semibold ${neutralKind === kind ? 'bg-surface text-content shadow-sm' : 'text-content-muted'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="rounded-lg border border-info-line bg-info px-3 py-2 text-sm text-info-content">
                Game timeouts do not use either team's charged timeout inventory.
              </p>
            </>
          )}

          {submitDisabled && (
            <p role="status" className="rounded-lg border border-danger-line bg-danger px-3 py-2 text-sm font-semibold text-danger-content">
              That team has no charged timeouts remaining in {inventory.scopeLabel}.
            </p>
          )}
          {errorMessage && <p role="alert" className="rounded-lg border border-danger-line bg-danger px-3 py-2 text-sm font-semibold text-danger-content">{errorMessage}</p>}

          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={submitDisabled} className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:bg-control-disabled disabled:text-content-disabled">
              <Clock3 size={16} aria-hidden />
              Record timeout
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
