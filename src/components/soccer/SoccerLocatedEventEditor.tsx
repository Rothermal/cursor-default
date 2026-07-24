import type { GameState } from '../../types'
import type { GameEvent } from '../../lib/gameEvents/types'
import {
  isSoccerLocatedEditableEvent,
  type SoccerLiveResult,
} from '../../lib/soccer'
import SoccerIncidentCaptureDialog, {
  type SoccerIncidentEvent,
  type SoccerIncidentKind,
} from './SoccerIncidentCaptureDialog'
import SoccerShotCaptureDialog from './SoccerShotCaptureDialog'
import type { SoccerOwnGoalEvent, SoccerShotEvent } from '../../lib/soccer'

interface SoccerLocatedEventEditorProps {
  event: GameEvent | null
  state: GameState
  recorderUserId: string | null
  selectedParticipantId?: string | null
  busy: boolean
  onApply: (result: SoccerLiveResult) => boolean
  onTrackedParticipantUsed?: (participantId: string) => void
  onClose: () => void
}

export default function SoccerLocatedEventEditor({
  event,
  state,
  recorderUserId,
  selectedParticipantId = null,
  busy,
  onApply,
  onTrackedParticipantUsed = () => {},
  onClose,
}: SoccerLocatedEventEditorProps) {
  if (!event || !isSoccerLocatedEditableEvent(event)) return null
  if (event.eventType === 'soccer.shot' || event.eventType === 'soccer.own_goal') {
    return (
      <SoccerShotCaptureDialog
        key={`${event.id}-${event.revision}`}
        draft={{
          mode: 'edit',
          teamSide: event.teamSide,
          location: event.location,
          event: event as SoccerShotEvent | SoccerOwnGoalEvent,
        }}
        state={state}
        recorderUserId={recorderUserId}
        selectedParticipantId={selectedParticipantId}
        busy={busy}
        onApply={onApply}
        onTrackedParticipantUsed={onTrackedParticipantUsed}
        onClose={onClose}
      />
    )
  }
  if (!isIncidentEvent(event)) return null
  return (
    <SoccerIncidentCaptureDialog
      key={`${event.id}-${event.revision}`}
      draft={{
        kind: incidentKind(event),
        teamSide: event.teamSide,
        location: event.location,
        mode: 'edit',
        event,
      }}
      state={state}
      recorderUserId={recorderUserId}
      selectedParticipantId={selectedParticipantId}
      busy={busy}
      onApply={onApply}
      onTrackedParticipantUsed={onTrackedParticipantUsed}
      onClose={onClose}
    />
  )
}

function isIncidentEvent(event: GameEvent): event is SoccerIncidentEvent {
  return event.eventType === 'soccer.defensive_action' ||
    event.eventType === 'soccer.foul' ||
    event.eventType === 'soccer.card' ||
    event.eventType === 'soccer.team_event'
}

function incidentKind(event: SoccerIncidentEvent): SoccerIncidentKind {
  if (event.eventType === 'soccer.defensive_action') return 'defense'
  if (event.eventType === 'soccer.team_event') return 'team_event'
  return event.eventType === 'soccer.foul' ? 'foul' : 'card'
}
