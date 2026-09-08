# SOC-S24B target lineup transitions

S24B adds the domain contract; the visible manager ships in S24C and grouped
Timeline editing in S24D. No new migration or owner UI test is required here.

Automated coverage in `src/lib/soccer/live.test.ts` exercises stopped-clock
application, one-event revision, interval boundaries, each source label,
halftime window exemption, mismatched persisted flags, stale previews, no-op
rejection, final goalkeeper roles, outgoing-only and role-only counts, player
limits, substitution/window limits, unknown/duplicate players, ejection, and
disabled returns. Existing Soccer projection tests cover legacy running-clock
substitutions alongside the shared target application helper.

`previewSoccerLineupTransition` rebuilds authoritative history before deriving
the target diff. `applySoccerLineupTransition` rejects a changed setup, stream,
or cloud context and recomputes before saving. Passing an existing transition
id previews against its preceding capture history; Apply revises that event
and validates all later history. Delete/restore use existing checked history
mutations. Final and terminal matches require reopen first.

The full deployed matrix remains in the S24 plan for S24C/S24D integration.
