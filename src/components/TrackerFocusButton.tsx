import { Maximize, Minimize } from 'lucide-react'

export default function TrackerFocusButton({ focused, surface, onExpand, onExit }: {
  focused: boolean
  surface: string
  onExpand: () => void
  onExit: () => void
}) {
  const label = focused ? `Exit focused ${surface}` : `Expand ${surface}`
  return <button type="button" onClick={focused ? onExit : onExpand}
    data-tracker-focus-exit={focused ? '' : undefined} aria-label={label} title={label}
    className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line-strong bg-surface text-content">
    {focused ? <Minimize size={18} /> : <Maximize size={18} />}
  </button>
}
