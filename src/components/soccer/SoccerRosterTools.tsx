import { useCallback, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import ParticipantDetailsDialog from '../roster-refresh/ParticipantDetailsDialog'
import RosterRefreshDialog, { type RosterRefreshSelection } from '../roster-refresh/RosterRefreshDialog'
import { useAuth } from '../../context/AuthContext'
import { useTeamRole } from '../../hooks/useTeamRole'
import { diffGameRoster, type RosterRefreshDiff } from '../../lib/rosterRefresh'
import { SOCCER_PARTICIPANT_NUMBER_MAX_LENGTH } from '../../lib/soccer/events'
import { updateSoccerParticipantNumbers, type SoccerLiveResult } from '../../lib/soccer/live'
import {
  applySoccerRosterRefresh,
  isSoccerRosterParticipant,
  soccerNumberEditMode,
  soccerRosterRefreshParticipants,
  soccerRosterTeamId,
} from '../../lib/soccer/rosterRefresh'
import { supabase } from '../../lib/supabase'
import { canManageRoster } from '../../lib/teamPermissions'
import { loadTeamRosterSnapshot, updateTeamRosterDetails } from '../../lib/teamRosterSnapshot'
import type { GameState } from '../../types'

interface SoccerRosterToolProps {
  state: GameState
  recorderUserId: string | null
  disabled?: boolean
  onApply: (result: SoccerLiveResult) => boolean
}

/** RTN-3A "Refresh from Roster" for the Soccer Lineup tab (cloud team games). */
export function SoccerRosterRefreshButton({ state, recorderUserId, disabled = false, onApply, teamName }: SoccerRosterToolProps & { teamName: string }) {
  const { user, isConfigured } = useAuth()
  const teamId = soccerRosterTeamId(state)
  const mode = soccerNumberEditMode(state)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [diff, setDiff] = useState<RosterRefreshDiff | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supabase || !teamId) return
    setLoading(true)
    setLoadError(null)
    setDiff(null)
    try {
      const roster = await loadTeamRosterSnapshot(supabase, teamId)
      setDiff(diffGameRoster(soccerRosterRefreshParticipants(state), roster, 'number'))
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : 'The team roster could not load.')
    } finally {
      setLoading(false)
    }
  }, [state, teamId])

  if (!teamId || !isConfigured || !user || !supabase || mode === 'reopen') return null

  const handleApply = (selection: RosterRefreshSelection) => {
    if (!diff) return
    const result = applySoccerRosterRefresh(state, { recorderUserId, diff, ...selection })
    if (!result.ok) {
      setApplyError(result.message)
      return
    }
    if (!onApply(result)) return
    const parts = [
      selection.updateParticipantIds.length > 0 ? `${selection.updateParticipantIds.length} updated` : null,
      selection.additionPlayerIds.length > 0 ? `${selection.additionPlayerIds.length} added` : null,
    ].filter(Boolean)
    setNotice(`Roster refreshed: ${parts.join(', ')}.`)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled || mode !== 'live'}
        title={mode === 'not_started' ? 'Start the match before refreshing the roster.' : undefined}
        onClick={() => { setOpen(true); setApplyError(null); setNotice(null); void load() }}
        className="mb-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-bold text-content disabled:bg-control-disabled disabled:text-content-disabled"
      >
        <RefreshCw size={16} aria-hidden /> Refresh from Roster
      </button>
      {notice && <p role="status" className="-mt-2 mb-3 text-xs text-content-muted">{notice}</p>}
      {open && (
        <RosterRefreshDialog
          teamName={teamName}
          loading={loading}
          loadError={loadError}
          diff={diff}
          applyError={applyError}
          busy={false}
          onRetry={() => void load()}
          onApply={handleApply}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** RTN-3A per-player "Edit number" dialog for the Soccer Lineup tab. */
export function SoccerNumberDialog({ state, recorderUserId, onApply, participantId, onClose }: SoccerRosterToolProps & { participantId: string; onClose: () => void }) {
  const { user, isConfigured } = useAuth()
  const participant = state.sportGameState?.sportId === 'soccer'
    ? state.sportGameState.projection.participants[participantId] ?? null
    : null
  const teamId = soccerRosterTeamId(state)
  const rosterPlayer = isSoccerRosterParticipant(state, participantId)
  const rosterAccess = useTeamRole(rosterPlayer && isConfigured && user ? teamId : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!participant) return null
  const canUpdateRoster = Boolean(supabase && teamId && rosterPlayer && canManageRoster(rosterAccess.role))

  return (
    <ParticipantDetailsDialog
      displayName={participant.displayName}
      number={participant.number}
      position={null}
      showPosition={false}
      canUpdateRoster={canUpdateRoster}
      busy={busy}
      errorMessage={error}
      maxLength={SOCCER_PARTICIPANT_NUMBER_MAX_LENGTH}
      onClose={onClose}
      onSave={input => {
        const result = updateSoccerParticipantNumbers(state, [{ participantId, number: input.number }], 'manual', { recorderUserId })
        if (!result.ok) {
          setError(result.message)
          return
        }
        if (!onApply(result)) return
        if (!input.alsoUpdateRoster || !supabase || !teamId || !participant.playerId) {
          onClose()
          return
        }
        setBusy(true)
        void updateTeamRosterDetails(supabase, teamId, participant.playerId, { number: input.number })
          .then(() => onClose())
          .catch(reason => {
            setBusy(false)
            setError(`Updated in this game. The team roster was not changed: ${reason instanceof Error ? reason.message : 'unknown error'}`)
          })
      }}
    />
  )
}
