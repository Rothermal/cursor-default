import EventRecorderManager, { type EventRecorderManagerApi } from '../game-events/EventRecorderManager'
import {
  loadBasketballGameRecorders,
  loadBasketballPrimaryRecorderHistory,
  loadBasketballRecorderProjection,
  selectBasketballPrimaryRecorder,
  type BasketballRecorderProjection,
} from '../../lib/basketball/recorders'

const BASKETBALL_RECORDER_API: EventRecorderManagerApi<BasketballRecorderProjection> = {
  sportId: 'basketball',
  label: 'Basketball',
  loadRecorders: loadBasketballGameRecorders,
  loadHistory: loadBasketballPrimaryRecorderHistory,
  selectPrimary: selectBasketballPrimaryRecorder,
  loadProjection: loadBasketballRecorderProjection,
  streamStatus: state => state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState.projection.status
    : null,
}

interface BasketballRecorderManagerProps {
  gameId: string
  currentUserId: string | null
  canManage: boolean
}

export default function BasketballRecorderManager(props: BasketballRecorderManagerProps) {
  return <EventRecorderManager api={BASKETBALL_RECORDER_API} {...props} />
}
