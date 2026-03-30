import { useCallback, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { playerDisplayName } from '../lib/display'

export interface MergePlayerOption {
  id: string
  first_name: string
  last_name: string | null
  nickname: string | null
}

interface PreviewGameStat {
  game_id: string
  game_date: string
  opponent_name: string
  recorded_by: string
  recorder_display: string
  stat_id: string
  survivor_row: { id: string; value: number }
  duplicate_row: { id: string; value: number }
}

interface PreviewStatCorrection {
  game_id: string
  game_date: string
  stat_id: string
  survivor_row: { id: string; corrected_value: number; created_at: string; reason: string | null }
  duplicate_row: { id: string; corrected_value: number; created_at: string; reason: string | null }
}

interface PreviewTeamPlayer {
  team_id: string
  team_name: string
  survivor: { jersey_number: string | null; is_active: boolean; position: string | null }
  duplicate: { jersey_number: string | null; is_active: boolean; position: string | null }
}

interface MergePreview {
  game_stats: PreviewGameStat[]
  stat_corrections: PreviewStatCorrection[]
  team_players: PreviewTeamPlayer[]
}

function parsePreview(data: unknown): MergePreview {
  const o = data as Record<string, unknown>
  return {
    game_stats: Array.isArray(o.game_stats) ? (o.game_stats as PreviewGameStat[]) : [],
    stat_corrections: Array.isArray(o.stat_corrections) ? (o.stat_corrections as PreviewStatCorrection[]) : [],
    team_players: Array.isArray(o.team_players) ? (o.team_players as PreviewTeamPlayer[]) : [],
  }
}

type WizardStep = 'intro' | 'pick' | 'resolve' | 'confirm'

interface Props {
  supabase: SupabaseClient
  candidates: MergePlayerOption[]
  onClose: () => void
  onMerged: () => void
}

export default function MergePlayerWizard({ supabase, candidates, onClose, onMerged }: Props) {
  const [step, setStep] = useState<WizardStep>('intro')
  const [survivorId, setSurvivorId] = useState('')
  const [duplicateId, setDuplicateId] = useState('')
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [gameStatKeeps, setGameStatKeeps] = useState<string[]>([])
  const [correctionChoices, setCorrectionChoices] = useState<Array<'survivor' | 'duplicate' | 'neither'>>([])
  const [tpResolutions, setTpResolutions] = useState<
    Array<{ team_id: string; jersey_number: string; is_active: boolean; position: string | null }>
  >([])
  const [confirmText, setConfirmText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const survivor = useMemo(() => candidates.find(p => p.id === survivorId) ?? null, [candidates, survivorId])
  const duplicate = useMemo(() => candidates.find(p => p.id === duplicateId) ?? null, [candidates, duplicateId])

  const survivorFullName = useMemo(() => {
    if (!survivor) return ''
    return [survivor.first_name, survivor.last_name].filter(Boolean).join(' ').trim()
  }, [survivor])

  const loadPreview = useCallback(async () => {
    if (!duplicateId || !survivorId || duplicateId === survivorId) return
    setLoading(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('merge_players_preview', {
      p_duplicate_id: duplicateId,
      p_survivor_id: survivorId,
    })
    setLoading(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    const p = parsePreview(data)
    setPreview(p)
    setGameStatKeeps(p.game_stats.map(c => c.survivor_row.id))
    setCorrectionChoices(p.stat_corrections.map(() => 'survivor'))
    setTpResolutions(
      p.team_players.map(t => ({
        team_id: t.team_id,
        jersey_number: t.survivor.jersey_number?.trim() ?? '',
        is_active: t.survivor.is_active,
        position: t.survivor.position,
      }))
    )
    setStep('resolve')
  }, [duplicateId, survivorId, supabase])

  const executeMerge = useCallback(async () => {
    if (!preview || !duplicateId || !survivorId) return
    if (confirmText.trim().toUpperCase() !== 'MERGE') {
      setError('Type MERGE to confirm.')
      return
    }
    setLoading(true)
    setError(null)
    const resolutions = {
      game_stats: gameStatKeeps.map(keep_row_id => ({ keep_row_id })),
      stat_corrections: correctionChoices.map(choice => ({ choice })),
      team_players: tpResolutions.map(r => ({
        team_id: r.team_id,
        jersey_number: r.jersey_number.trim() === '' ? '' : r.jersey_number.trim(),
        is_active: r.is_active,
        position: r.position,
      })),
    }
    const { error: execError } = await supabase.rpc('merge_players_execute', {
      p_duplicate_id: duplicateId,
      p_survivor_id: survivorId,
      p_resolutions: resolutions,
    })
    setLoading(false)
    if (execError) {
      setError(execError.message)
      return
    }
    onMerged()
    onClose()
  }, [
    preview,
    duplicateId,
    survivorId,
    confirmText,
    gameStatKeeps,
    correctionChoices,
    tpResolutions,
    supabase,
    onMerged,
    onClose,
  ])

  const candidateOptions = useMemo(
    () =>
      [...candidates].sort((a, b) =>
        playerDisplayName(a).localeCompare(playerDisplayName(b), undefined, { sensitivity: 'base' })
      ),
    [candidates]
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-lg max-h-[min(92vh,720px)] flex flex-col"
        role="dialog"
        aria-labelledby="merge-wizard-title"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
          <h2 id="merge-wizard-title" className="text-lg font-semibold text-slate-800">
            Merge duplicate player
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}

          {step === 'intro' && (
            <div className="space-y-3 text-sm text-slate-600">
              <p>
                Combine two player profiles that represent the same person. The <strong>survivor</strong> keeps their
                id; the <strong>duplicate</strong> is removed after all games, stats, and roster links move to the
                survivor.
              </p>
              <p className="text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                This cannot be undone. Avoid merging during an active tracked game.
              </p>
              <p>You must be a team owner or admin on every team either player is on.</p>
              <button type="button" className="btn-primary w-full" onClick={() => setStep('pick')}>
                Continue
              </button>
            </div>
          )}

          {step === 'pick' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Player to keep (survivor)</label>
                <select
                  value={survivorId}
                  onChange={e => setSurvivorId(e.target.value)}
                  className="input-field"
                >
                  <option value="">Select…</option>
                  {candidateOptions.map(p => (
                    <option key={p.id} value={p.id}>
                      {playerDisplayName(p)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Duplicate to remove</label>
                <select
                  value={duplicateId}
                  onChange={e => setDuplicateId(e.target.value)}
                  className="input-field"
                >
                  <option value="">Select…</option>
                  {candidateOptions
                    .filter(p => p.id !== survivorId)
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {playerDisplayName(p)}
                      </option>
                    ))}
                </select>
              </div>
              <button
                type="button"
                className="btn-primary w-full"
                disabled={!survivorId || !duplicateId || survivorId === duplicateId || loading}
                onClick={() => { void loadPreview() }}
              >
                {loading ? 'Loading conflicts…' : 'Load conflicts'}
              </button>
              <button type="button" className="text-sm text-slate-500 underline w-full" onClick={() => setStep('intro')}>
                Back
              </button>
            </div>
          )}

          {step === 'resolve' && preview && (
            <div className="space-y-6">
              <p className="text-sm text-slate-600">
                Keep: <strong>{survivor ? playerDisplayName(survivor) : '—'}</strong> · Remove:{' '}
                <strong>{duplicate ? playerDisplayName(duplicate) : '—'}</strong>
              </p>

              {preview.game_stats.length > 0 && (
                <section className="space-y-3">
                  <h3 className="font-semibold text-slate-700 text-sm">Conflicting stat lines</h3>
                  <p className="text-xs text-slate-500">Same game, recorder, and stat recorded for both players.</p>
                  {preview.game_stats.map((row, i) => (
                    <div key={`${row.game_id}-${row.recorded_by}-${row.stat_id}`} className="border border-slate-200 rounded-lg p-3 space-y-2">
                      <p className="text-xs text-slate-500">
                        {row.game_date} vs {row.opponent_name} · {row.stat_id} · {row.recorder_display}
                      </p>
                      <div className="flex flex-col gap-2">
                        <label className="flex items-start gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name={`gs-${i}`}
                            checked={gameStatKeeps[i] === row.survivor_row.id}
                            onChange={() => {
                              setGameStatKeeps(prev => {
                                const next = [...prev]
                                next[i] = row.survivor_row.id
                                return next
                              })
                            }}
                          />
                          <span>
                            Keep survivor: <strong>{row.survivor_row.value}</strong>
                          </span>
                        </label>
                        <label className="flex items-start gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name={`gs-${i}`}
                            checked={gameStatKeeps[i] === row.duplicate_row.id}
                            onChange={() => {
                              setGameStatKeeps(prev => {
                                const next = [...prev]
                                next[i] = row.duplicate_row.id
                                return next
                              })
                            }}
                          />
                          <span>
                            Keep duplicate row: <strong>{row.duplicate_row.value}</strong>
                          </span>
                        </label>
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {preview.stat_corrections.length > 0 && (
                <section className="space-y-3">
                  <h3 className="font-semibold text-slate-700 text-sm">Conflicting stat corrections</h3>
                  {preview.stat_corrections.map((row, i) => (
                    <div key={`${row.game_id}-${row.stat_id}`} className="border border-slate-200 rounded-lg p-3 space-y-2">
                      <p className="text-xs text-slate-500">
                        {row.game_date} · {row.stat_id}
                      </p>
                      <div className="flex flex-col gap-2 text-sm">
                        {(['survivor', 'duplicate', 'neither'] as const).map(ch => (
                          <label key={ch} className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`sc-${i}`}
                              checked={correctionChoices[i] === ch}
                              onChange={() => {
                                setCorrectionChoices(prev => {
                                  const next = [...prev]
                                  next[i] = ch
                                  return next
                                })
                              }}
                            />
                            <span>
                              {ch === 'survivor' && (
                                <>Survivor correction: <strong>{row.survivor_row.corrected_value}</strong></>
                              )}
                              {ch === 'duplicate' && (
                                <>Duplicate correction: <strong>{row.duplicate_row.corrected_value}</strong></>
                              )}
                              {ch === 'neither' && 'Discard both corrections'}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {preview.team_players.length > 0 && (
                <section className="space-y-3">
                  <h3 className="font-semibold text-slate-700 text-sm">Same team on both profiles</h3>
                  <p className="text-xs text-slate-500">Set the single roster row to keep for each team.</p>
                  {preview.team_players.map((row, i) => (
                    <div key={row.team_id} className="border border-slate-200 rounded-lg p-3 space-y-2">
                      <p className="text-sm font-medium text-slate-700">{row.team_name}</p>
                      <p className="text-xs text-slate-500">
                        Survivor: #{row.survivor.jersey_number ?? '—'} · active {row.survivor.is_active ? 'yes' : 'no'}
                        {row.survivor.position != null && row.survivor.position !== '' && ` · ${row.survivor.position}`}
                      </p>
                      <p className="text-xs text-slate-500">
                        Duplicate: #{row.duplicate.jersey_number ?? '—'} · active{' '}
                        {row.duplicate.is_active ? 'yes' : 'no'}
                        {row.duplicate.position != null && row.duplicate.position !== '' && ` · ${row.duplicate.position}`}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-slate-500">Jersey</label>
                          <input
                            type="text"
                            value={tpResolutions[i]?.jersey_number ?? ''}
                            onChange={e => {
                              const v = e.target.value
                              setTpResolutions(prev => {
                                const next = [...prev]
                                next[i] = { ...next[i], jersey_number: v }
                                return next
                              })
                            }}
                            className="input-field text-sm"
                            placeholder="#"
                          />
                        </div>
                        <div className="flex items-end">
                          <label className="flex items-center gap-2 text-sm pb-2">
                            <input
                              type="checkbox"
                              checked={tpResolutions[i]?.is_active ?? true}
                              onChange={e => {
                                setTpResolutions(prev => {
                                  const next = [...prev]
                                  next[i] = { ...next[i], is_active: e.target.checked }
                                  return next
                                })
                              }}
                            />
                            Active on roster
                          </label>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Position (optional)</label>
                        <input
                          type="text"
                          value={tpResolutions[i]?.position ?? ''}
                          onChange={e => {
                            const v = e.target.value
                            setTpResolutions(prev => {
                              const next = [...prev]
                              next[i] = { ...next[i], position: v.trim() === '' ? null : v }
                              return next
                            })
                          }}
                          className="input-field text-sm"
                          placeholder="Optional"
                        />
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {preview.game_stats.length === 0 &&
                preview.stat_corrections.length === 0 &&
                preview.team_players.length === 0 && (
                  <p className="text-sm text-slate-500">No overlapping stat or roster conflicts. You can continue.</p>
                )}

              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary flex-1"
                  onClick={() => {
                    setError(null)
                    setStep('confirm')
                  }}
                >
                  Continue to confirm
                </button>
                <button
                  type="button"
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-600"
                  onClick={() => {
                    setPreview(null)
                    setStep('pick')
                  }}
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {step === 'confirm' && preview && survivor && duplicate && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Final check: <strong>{playerDisplayName(survivor)}</strong> remains;{' '}
                <strong>{playerDisplayName(duplicate)}</strong> will be deleted.
              </p>
              {survivorFullName && (
                <p className="text-xs text-slate-500">
                  Survivor full name (for reference): <strong>{survivorFullName}</strong>
                </p>
              )}
              <div>
                <label htmlFor="merge-confirm-input" className="block text-xs font-medium text-slate-500 mb-1">
                  Type <strong>MERGE</strong> to confirm
                </label>
                <input
                  id="merge-confirm-input"
                  type="text"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  className="input-field"
                  autoComplete="off"
                  placeholder="MERGE"
                />
              </div>
              <button
                type="button"
                className="btn-primary w-full bg-red-600 hover:bg-red-700 border-red-600"
                disabled={loading}
                onClick={() => { void executeMerge() }}
              >
                {loading ? 'Merging…' : 'Merge players'}
              </button>
              <button
                type="button"
                className="text-sm text-slate-500 underline w-full"
                onClick={() => setStep('resolve')}
              >
                Back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
