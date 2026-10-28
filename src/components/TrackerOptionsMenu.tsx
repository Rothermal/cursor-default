import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronDown, Menu, MoreVertical } from 'lucide-react'

export default function TrackerOptionsMenu({ children, iconOnly = false }: { children: ReactNode; iconOnly?: boolean }) {
  const menuRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && menuRef.current) {
        menuRef.current.open = false
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])

  return (
    <details ref={menuRef} className="relative" onKeyDown={event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.currentTarget.open = false
      event.currentTarget.querySelector('summary')?.focus()
    }}>
      <summary aria-label={iconOnly ? 'Game menu' : undefined} title={iconOnly ? 'Game menu' : undefined}
        className={iconOnly ? 'grid h-9 w-9 cursor-pointer list-none place-items-center rounded-md text-content marker:content-none' : 'flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-content marker:content-none'}>
        {iconOnly ? <MoreVertical size={20} aria-hidden /> : <><Menu size={17} aria-hidden /> Game <ChevronDown size={14} aria-hidden /></>}
      </summary>
      <div className="absolute right-0 top-full z-40 max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-line-strong bg-surface p-2 shadow-xl"
        onClick={event => {
          if (event.target instanceof Element && event.target.closest('button:not(:disabled)') && menuRef.current) {
            menuRef.current.open = false
            menuRef.current.querySelector('summary')?.focus()
          }
        }}>
        {children}
      </div>
    </details>
  )
}
