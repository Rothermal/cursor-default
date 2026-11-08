import { useState } from 'react'
import { useOpponentRelabel } from '../../hooks/useOpponentRelabel'
import { normalizeOpponentLabel, OPPONENT_LABEL_MAX_LENGTH, opponentLabelError } from '../../lib/opponentTeams'

interface GameOpponentEditorProps {
  gameId: string
  name: string
  nickname: string | null
  canEdit: boolean
  onSaved: (name: string, nickname: string | null) => void
}

/** Game Info opponent tile with an Edit control (RTN-1). Final games included. */
export default function GameOpponentEditor({ gameId, name, nickname, canEdit, onSaved }: GameOpponentEditorProps) {
  const relabel = useOpponentRelabel()
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const [draftNickname, setDraftNickname] = useState(nickname ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const validation = opponentLabelError(draftName, draftNickname)

  const save = async () => {
    if (validation) return
    setSaving(true)
    setError(null)
    try {
      const nextNickname = normalizeOpponentLabel(draftNickname)
      await relabel(gameId, draftName, nextNickname)
      onSaved(draftName.trim(), nextNickname)
      setEditing(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The opponent could not be renamed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg bg-surface-muted px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-content-muted">Opponent</p>
        {canEdit && !editing && (
          <button
            type="button"
            className="text-xs font-semibold text-accent"
            onClick={() => { setDraftName(name); setDraftNickname(nickname ?? ''); setError(null); setEditing(true) }}
          >
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <input type="text" value={draftName} onChange={e => setDraftName(e.target.value)} aria-label="Opponent name" maxLength={OPPONENT_LABEL_MAX_LENGTH} className="input-field" />
          <input type="text" value={draftNickname} onChange={e => setDraftNickname(e.target.value)} aria-label="Opponent nickname" placeholder="Nickname (optional)" maxLength={OPPONENT_LABEL_MAX_LENGTH} className="input-field" />
          {(error || (draftName.trim() && validation)) && <p role="alert" className="text-xs text-danger-content">{error ?? validation}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-primary flex-1" disabled={saving || Boolean(validation)} onClick={() => void save()}>Save</button>
            <button type="button" className="btn-secondary flex-1" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <p className="font-semibold text-content">{name}</p>
          {nickname && <p className="text-xs text-content-muted">{nickname}</p>}
        </>
      )}
    </div>
  )
}
