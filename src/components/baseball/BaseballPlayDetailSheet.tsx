import type { BaseballPlayDetail } from '../../lib/baseball'

interface BaseballPlayDetailSheetProps {
  detail: BaseballPlayDetail
  onClose: () => void
  /** From the Timeline (BSB-4C): opens the removal preview. Nothing is removed yet. */
  onRemove?: () => void
}

/**
 * A recorded play (BSB-3D): what was captured and how every runner moved. Closing it changes
 * nothing. Opened from the Timeline, it offers Remove, which previews first (BSB-4C).
 */
export default function BaseballPlayDetailSheet({ detail, onClose, onRemove }: BaseballPlayDetailSheetProps) {
  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Play details">
      <div>
        <h2 className="font-bold text-content">{detail.label}</h2>
        <p className="text-xs text-content-muted">{detail.halfLabel}{onRemove ? '' : ' · read-only'}</p>
      </div>
      {detail.sections.map((section, index) => (
        <div key={`${section.heading}-${index}`}>
          <h3 className="text-xs font-bold uppercase text-content-muted">{section.heading}</h3>
          <ul className="mt-1 space-y-1 text-sm text-content">
            {section.lines.map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}
          </ul>
        </div>
      ))}
      {onRemove ? (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} autoFocus>Close</button>
          <button type="button" className="btn-secondary text-danger-content" onClick={onRemove}>Remove…</button>
        </div>
      ) : (
        <>
          <p className="text-xs text-content-muted">Undo changes the newest play. Older plays are corrected on the Timeline tab.</p>
          <button type="button" className="btn-secondary w-full" onClick={onClose} autoFocus>Close</button>
        </>
      )}
    </section>
  )
}
