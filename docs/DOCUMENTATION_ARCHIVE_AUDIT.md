# Documentation Archive Audit

Status: first conservative reset complete. Documentation-only; no database,
game-state or release-policy change. This is not a certification of all old QA.

## Changes in this pass

| Documents | Disposition | Reason |
| --- | --- | --- |
| Root README | Rewritten; previous content retained in `archived/README_PRE_RESET.md` | Mixed current app, legacy architecture, migrations and six months of backlog |
| Agent overview | Rewritten; previous snapshot retained in `archived/AGENT_CODEBASE_OVERVIEW_PRE_RESET.md` | Legacy task routing and sport-support descriptions were misleading |
| NAV-1, NAV-2, AUTH-1, AUTH-2 | Implementation history relocated to `completed/`; original paths redirect | Implemented routing/auth/account surfaces are visible in code and previous merge history; preserve original checklists without claiming all manual checks passed |
| Shared interaction decisions | New current reference | Keeps approved target distinct from shipped behavior |
| Basketball workspace plan | New proposed execution plan | Captures scope and legacy/event constraints before UI edits |

## Retain as active references for now

- BKE and SOC architecture plans: implementation history is extensive, but they
  also carry authority contracts and unresolved release evidence. Extract a current
  contract reference and reconcile remaining items before bulk movement.
- BKE-6E and related regression matrices: owner reported successful checks plus
  setup/binding/lineup concerns earlier. Do not mark pending rows passed from memory;
  preserve specific results and link confirmed issues during the next reconciliation.
- THM plans/matrices: implemented/released does not close all post-deployment checks.
- Soccer field-test backlog and recent feature matrices: keep outstanding issues
  and deployed-verification status discoverable.
- Timing/live-lineup assessment and team branding: not completed work.
- Access matrix, database migrations, operator scripts and recovery instructions:
  operational references, not disposable feature history.
- AGENTS.md: retain for runtime guidance. Its accumulated historical feature notes
  need a separate source-by-source reconciliation; the new overview warns about
  legacy descriptions instead of claiming this large file is fully refreshed.

## Historical backlog retained for triage

The complete old README remains linked from the active index. Its old roadmap,
known-issue and performance sections are preserved, not silently closed. Examples:
historical duplicate final/in-progress listings need reproduction; the profiles
RLS performance note needs checking against current migrations before any fix;
Capacitor/native distribution and Sports Engine remain future ideas, not installed
capabilities. Older standalone F13 metadata design is superseded by BKE-3; F11
remains feedback-dependent. Do not revive old storage proposals from snapshots.

## Safe archive criteria

1. Confirm implementation against code and merged history, not only a plan title.
2. Separate unfinished development, deferred ideas, open bugs and missing QA evidence.
3. Give each remaining item a discoverable active owner/link before moving the source.
4. Preserve historical rationale, migration references and recorded evidence.
5. Update relative links and retain old-path redirects where widespread references
   would otherwise break. Redirects are not duplicate execution plans.
6. Validate documentation links. Do not delete migrations or rewrite historical
   test results to make the directory look finished.

No blanket archive of BKE/SOC/THM is proposed until that reconciliation is done.

## Verification for this pass

[Operations](OPERATIONS.md) is the active entry point for deployment, historical
integration context and icon regeneration, linked from both documentation indexes.
The older deployment guide's service-worker example is explicitly marked stale.

Initial reset: checked local Markdown targets in all 18 changed/new documents with
no missing files.
Compared all six relocated/snapshot documents with their original Git versions:
content preserved in full, apart from explanatory banners and relative-link rebasing.
Diff whitespace checks passed. No runtime tests or database operations were run
because this change is documentation-only.

Operations hardening: all 427 local links across the expanded 20-document scope
resolve. The existing release guard now checks the operator-facing prompt-update,
build-verification, toolchain and key-fallback guidance. Its 25 focused tests,
TypeScript and targeted lint passed. No application behavior, deployment or
database operation changed; no full runtime suite was rerun for this follow-up.
