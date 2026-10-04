import EventRecorderManager, { type EventRecorderManagerApi } from '../game-events/EventRecorderManager'
import {
  loadHockeyGameRecorders,
  loadHockeyPrimaryRecorderHistory,
  loadHockeyRecorderProjection,
  selectHockeyPrimaryRecorder,
  type HockeyRecorderProjection,
} from '../../lib/hockey/recorders'

const HOCKEY_RECORDER_API: EventRecorderManagerApi<HockeyRecorderProjection> = {
  sportId: 'hockey',
  label: 'Hockey',
  loadRecorders: loadHockeyGameRecorders,
  loadHistory: loadHockeyPrimaryRecorderHistory,
  selectPrimary: selectHockeyPrimaryRecorder,
  loadProjection: loadHockeyRecorderProjection,
  streamStatus: state => state.sportGameState?.sportId === 'hockey'
    ? state.sportGameState.projection.status
    : null,
}

interface HockeyRecorderManagerProps {
  gameId: string
  currentUserId: string | null
  canManage: boolean
}

/** Recorder streams and primary selection for a Hockey event game on Game Info (HKY-5B2). */
export default function HockeyRecorderManager(props: HockeyRecorderManagerProps) {
  return <EventRecorderManager api={HOCKEY_RECORDER_API} {...props} />
}
