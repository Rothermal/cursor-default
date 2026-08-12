import { useEffect, useRef } from 'react'
import { Activity, CircleDot, Plus, X } from 'lucide-react'
import type { BasketballHistoricalRelatedEventType } from '../../lib/basketball/relatedEventEditCommands'

interface Props {
  onClose: () => void
  onShot: () => void
  onRelated: (eventType: BasketballHistoricalRelatedEventType) => void
}

const choices: Array<{ type: BasketballHistoricalRelatedEventType; label: string }> = [
  { type: 'basketball.assist', label: 'Assist' },
  { type: 'basketball.rebound', label: 'Rebound' },
  { type: 'basketball.steal', label: 'Steal' },
  { type: 'basketball.block', label: 'Block' },
  { type: 'basketball.turnover', label: 'Turnover' },
  { type: 'basketball.steal_turnover', label: 'Steal + Turnover' },
]

export default function BasketballAddEventChooser({ onClose, onShot, onRelated }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => closeRef.current?.focus(), [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 sm:items-center sm:p-4" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="basketball-add-event-title" className="w-full rounded-t-lg bg-white shadow-2xl sm:max-w-lg sm:rounded-lg" onClick={event => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 id="basketball-add-event-title" className="text-base font-bold text-slate-900">Add event</h2>
          <button ref={closeRef} type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 text-slate-600" aria-label="Close add event"><X size={19} aria-hidden /></button>
        </header>
        <div className="grid grid-cols-2 gap-2 p-4">
          <button type="button" onClick={onShot} className="btn-secondary flex min-h-14 items-center justify-center gap-2"><CircleDot size={18} aria-hidden />Shot</button>
          {choices.map(choice => (
            <button key={choice.type} type="button" onClick={() => onRelated(choice.type)} className="btn-secondary flex min-h-14 items-center justify-center gap-2">
              {choice.type === 'basketball.steal_turnover' ? <Activity size={18} aria-hidden /> : <Plus size={18} aria-hidden />}
              {choice.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
