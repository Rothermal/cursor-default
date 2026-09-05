import type { ReactNode } from 'react'
import type {
  SoccerComparisonSection,
  SoccerMatchLeader,
} from '../../lib/soccer/summary'
import type { SoccerSummarySource } from '../../lib/soccer/summarySource'
import { gameSideDisplayName } from '../../lib/display'
import SoccerMatchDetails from './SoccerMatchDetails'
import SoccerMatchLeaders from './SoccerMatchLeaders'
import SoccerTeamComparison from './SoccerTeamComparison'

interface SoccerOverviewProps {
  source: SoccerSummarySource
  comparisons: SoccerComparisonSection[]
  leaders: SoccerMatchLeader[]
  healthy: boolean
  actions?: ReactNode
}

export default function SoccerOverview({
  source,
  comparisons,
  leaders,
  healthy,
  actions,
}: SoccerOverviewProps) {
  const trackedName = gameSideDisplayName(source.state.gameInfo, 'tracked', 'Tracked team')
  const opponentName = gameSideDisplayName(source.state.gameInfo, 'opponent')

  return (
    <main>
      {actions}
      {healthy && (
        <>
          <SoccerTeamComparison
            sections={comparisons}
            trackedName={trackedName}
            opponentName={opponentName}
          />
          <SoccerMatchLeaders leaders={leaders} />
        </>
      )}
      <SoccerMatchDetails source={source} />
    </main>
  )
}
