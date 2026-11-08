import { useId, useMemo, useState } from 'react'
import {
  filterOpponents,
  findOpponentByName,
  OPPONENT_LABEL_MAX_LENGTH,
  opponentSaveCandidate,
  type OpponentTeam,
} from '../../lib/opponentTeams'

interface OpponentPickerProps {
  name: string
  nickname: string
  onNameChange: (value: string) => void
  onNicknameChange: (value: string) => void
  /** Saved opponents for this sport; empty when unavailable (local-only). */
  opponents: OpponentTeam[]
  savedAvailable: boolean
  saveOpponent: boolean
  onSaveOpponentChange: (value: boolean) => void
}

/** Setup opponent fields: type to filter saved opponents, or enter a new one (RTN-1). */
export default function OpponentPicker({
  name,
  nickname,
  onNameChange,
  onNicknameChange,
  opponents,
  savedAvailable,
  saveOpponent,
  onSaveOpponentChange,
}: OpponentPickerProps) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const suggestions = useMemo(() => filterOpponents(opponents, name), [opponents, name])
  const exactMatch = findOpponentByName(opponents, name)
  const candidate = savedAvailable ? opponentSaveCandidate(opponents, name, nickname) : null
  const showSuggestions = open && savedAvailable && suggestions.length > 0 &&
    !(exactMatch && suggestions.length === 1)

  const pick = (opponent: OpponentTeam) => {
    onNameChange(opponent.name)
    onNicknameChange(opponent.nickname ?? '')
    setOpen(false)
  }

  return (
    <>
      <div className="relative">
        <label htmlFor={`${listId}-name`} className="block text-sm font-medium text-content-muted mb-1">
          Opponent *
        </label>
        <input
          id={`${listId}-name`}
          type="text"
          value={name}
          onChange={e => { onNameChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
          placeholder={savedAvailable && opponents.length > 0 ? 'Type or pick a saved opponent' : 'e.g., Tigers'}
          maxLength={OPPONENT_LABEL_MAX_LENGTH}
          autoComplete="off"
          aria-controls={showSuggestions ? `${listId}-list` : undefined}
          aria-expanded={showSuggestions}
          role="combobox"
          aria-autocomplete="list"
          className="input-field"
        />
        {showSuggestions && (
          <ul
            id={`${listId}-list`}
            role="listbox"
            aria-label="Saved opponents"
            className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-line-strong bg-surface shadow-lg"
          >
            {suggestions.map(opponent => (
              <li key={opponent.id} role="option" aria-selected={exactMatch?.id === opponent.id}>
                <button
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => pick(opponent)}
                  className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm text-content hover:bg-canvas"
                >
                  <span className="font-medium">{opponent.name}</span>
                  {opponent.nickname && <span className="text-xs text-content-muted">{opponent.nickname}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label htmlFor={`${listId}-nickname`} className="block text-sm font-medium text-content-muted mb-1">
          Opponent Nickname
        </label>
        <input
          id={`${listId}-nickname`}
          type="text"
          value={nickname}
          onChange={e => onNicknameChange(e.target.value)}
          placeholder="Optional short label"
          maxLength={OPPONENT_LABEL_MAX_LENGTH}
          className="input-field"
        />
        {candidate && (
          <label className="mt-2 flex items-center gap-2 text-sm text-content-muted">
            <input
              type="checkbox"
              checked={saveOpponent}
              onChange={e => onSaveOpponentChange(e.target.checked)}
            />
            {candidate.kind === 'new'
              ? 'Save opponent for future games'
              : `Update the saved nickname for ${candidate.opponent.name}`}
          </label>
        )}
      </div>
    </>
  )
}
