export interface TeamInfoMember {
  id: string
  user_id: string
  role: string
  accepted_at: string | null
  display_name: string | null
  email: string | null
}

interface TeamMembersCardProps {
  members: TeamInfoMember[]
  error?: string | null
}

function memberDisplayName(member: TeamInfoMember): string {
  if (member.display_name?.trim()) return member.display_name.trim()
  if (member.email?.trim()) return member.email.trim()
  return 'Unknown'
}

export default function TeamMembersCard({ members, error }: TeamMembersCardProps) {
  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold text-slate-800">Team Members</h2>
        <p className="text-xs text-slate-500">{members.length} people with access</p>
      </div>

      {error ? (
        <p className="text-sm text-slate-500">{error}</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-slate-500">No members found.</p>
      ) : (
        <div className="space-y-2">
          {members.slice(0, 5).map(member => (
            <div key={member.id} className="rounded-xl border border-slate-100 bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-slate-800 truncate">{memberDisplayName(member)}</p>
                <span className="shrink-0 text-xs font-semibold capitalize text-slate-500">
                  {member.role}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {member.accepted_at ? 'Accepted' : 'Pending'}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
