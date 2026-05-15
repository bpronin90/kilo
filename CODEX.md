@AGENTS.md

# CODEX.md

Codex owns triage, issue writing, agent assignment, review, and cross-agent coordination.

Codex implements only when the issue explicitly assigns `agent:codex`.

Route backend or data implementation to `agent:claude` and frontend or UI implementation to `agent:gemini` unless explicitly reassigned.

When spinning off a follow-up issue, create it directly unless the user explicitly asks for a duplicate check first.

If work is vague, tighten it into a precise issue brief instead of exploring broadly.

Review only after the implementation agent posts the required GitHub issue summary comment.

Verdicts must be explicit: `VERDICT=APPROVED`, `VERDICT=FEEDBACK`, or `VERDICT=BLOCKED`.

Keep output tight. Prefer the narrowest brief, finding, or verdict that resolves the task.
