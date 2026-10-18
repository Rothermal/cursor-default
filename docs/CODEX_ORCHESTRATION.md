# Using the manual orchestration workflow

Select **GPT-6.1 Sol / Ultra** in Codex and explicitly invoke the
[workflow](../CODEX_MULTI_AGENT_ORCHESTRATION.md) for a task. All delegated roles
must use the same model/effort. Verify the selection using available client
information; if it is unavailable, obtain the user's confirmation before
delegating. Markdown guidance cannot enforce that setting.

A starting request is:

> Use CODEX_MULTI_AGENT_ORCHESTRATION.md for this task: [describe the change].
> Use GPT-6.1 Sol / Ultra for all roles, choose only the roles needed, implement
> the change and independently review it. Preserve the existing project conventions.

The coordinating chat reads the [shared role instructions](codex/roles/common.md)
and relevant role briefs, reads the governing plan, and establishes acceptance
criteria. It can assign bounded subtasks through native Codex capabilities.
Each brief should identify the task, scope, files or interfaces, acceptance criteria,
permissions and expected evidence. Separate agents need that context explicitly;
do not assume they know the coordinating chat's decisions.

## Choose roles to match the work

| Work | Roles |
| --- | --- |
| Small isolated change | Developer and independent Reviewer; brief coordination in the current chat |
| Multiple interfaces or architectural choices | Architect, Developer and Reviewer |
| Auth/access, migrations, destructive operations, secrets, security, cloud authority, broad dependencies or breaking interfaces | All five roles; design challenge before implementation and final challenge when useful |

Use one implementation writer unless the user explicitly authorizes separate,
nonoverlapping work. Use the repository's normal branch/worktree conventions when
isolation is needed. Reviewers inspect and report; Developer repairs. Disagreements
are resolved against requirements and source evidence. Escalate unresolved blocking
questions rather than repeating the same unsuccessful cycle.

## Verify and hand off

Run checks appropriate to the task using existing package scripts and repository
guidance. Report commands, outcomes and actual counts. Read related regression
records; unit tests and builds do not establish live Supabase, mobile, installed-PWA
or release signoff. Do not change checks or rollout gates to get a clean result.

Review the exact current diff and prior findings after a substantive fix. Preserve
each acceptance criterion. Explicitly resolve, retain or supersede earlier findings.
Use the merge-verdict rules in AGENTS.md; missing required evidence means the
review is incomplete.

When authorized, prepare a PR with the behavior change, design choices, validation,
risks and remaining human checks. Existing session authorization continues to
apply. Inspect CI for the current head when preparing the handoff and report its
observed status. Do not add a polling loop or background monitor. A pending check
remains pending until a later explicit check supplies evidence.

## Stop or return to ordinary work

Say "stop the orchestration workflow" or "continue without orchestration."
The coordinator stops new delegation, uses native controls to interrupt known
active agents and owned commands, preserves changes, and reports what was stopped
or could not be confirmed. It resumes the workflow only at the user's request.

These files do not start anything automatically. There is no persistent switch,
custom shutdown command, process supervisor or automatic restart. Stopping a chat
must not be described as proof that every separate process has stopped; verify the
known work using the available native controls.

Keep the first trial small. Record useful lessons in these Markdown files. Add
tooling later only for a concrete repeated need and a separately requested change.
