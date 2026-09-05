import type { ReactNode } from 'react'
import type {
  SoccerComparisonSection,
  SoccerMatchLeader,
} from '../../lib/soccer/summary'
import type { SoccerSummarySource } from '../../lib/soccer/summarySource'
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
  const trackedName = source.state.gameInfo?.teamName ?? 'Tracked team'
  const opponentName = source.state.gameInfo?.opponentName ?? 'Opponent'

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
