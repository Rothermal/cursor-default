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
  return <EventRecorderManager api={BASEBALL_RECORDER_API} {...props} />
}
