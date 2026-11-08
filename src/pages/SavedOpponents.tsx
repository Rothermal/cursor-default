import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { sports } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { useOpponentRelabel } from '../hooks/useOpponentRelabel'
import { useSavedOpponents } from '../hooks/useSavedOpponents'
import {
  archiveOpponentTeam,
  createOpponentTeam,
  listOwnGamesAgainstOpponent,
  normalizeOpponentLabel,
  OPPONENT_LABEL_MAX_LENGTH,
  opponentLabelError,
  sortOpponents,
  updateOpponentTeam,
  type OpponentGameRow,
  type OpponentTeam,
} from '../lib/opponentTeams'
import { sportDashboardPath } from '../lib/sportNavigation'
import { supabase } from '../lib/supabase'

interface PendingRename {
  previous: OpponentTeam
  next: OpponentTeam
  games: OpponentGameRow[]
}

/** RTN-1: add, rename and archive saved opponents for one sport. */
export default function SavedOpponents() {
  const [searchParams] = useSearchParams()
  const sport = sports.find(item => item.id === searchParams.get('sport')) ?? null
  const { user, isConfigured } = useAuth()
  const enabled = Boolean(isConfigured && user && supabase && sport)
  const saved = useSavedOpponents(sport?.id ?? null, enabled)
  const relabelGame = useOpponentRelabel()

  const [newName, setNewName] = useState('')
  const [newNickname, setNewNickname] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editNickname, setEditNickname] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingRename, setPendingRename] = useState<PendingRename | null>(null)

  if (!sport) {
    return <main className="mx-auto max-w-lg px-4 py-6"><p role="alert">Choose a sport first.</p><Link className="btn-secondary mt-3 inline-block" to="/sports">Sports</Link></main>
  }

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await work()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That change could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const handleAdd = () => run(async () => {
    if (!supabase) return
    const created = await createOpponentTeam(supabase, sport.id, newName, normalizeOpponentLabel(newNickname))
    saved.replace(sortOpponents([...saved.opponents, created]))
    setNewName('')
    setNewNickname('')
    setNotice(`Saved ${created.name}.`)
  })

  const startEdit = (opponent: OpponentTeam) => {
    setEditingId(opponent.id)
    setEditName(opponent.name)
    setEditNickname(opponent.nickname ?? '')
    setError(null)
    setNotice(null)
  }

  const handleSaveEdit = (previous: OpponentTeam) => run(async () => {
    if (!supabase || !user) return
    const next = await updateOpponentTeam(supabase, previous.id, editName, normalizeOpponentLabel(editNickname))
    saved.replace(sortOpponents(saved.opponents.map(item => item.id === next.id ? next : item)))
    setEditingId(null)
    if (next.name === previous.name && next.nickname === previous.nickname) return
    const games = (await listOwnGamesAgainstOpponent(supabase, user.id, sport.id, previous.name))
      .filter(game => game.opponentName !== next.name || game.opponentNickname !== next.nickname)
    if (games.length > 0) setPendingRename({ previous, next, games })
    else setNotice(`Updated ${next.name}.`)
  })

  const handleRenamePastGames = (rename: PendingRename) => run(async () => {
    let updated = 0
    const failures: string[] = []
    for (const game of rename.games) {
      try {
        await relabelGame(game.id, rename.next.name, rename.next.nickname)
        updated += 1
      } catch (reason) {
        failures.push(reason instanceof Error ? reason.message : 'unknown error')
      }
    }
    setPendingRename(null)
    setNotice(`Updated ${rename.next.name} and ${updated} past game${updated === 1 ? '' : 's'}.`)
    if (failures.length > 0) setError(`${failures.length} game${failures.length === 1 ? '' : 's'} could not be updated: ${failures[0]}`)
  })

  const handleArchive = (opponent: OpponentTeam) => run(async () => {
    if (!supabase) return
    if (!window.confirm(`Remove ${opponent.name} from saved opponents? Past games keep their opponent name.`)) return
    await archiveOpponentTeam(supabase, opponent.id)
    saved.replace(saved.opponents.filter(item => item.id !== opponent.id))
    setNotice(`Removed ${opponent.name}.`)
  })

  const addError = newName.trim() ? opponentLabelError(newName, newNickname) : null

  return (
    <main className="mx-auto max-w-lg space-y-4 px-4 py-6">
      <div className="flex items-center gap-3">
        <Link to={sportDashboardPath(sport.id)} className="text-content-muted" aria-label="Back">←</Link>
        <h1 className="text-xl font-bold text-content">{sport.icon} Saved Opponents</h1>
      </div>

      {!enabled && (
        <p role="status" className="card text-sm text-content-muted">Sign in with cloud sync to save opponents.</p>
      )}

      {enabled && (
        <>
          <section className="card space-y-3" aria-labelledby="add-opponent">
            <h2 id="add-opponent" className="font-semibold text-content">Add opponent</h2>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Opponent name"
              aria-label="Opponent name"
              maxLength={OPPONENT_LABEL_MAX_LENGTH}
              className="input-field"
            />
            <input
              type="text"
              value={newNickname}
              onChange={e => setNewNickname(e.target.value)}
              placeholder="Nickname (optional)"
              aria-label="Opponent nickname"
              maxLength={OPPONENT_LABEL_MAX_LENGTH}
              className="input-field"
            />
            {addError && <p className="text-xs text-danger-content">{addError}</p>}
            <button type="button" className="btn-primary w-full" disabled={busy || !newName.trim() || Boolean(addError)} onClick={() => void handleAdd()}>
              Save opponent
            </button>
          </section>

          {pendingRename && (
            <section role="alertdialog" aria-labelledby="rename-past" className="card space-y-3 border-warning-line bg-warning">
              <h2 id="rename-past" className="font-semibold text-warning-content">Update past games?</h2>
              <p className="text-sm text-warning-content">
                {pendingRename.games.length} of your past {sport.name} game{pendingRename.games.length === 1 ? '' : 's'} list
                {' '}“{pendingRename.previous.name}”. Change {pendingRename.games.length === 1 ? 'it' : 'them'} to
                {' '}“{pendingRename.next.name}”{pendingRename.next.nickname ? ` (${pendingRename.next.nickname})` : ''}?
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => void handleRenamePastGames(pendingRename)}>
                  Update {pendingRename.games.length} game{pendingRename.games.length === 1 ? '' : 's'}
                </button>
                <button type="button" className="btn-secondary flex-1" disabled={busy} onClick={() => { setPendingRename(null); setNotice(`Updated ${pendingRename.next.name}. Past games unchanged.`) }}>
                  Keep past games
                </button>
              </div>
            </section>
          )}

          {error && <p role="alert" className="text-sm text-danger-content">{error}</p>}
          {notice && <p role="status" className="text-sm text-content-muted">{notice}</p>}

          <section className="card space-y-2" aria-labelledby="saved-list">
            <h2 id="saved-list" className="font-semibold text-content">Saved ({saved.opponents.length})</h2>
            {saved.loading && <p className="text-sm text-content-muted animate-pulse">Loading...</p>}
            {saved.error && (
              <div role="alert" className="space-y-2 text-sm text-danger-content">
                <p>{saved.error}</p>
                <button type="button" className="btn-secondary" onClick={saved.reload}>Retry</button>
              </div>
            )}
            {!saved.loading && !saved.error && saved.opponents.length === 0 && (
              <p className="text-sm text-content-muted">No saved opponents yet. New opponents you enter at game setup are saved here.</p>
            )}
            <ul className="divide-y divide-line">
              {saved.opponents.map(opponent => (
                <li key={opponent.id} className="py-2">
                  {editingId === opponent.id ? (
                    <div className="space-y-2">
                      <input type="text" value={editName} onChange={e => setEditName(e.target.value)} aria-label="Opponent name" maxLength={OPPONENT_LABEL_MAX_LENGTH} className="input-field" />
                      <input type="text" value={editNickname} onChange={e => setEditNickname(e.target.value)} aria-label="Opponent nickname" placeholder="Nickname (optional)" maxLength={OPPONENT_LABEL_MAX_LENGTH} className="input-field" />
                      <div className="flex gap-2">
                        <button type="button" className="btn-primary flex-1" disabled={busy || Boolean(opponentLabelError(editName, editNickname))} onClick={() => void handleSaveEdit(opponent)}>Save</button>
                        <button type="button" className="btn-secondary flex-1" disabled={busy} onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-content">{opponent.name}</p>
                        {opponent.nickname && <p className="truncate text-xs text-content-muted">{opponent.nickname}</p>}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button type="button" className="btn-secondary px-3 py-1 text-sm" disabled={busy} onClick={() => startEdit(opponent)}>Edit</button>
                        <button type="button" className="btn-secondary px-3 py-1 text-sm" disabled={busy} onClick={() => void handleArchive(opponent)}>Remove</button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  )
}
