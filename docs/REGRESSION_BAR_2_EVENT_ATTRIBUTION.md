# BAR-2 Event Attribution Regression

Status: Local automated and dialog-browser checks passed. Owner production smoke
remains pending. No migration is introduced by BAR-2; owner confirmed BAR-1's 070.

## Delivered behavior

- Court capture retains the external team choice. Main actor choices contain only
  that side's eligible individuals, followed by Unattributed. General capture does
  not remember an individual globally; explicit player-detail entry may prefill one.
- Current match positions sort PG, SG, SF, PF, C, custom labels, then Unassigned.
  Jersey numbers sort numerically within position, followed by name and stable ID.
- Tracked lineups use on-court participants; untracked sides use eligible roster
  participants. Missing tracked boundaries do not expose the full roster as active.
  Existing tracker lineup review remains the recovery entry point.
- Assist and rebound selection use dropdowns. No assist/no rebound remain distinct
  from team attribution; a defensive rebound defaults to the opposite side.
- Foul and Free Throw close the court sheet before opening their own dialog. Cancel
  creates no event. Neither operation fabricates a court location.
- Current-side/current-period open awards take precedence over standalone free throws.
  One opens directly, multiple require selection, none permits standalone entry.
  Existing trip shooter takes precedence over player-detail context. No first-player
  fallback is used. Unsupported Unattributed submissions stay unresolved with errors.

## Existing foul policy

The command/projector tests accept player, team and named-staff offenders for all
five existing foul classes (personal, technical, flagrant, intentional, double).
This is existing application policy, not a new rules interpretation. Normal player
entry is live-only; Bench / staff exposes eligible bench participants and named staff.
Disqualified/ejected participants remain excluded. Counting overrides, award links,
drawn-by validation and team technical behavior still use the existing commands.

## Verification performed

- Full Vitest suite: 219 files, 1,861 tests passed.
- Production build/typecheck passed. Lint: no errors, three existing context Fast
  Refresh warnings. Existing build deployment-path/bundle-size warnings remain.
- New helper tests cover position ordering, numeric jerseys, bench/boundary/ejection
  filtering, missing event authority, existing foul policy and trip shooter context.
- Parent capture tests cover administrative handoff without mutation, side isolation
  and rejection of an actor that becomes ineligible before submission.
- Real dialog Playwright harness at 390px and 1280px in Light/Dark: actor ordering,
  assist capture, opposite-side rebound default, no-rebound submission, foul handoff,
  explicit staff path, trip shooter precedence and horizontal-overflow checks passed.
  Screenshots inspected for mobile court and desktop foul layout. The harness did
  not connect to Supabase or establish production sync/finalization behavior.

## Owner smoke after deployment

1. Start an event Basketball game with positions and a tracked lineup. Check both
   external team selections, Unattributed default, role ordering and bench exclusion.
2. Record a made shot with an assist and a missed shot with each rebound side. Verify
   attribution in Timeline; repeat Cancel and confirm no new event.
3. Open Foul from the court. Record a player foul, a team foul and a named staff foul;
   verify the explicit bench path and linked free-throw award behavior.
4. Exercise zero, one and multiple current-side open awards. Confirm shooter choice,
   one-and-one completion, stale award recovery and invalid Unattributed feedback.
5. Substitute/eject a selected player before saving where possible; confirm the
   stale actor cannot record. Resolve lineup boundary review through Manage lineup.
6. Check player-detail prefill, legacy scoring, and unchanged Soccer capture. Sync
   and reload a test game to verify the recorded events retain their attribution.
