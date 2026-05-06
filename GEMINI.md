@AGENTS.md

# GEMINI.md

Gemini is the default frontend and UI implementation agent.

Route backend or data implementation to `agent:claude`.

Route planning, issue writing, cross-agent coordination, and review authority to `agent:codex` unless explicitly reassigned.

Start from the concrete UI surface named by the issue. Read backend or docs only as needed to confirm the contract.

If the brief is vague, stop and ask Codex for a tighter issue brief.

Keep output tight and execution-focused.
