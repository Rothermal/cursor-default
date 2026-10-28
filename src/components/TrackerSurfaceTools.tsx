import { MoreVertical } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

/** Keeps sport-owned controls inline normally, or in a focus-layout disclosure. */
export default function TrackerSurfaceTools({ focused, children }: { focused: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (!focused) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('[role="dialog"]') &&
        ref.current && !ref.current.contains(event.target)) ref.current.open = false
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [focused])
  if (!focused) return <div className="space-y-4">{children}</div>
  return (
    <details ref={ref} className="absolute right-1 top-1 z-30" onKeyDown={event => {
      if (event.key !== 'Escape' || !event.currentTarget.open) return
      event.preventDefault()
      event.currentTarget.open = false
      event.currentTarget.querySelector('summary')?.focus()
    }}>
      <summary aria-label="Field tools" title="Field tools" className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-md text-content marker:content-none">
        <MoreVertical size={20} aria-hidden />
      </summary>
      <div className="absolute right-0 top-full max-h-[calc(100dvh-3.5rem)] w-[min(25rem,calc(100vw-1rem))] space-y-4 overflow-y-auto rounded-md border border-line-strong bg-surface p-3 shadow-xl">
        {children}
      </div>
    </details>
  )
}
