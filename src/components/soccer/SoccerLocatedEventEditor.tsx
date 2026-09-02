import { useMemo } from 'react'
import type { GameState } from '../../types'
import type { GameEvent } from '../../lib/gameEvents/types'
import {
  isSoccerLocatedEditableEvent,
  type SoccerLiveResult,
} from '../../lib/soccer'
import SoccerIncidentCaptureDialog, {
  type SoccerIncidentDraft,
  type SoccerIncidentEvent,
  type SoccerIncidentKind,
} from './SoccerIncidentCaptureDialog'
import SoccerShotCaptureDialog, { type SoccerCaptureDraft } from './SoccerShotCaptureDialog'
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
  const shotDraft = useMemo<SoccerCaptureDraft | null>(() => {
    if (!event || (event.eventType !== 'soccer.shot' && event.eventType !== 'soccer.own_goal')) {
      return null
    }
    const attackingEvent = event as SoccerShotEvent | SoccerOwnGoalEvent
    return {
      mode: 'edit',
      teamSide: attackingEvent.teamSide,
      location: event.location,
      event: attackingEvent,
    }
  }, [event])
  const incidentDraft = useMemo<SoccerIncidentDraft | null>(() => {
    if (!event || !isIncidentEvent(event)) return null
    return {
      kind: incidentKind(event),
      teamSide: event.teamSide,
      location: event.location,
      mode: 'edit',
      event,
    }
  }, [event])

  if (!event || !isSoccerLocatedEditableEvent(event)) return null
  if (event.eventType === 'soccer.shot' || event.eventType === 'soccer.own_goal') {
    return (
      <SoccerShotCaptureDialog
        key={`${event.id}-${event.revision}`}
        draft={shotDraft}
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
      draft={incidentDraft}
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
