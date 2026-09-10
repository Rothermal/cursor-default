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
  limit?: number
}

function memberDisplayName(member: TeamInfoMember): string {
  if (member.display_name?.trim()) return member.display_name.trim()
  if (member.email?.trim()) return member.email.trim()
  return 'Unknown'
}

export default function TeamMembersCard({ members, error, limit }: TeamMembersCardProps) {
  const visibleMembers = typeof limit === 'number' ? members.slice(0, limit) : members
  const hiddenCount = Math.max(0, members.length - visibleMembers.length)

  return (
    <section className="card min-w-0 space-y-3">
      <div>
        <h2 className="font-semibold text-content">Team Members</h2>
        <p className="text-xs text-content-muted">{members.length} people with access</p>
      </div>

      {error ? (
        <p className="text-sm text-content-muted">{error}</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-content-muted">No members found.</p>
      ) : (
        <div className="space-y-2">
          {visibleMembers.map(member => (
            <div key={member.id} className="rounded-xl border border-line bg-surface px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-content truncate">{memberDisplayName(member)}</p>
                <span className="shrink-0 text-xs font-semibold capitalize text-content-muted">
                  {member.role}
                </span>
              </div>
              <p className="text-xs text-content-muted">
                {member.accepted_at ? 'Accepted' : 'Pending'}
              </p>
            </div>
          ))}
          {hiddenCount > 0 && (
            <p className="text-xs text-content-muted">+{hiddenCount} more members</p>
          )}
        </div>
      )}
    </section>
  )
}
