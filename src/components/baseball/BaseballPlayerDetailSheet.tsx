import type { BaseballPlayerGameDetail } from '../../lib/baseball'

/** A tracked player's game so far, read-only (BSB-4A Lineup tab). */
export default function BaseballPlayerDetailSheet({ detail, onClose }: { detail: BaseballPlayerGameDetail; onClose: () => void }) {
  return (
    <section className="space-y-2 rounded-md border border-line bg-surface p-3" aria-label="Player details">
      <h2 className="font-bold text-content">{detail.name}</h2>
      <p className="text-sm text-content-muted">{detail.role}</p>
      {detail.replaced && <p className="text-sm text-content">{detail.replaced}</p>}
      <ul className="space-y-1 text-sm text-content">
        {detail.lines.map(line => <li key={line}>{line}</li>)}
      </ul>
      <button type="button" className="btn-secondary w-full" onClick={onClose} autoFocus>Close</button>
    </section>
  )
}
