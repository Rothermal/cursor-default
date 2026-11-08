import { useCallback, useState } from 'react'
import { Pencil, RefreshCw } from 'lucide-react'
import ParticipantDetailsDialog from '../roster-refresh/ParticipantDetailsDialog'
import RosterRefreshDialog, { type RosterRefreshSelection } from '../roster-refresh/RosterRefreshDialog'
import { useAuth } from '../../context/AuthContext'
import { useTeamRole } from '../../hooks/useTeamRole'
import { updateBasketballParticipantDetails } from '../../lib/basketball/commands'
import { BASKETBALL_POSITION_MAX_LENGTH } from '../../lib/basketball/positions'
import {
  applyBasketballRosterRefresh,
  basketballRosterRefreshAvailability,
  basketballRosterRefreshParticipants,
  isBasketballRosterParticipant,
} from '../../lib/basketball/rosterRefresh'
import { diffGameRoster, type RosterRefreshDiff } from '../../lib/rosterRefresh'
import { supabase } from '../../lib/supabase'
import { canManageRoster } from '../../lib/teamPermissions'
import { loadTeamRosterSnapshot, updateTeamRosterDetails } from '../../lib/teamRosterSnapshot'
import type { GameState } from '../../types'

interface RosterToolProps {
  state: GameState
  onState: (next: GameState) => void
}

/** RTN-2 "Refresh from roster" for the tracked team's lineup workspace. */
export function BasketballRosterRefreshButton({ state, onState, teamName }: RosterToolProps & { teamName: string }) {
  const { user, isConfigured } = useAuth()
  const availability = basketballRosterRefreshAvailability(state)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [diff, setDiff] = useState<RosterRefreshDiff | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const cloudReady = Boolean(isConfigured && user && supabase)
  const teamId = availability.kind === 'available' ? availability.teamId : null

  const load = useCallback(async () => {
    if (!supabase || !teamId) return
    setLoading(true)
    setLoadError(null)
    setDiff(null)
    try {
      const roster = await loadTeamRosterSnapshot(supabase, teamId)
      setDiff(diffGameRoster(basketballRosterRefreshParticipants(state), roster))
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : 'The team roster could not load.')
    } finally {
      setLoading(false)
    }
  }, [state, teamId])

  if (availability.kind === 'no_team' || !cloudReady) return null
  if (availability.kind === 'reopen') {
    return <p className="text-xs text-content-muted">Reopen the game to refresh numbers and positions from the roster.</p>
  }

  const clockRunning = Boolean(state.sportGameState?.sportId === 'basketball' && state.sportGameState.projection.clock?.running)

  const handleApply = (selection: RosterRefreshSelection) => {
    if (!diff) return
    const result = applyBasketballRosterRefresh(state, {
      recorderUserId: user?.id ?? null,
      diff,
      ...selection,
    })
    if (!result.ok) {
      setApplyError(result.message)
      return
    }
    const parts = [
      selection.updateParticipantIds.length > 0 ? `${selection.updateParticipantIds.length} updated` : null,
      selection.additionPlayerIds.length > 0 ? `${selection.additionPlayerIds.length} added` : null,
    ].filter(Boolean)
    setNotice(`Roster refreshed: ${parts.join(', ')}.`)
    setOpen(false)
    onState(result.state)
  }

  return (
    <>
      <button
        type="button"
        className="btn-secondary flex min-h-11 items-center gap-2 px-3"
        disabled={availability.kind !== 'available'}
        title={availability.kind === 'not_started' ? 'Start the game before refreshing the roster.' : undefined}
        onClick={() => {
          setOpen(true)
          setApplyError(null)
          setNotice(null)
          void load()
        }}
      >
        <RefreshCw size={16} aria-hidden /> Refresh from Roster
      </button>
      {notice && <p role="status" className="w-full text-xs text-content-muted">{notice}</p>}
      {open && (
        <RosterRefreshDialog
          teamName={teamName}
          loading={loading}
          loadError={loadError}
          diff={diff}
          applyError={applyError}
          busy={false}
          additionsBlockedReason={clockRunning ? 'Pause the clock to add players.' : null}
          onRetry={() => void load()}
          onApply={handleApply}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** RTN-2 per-player "Edit number / position" in the player detail view. */
export function BasketballParticipantEditButton({ state, onState, playerId }: RosterToolProps & { playerId: string }) {
  const { user, isConfigured } = useAuth()
  const sportState = state.sportGameState?.sportId === 'basketball' ? state.sportGameState : null
  const participant = sportState
    ? Object.values(sportState.projection.participants).find(item => item.playerId === playerId) ?? null
    : null
  const teamId = sportState?.setup.sourceTeamId ?? null
  const rosterAccess = useTeamRole(participant?.teamSide === 'tracked' && isConfigured && user ? teamId : null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  if (!sportState || !participant) return null
  const availability = basketballRosterRefreshAvailability(state)
  if (availability.kind === 'reopen') {
    return <p className="mt-2 text-xs text-content-muted">Reopen the game to change this player's number or position.</p>
  }
  const gameOpen = sportState.projection.status !== 'not_started' && Boolean(sportState.projection.currentPeriodId)
  const isRosterPlayer = isBasketballRosterParticipant(state, participant.participantId)
  const canUpdateRoster = Boolean(supabase && teamId && isRosterPlayer && canManageRoster(rosterAccess.role))

  return (
    <>
      <button
        type="button"
        className="btn-secondary mt-2 flex min-h-11 items-center gap-2 px-3"
        disabled={!gameOpen}
        title={gameOpen ? undefined : 'Start the game before editing numbers.'}
        onClick={() => { setOpen(true); setError(null); setNotice(null) }}
      >
        <Pencil size={16} aria-hidden /> Edit number / position
      </button>
      {notice && <p role="status" className="mt-1 text-xs text-content-muted">{notice}</p>}
      {open && (
        <ParticipantDetailsDialog
          displayName={participant.displayName}
          number={participant.number}
          position={participant.position}
          canUpdateRoster={canUpdateRoster}
          busy={busy}
          errorMessage={error}
          maxLength={BASKETBALL_POSITION_MAX_LENGTH}
          onClose={() => setOpen(false)}
          onSave={input => {
            const result = updateBasketballParticipantDetails(state, {
              recorderUserId: user?.id ?? null,
              source: 'manual',
              changes: [{ participantId: participant.participantId, number: input.number, position: input.position }],
            })
            if (!result.ok) {
              setError(result.message)
              return
            }
            onState(result.state)
            if (!input.alsoUpdateRoster || !supabase || !teamId || !participant.playerId) {
              setOpen(false)
              return
            }
            setBusy(true)
            void updateTeamRosterDetails(supabase, teamId, participant.playerId, input)
              .then(() => setNotice('Updated in this game and on the team roster.'))
              .catch(reason => setNotice(`Updated in this game. The team roster was not changed: ${reason instanceof Error ? reason.message : 'unknown error'}`))
              .finally(() => { setBusy(false); setOpen(false) })
          }}
        />
      )}
    </>
  )
}
