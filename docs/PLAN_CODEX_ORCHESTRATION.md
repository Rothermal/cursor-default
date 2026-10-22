# Manual orchestration scope and adaptation

Status: **Disabled by the owner on 2026-10-21; retained reference only**.
Single-agent work is the project default. Previous multi-agent authorization is revoked;
only a new explicit user request may re-enable delegation. Normal tests, code review,
CI and automated PR reviews remain in effect. See [AGENTS.md](../AGENTS.md).

## Historical scope

Owner direction on 2026-10-18: start simple and add infrastructure only when needed.

The supplied ChatGPT planning document proposed an autonomous development pipeline.
The initial implementation explored controllers, persistent state, process spawning,
polling and shutdown controls. The owner has withdrawn that implementation scope.
Those files and their tests/configuration are removed from the final PR diff.
Earlier prototype test results are historical and do not validate this manual workflow.

## Retained reference

- [Workflow entry point](../CODEX_MULTI_AGENT_ORCHESTRATION.md).
- [Usage, validation and stop guidance](CODEX_ORCHESTRATION.md).
- [Shared instructions](codex/roles/common.md) and five Markdown role briefs.
- A documentation-index link for discovery.

If explicitly re-enabled, GPT-6.1 Sol / Ultra is the workflow's required selection
for the coordinating chat and every delegated role. It is not a requirement for
ordinary single-agent work. The reference workflow installs no configuration or
code to enforce its model requirement. Roles use native Codex capabilities when
explicitly invoked. The coordinating chat handles task context, evidence and handoff.

The original Markdown-only deliverable left AGENTS.md, existing agent
configurations, app source, dependencies, database and rollout policy, CI, advisory
review and deployment unchanged. Disabling the workflow now updates AGENTS.md and
the documentation only. Neither change adds Actions YAML, a controller, schemas,
machine-readable policy, runtime tests, native agent registrations, a persistent
kill switch or background polling.

## Acceptance and validation

The final diff must contain only Markdown files. Internal links must resolve, role
briefs must support a manual conversation, and instructions must preserve the
repository's source-trace, current-head review and observed-evidence rules.
No guide may refer users to removed commands or claim runtime enforcement.
If the workflow is re-enabled, the Reviewer must form its initial assessment in
fresh context without Developer narrative or self-assessment, then verify validation
evidence and targeted rebuttals. Disclose any inability to provide fresh context.

Check the final file list, internal links and whitespace. App tests/builds are
unnecessary for this documentation-only reduction; earlier runtime test counts
must not be presented as current verification. A small manual task is a future
trial, not evidence already obtained or authorization to build more infrastructure.
