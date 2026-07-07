import QuickStatsCard from './QuickStatsCard'
import RecentResultsCard, { type TeamInfoResultGame } from './RecentResultsCard'
import RosterPreviewCard, { type TeamInfoRosterPlayer } from './RosterPreviewCard'
import SchedulePreviewCard, { type TeamInfoScheduleGame } from './SchedulePreviewCard'
import TeamMembersCard, { type TeamInfoMember } from './TeamMembersCard'
import TournamentCard, { type TeamInfoTournament } from './TournamentCard'

interface TeamOverviewCardsProps {
  teamId: string
  seasonId: string
  roster: TeamInfoRosterPlayer[]
  upcomingGames: TeamInfoScheduleGame[]
  recentResults: TeamInfoResultGame[]
  tournaments: TeamInfoTournament[]
  members: TeamInfoMember[]
  tournamentError?: string | null
  membersError?: string | null
}

export default function TeamOverviewCards({
  teamId,
  seasonId,
  roster,
  upcomingGames,
  recentResults,
  tournaments,
  members,
  tournamentError,
  membersError,
}: TeamOverviewCardsProps) {
  return (
    <div className="space-y-4">
      <QuickStatsCard
        teamId={teamId}
        seasonId={seasonId}
        firstTournamentId={tournaments[0]?.id ?? null}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <RosterPreviewCard teamId={teamId} players={roster} limit={5} />
        <SchedulePreviewCard games={upcomingGames.slice(0, 3)} />
      </div>
      <RecentResultsCard games={recentResults.slice(0, 3)} />
      <div className="grid gap-4 lg:grid-cols-2">
        <TournamentCard teamId={teamId} tournaments={tournaments} error={tournamentError} />
        <TeamMembersCard members={members} error={membersError} />
      </div>
    </div>
  )
}
