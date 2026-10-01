import type { BaseballPlayDetail } from '../../lib/baseball'

/**
 * A recorded play, read-only (BSB-3D): what was captured and how every runner moved. Closing
 * it changes nothing; corrections to older plays are the BSB-4 Timeline.
 */
export default function BaseballPlayDetailSheet({ detail, onClose }: { detail: BaseballPlayDetail; onClose: () => void }) {
  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Play details">
      <div>
        <h2 className="font-bold text-content">{detail.label}</h2>
        <p className="text-xs text-content-muted">{detail.halfLabel} · read-only</p>
      </div>
      {detail.sections.map((section, index) => (
        <div key={`${section.heading}-${index}`}>
          <h3 className="text-xs font-bold uppercase text-content-muted">{section.heading}</h3>
          <ul className="mt-1 space-y-1 text-sm text-content">
            {section.lines.map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}
          </ul>
        </div>
      ))}
      <p className="text-xs text-content-muted">Undo changes the newest play. Editing older plays comes with the Timeline.</p>
      <button type="button" className="btn-secondary w-full" onClick={onClose} autoFocus>Close</button>
    </section>
  )
}
