import type { BaseballCorrectionPreview, BaseballCorrectionRow } from '../../lib/baseball'

interface BaseballCorrectionPreviewSheetProps {
  preview: BaseballCorrectionPreview
  error: string | null
  onCancel: () => void
  /** `confirmed` is true when the recorder chose "Save with these changes". */
  onConfirm: (confirmed: boolean) => void
}

/**
 * What a Timeline Remove or Restore does before it saves (BSB-4 section 4.1): the changes to
 * the game, later rows that would be removed with it (plays and game flow named separately),
 * and credit that moves. A clean correction saves with one tap; anything listed needs
 * "Save with these changes".
 */
export default function BaseballCorrectionPreviewSheet({ preview, error, onCancel, onConfirm }: BaseballCorrectionPreviewSheetProps) {
  const removing = preview.action === 'remove'
  const { plays, lifecycle } = preview.dependents
  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label={removing ? 'Remove play' : 'Restore'}>
      <div>
        <h2 className="font-bold text-content">{removing ? 'Remove' : 'Restore'}</h2>
        <RowList rows={preview.rows} />
      </div>
      {preview.changes.length > 0 && <Group heading="What changes" lines={preview.changes} />}
      {(plays.length > 0 || lifecycle.length > 0) && (
        <div className="space-y-2 rounded-md border border-warning-line bg-warning p-2 text-warning-content">
          <p className="text-sm font-semibold">
            {plays.length + lifecycle.length === 1 ? 'This later row no longer fits and is removed too:' : 'These later rows no longer fit and are removed too:'}
          </p>
          {plays.length > 0 && <DependentList heading="Plays" rows={plays} />}
          {lifecycle.length > 0 && <DependentList heading="Game flow" rows={lifecycle} />}
          <p className="text-xs">They stay listed as removed and can be restored together.</p>
        </div>
      )}
      {preview.creditMoves.length > 0 && <Group heading="Credit moves" lines={preview.creditMoves} />}
      {preview.fieldingKept.length > 0 && <Group heading="Fielding credit kept" lines={preview.fieldingKept} />}
      {preview.information.length > 0 && <Group heading="Also" lines={preview.information} />}
      {!preview.needsConfirmation && preview.changes.length === 0 && preview.information.length === 0 && (
        <p className="text-sm text-content-muted">Nothing else in the game changes.</p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" onClick={() => onConfirm(preview.needsConfirmation)} autoFocus>
          {preview.needsConfirmation ? 'Save with these changes' : removing ? 'Remove' : 'Restore'}
        </button>
      </div>
    </section>
  )
}

function RowList({ rows }: { rows: BaseballCorrectionRow[] }) {
  return (
    <ul className="mt-1 space-y-1 text-sm text-content">
      {rows.map(row => <li key={row.id}>{row.label} <span className="text-xs text-content-muted">· {row.halfLabel}</span></li>)}
    </ul>
  )
}

function DependentList({ heading, rows }: { heading: string; rows: Array<BaseballCorrectionRow & { reason: string }> }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase">{heading}</h3>
      <ul className="mt-1 space-y-1 text-sm">
        {rows.map(row => (
          <li key={row.id}>
            {row.label} <span className="text-xs">· {row.halfLabel}</span>
            <span className="block text-xs">{row.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Group({ heading, lines }: { heading: string; lines: string[] }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase text-content-muted">{heading}</h3>
      <ul className="mt-1 space-y-1 text-sm text-content">
        {lines.map(line => <li key={line}>{line}</li>)}
      </ul>
    </div>
  )
}
