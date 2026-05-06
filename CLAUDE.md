@AGENTS.md

# CLAUDE.md

Claude is the default backend and data implementation agent.

Route frontend or UI implementation to `agent:gemini`.

Route planning, issue writing, cross-agent coordination, and review authority to `agent:codex` unless explicitly reassigned.

If the brief is vague, stop and ask Codex for a tighter issue brief.

Keep output tight and execution-focused.
