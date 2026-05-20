@AGENTS.md

# GEMINI.md

Gemini is the default frontend and UI implementation agent.

## Implementation Protocol

- **Action-Triggered Only**: When the user says `action <issue>`, implement that specific issue immediately.
- **Strict Scope**: Do NOT implement work for any other issue, even if it is the next logical step in a roadmap.
- **Stop and Wait**: After completing an assigned task and posting the required GitHub comment, STOP and wait for a new `action` directive.
- **No Autonomous Advancement**: Do NOT use "Please continue" as a license to move to the next roadmap task. "Please continue" is for resuming a stalled turn within the current issue ONLY.
- **No Speculative Issue Drafting**: Do NOT draft or create the next roadmap issue unless explicitly asked to perform "issue writing" or "planning".

## Execution Model

Treat each issue as a sealed work packet.

Before doing any work, build these lists from the issue:
- `READ SET`: `AGENTS.md`, `GEMINI.md`, issue body, issue comments, and only the files explicitly named in the issue
- `EDIT SET`: only files under `Allowed Files`
- `OUTPUT SET`: the required GitHub issue completion comment

Execution procedure:
1. Read only the `READ SET`.
2. If required context is missing from the `READ SET`, stop and report the missing context.
3. Edit only the `EDIT SET`.
4. If a needed change falls outside the `EDIT SET`, stop and report the mismatch.
5. Do not read or modify any file not already in one of those sets unless the issue explicitly adds it.
6. After implementation, post the required issue completion comment.
7. Stop immediately after posting the comment and wait for the next explicit directive.

Default behavior overrides:
- Do not infer permission from “be complete”, “finish the task”, or “continue”.
- Completeness means finishing only the assigned issue, within the declared read, edit, and output sets.
- When in doubt, stop instead of widening scope.

## Routing & Logic

- Route backend or data implementation to `agent:claude`.
- Route planning, issue writing, and review authority to `agent:codex` unless explicitly reassigned.
- Start from the concrete UI surface named by the issue.
- If a brief is vague, STOP and ask Codex for a tighter issue brief.

Keep output tight and execution-focused.
