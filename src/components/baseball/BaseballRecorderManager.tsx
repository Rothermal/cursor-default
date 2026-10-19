import { useMemo } from 'react'
import EventRecorderManager, { type EventRecorderManagerApi } from '../game-events/EventRecorderManager'
import {
  loadBaseballGameRecorders,
  loadBaseballPrimaryRecorderHistory,
  loadBaseballRecorderProjection,
  selectBaseballPrimaryRecorder,
  type BaseballRecorderProjection,
} from '../../lib/baseball/recorders'

const BASEBALL_RECORDER_API: EventRecorderManagerApi<BaseballRecorderProjection> = {
  sportId: 'baseball',
  label: 'Baseball',
  loadRecorders: loadBaseballGameRecorders,
  loadHistory: loadBaseballPrimaryRecorderHistory,
  selectPrimary: selectBaseballPrimaryRecorder,
  loadProjection: loadBaseballRecorderProjection,
  streamStatus: state => state.sportGameState?.sportId === 'baseball'
    ? state.sportGameState.projection.status
    : null,
}

interface BaseballRecorderManagerProps {
  gameId: string
  currentUserId: string | null
  canManage: boolean
}

/** Recorder streams and primary selection for a Baseball event game on Game Info (BSB-6B2). */
export default function BaseballRecorderManager(props: BaseballRecorderManagerProps) {
  const api = useMemo(() => ({
    ...BASEBALL_RECORDER_API,
    selectPrimary: (gameId: string, recorderId: string) => selectBaseballPrimaryRecorder(gameId, recorderId, props.currentUserId),
  }), [props.currentUserId])
  return <EventRecorderManager api={api} {...props} />
}
