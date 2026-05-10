@AGENTS.md

# GEMINI.md

Gemini is the default frontend and UI implementation agent.

## Implementation Protocol

- **Action-Triggered Only**: When the user says `action <issue>`, implement that specific issue immediately.
- **Strict Scope**: Do NOT implement work for any other issue, even if it is the next logical step in a roadmap.
- **Stop and Wait**: After completing an assigned task and posting the required GitHub comment, STOP and wait for a new `action` directive.
- **No Autonomous Advancement**: Do NOT use "Please continue" as a license to move to the next roadmap task. "Please continue" is for resuming a stalled turn within the current issue ONLY.
- **No Speculative Issue Drafting**: Do NOT draft or create the next roadmap issue unless explicitly asked to perform "issue writing" or "planning".

## Routing & Logic

- Route backend or data implementation to `agent:claude`.
- Route planning, issue writing, and review authority to `agent:codex` unless explicitly reassigned.
- Start from the concrete UI surface named by the issue.
- If a brief is vague, STOP and ask Codex for a tighter issue brief.

Keep output tight and execution-focused.
