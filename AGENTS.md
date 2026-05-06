# AGENTS.md

Shared repo protocol. Keep scope narrow, token usage low, and work tied to the assigned GitHub issue.

## Task Contract

The GitHub issue is the task contract.

Start from:

```sh
gh issue view <issue-number> --comments
```

Every issue must be labeled before work begins.

Required labels:
- exactly one `agent:` label: `agent:codex`, `agent:claude`, or `agent:gemini`
- at least one `area:` label: `area:parser`, `area:ui`, `area:supabase`, `area:weight`, `area:workouts`, or `area:docs`
- exactly one `type:` label: `type:planning`, `type:implementation`, `type:review`, or `type:bug`
- exactly one `tier:` label: `tier:default` or `tier:heavy`

Read only:
- `AGENTS.md`
- your own agent file if present: `CODEX.md`, `CLAUDE.md`, or `GEMINI.md`
- the issue body and comments
- files explicitly named in the issue

Do not read unrelated docs, specs, prototypes, source files, `README` files, or broad repo areas unless the issue explicitly requires it.

If the issue lacks needed context, stop and report the missing context instead of searching broadly.

## Scope Control

Only edit files listed in the issue's `Allowed Files`.

If required work falls outside `Allowed Files`, stop and report the mismatch.

No adjacent refactors, opportunistic cleanup, broad rewrites, placeholder code, or speculative future-proofing.

Use targeted searches for exact symbols, filenames, errors, route names, or issue IDs before widening.

Read the smallest relevant code surface first. Widen only one layer at a time.

Full-file reads are a last resort.

## Complexity Discipline

Enforce Big-O discipline:
- prefer keyed lookups over nested scans
- batch repeated work where practical
- avoid repeated filesystem, API, or DB calls inside loops
- flag and justify any `O(n^2)` or worse approach before implementing

## Git And Completion

Never commit directly to `main` unless explicitly told.

Do not commit or push unless explicitly approved.

Work is not complete until the agent posts a GitHub issue comment with:
- branch name
- head commit if code changed
- files changed
- what was done
- verification performed
- tests not run, with reason
- blockers or follow-up

`AGENTS.md` owns shared rules only. Agent-specific behavior belongs in `CODEX.md`, `CLAUDE.md`, `GEMINI.md`, or agent-owned skills.
