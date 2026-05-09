# Napkin Runbook

## Curation Rules
- Re-prioritize on every read.
- Keep recurring, high-value notes only.
- Max 10 items per category.
- Each item includes date + "Do instead".

## Execution & Validation (Highest Priority)

1. **[2026-05-09] gh issue comments use `gh api repos/bpronin90/kilo/issues/<n>/comments`**
   Do instead: always use `gh api repos/bpronin90/kilo/issues/<n>/comments` not `gh issue view <n> --comments` (deprecated projects fields break it).

2. **[2026-05-09] AGENTS.md owns label requirements — check before writing code**
   Do instead: verify exactly one `agent:`, one `type:`, at least one `area:` label before starting work. If missing, stop and report.

3. **[2026-05-09] Completion comment is required before issue close**
   Do instead: post to GitHub issue with: branch, head commit, files changed, what was done, verification, tests not run + reason, blockers.

## Repo Architecture

1. **[2026-05-09] All JS is loaded as browser globals — no module bundler**
   Do instead: export everything via `window.X = X`. Don't use ES module imports/exports.

2. **[2026-05-09] Persistence is in-memory (`window.KILO_SESSIONS`, etc.) — no live Supabase wiring yet**
   Do instead: push new sessions to `window.KILO_SESSIONS` for now. If Supabase files are needed, stop and report scope mismatch.

3. **[2026-05-09] `data.jsx` seed data uses the MVP workout format already**
   Do instead: trust seed history entries — all 221 pass `parseWorkoutRow`. No need to migrate or sanitize.

## Parser Rules

1. **[2026-05-09] MVP workout row: standalone rep-group MUST have at least one comma**
   Do instead: single integer alone (e.g. `80`) is ambiguous and rejected. Standalone form requires `^\d+(,\d+)+$`.

2. **[2026-05-09] Normalize spaces-around-commas before tokenizing**
   Do instead: `raw.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ')` before splitting — handles `8, 8, 8` → `8,8,8`.

## User Directives

1. **[2026-05-09] Route frontend/UI to `agent:gemini`, planning/review to `agent:codex`**
   Do instead: only implement backend, data, and parser work. Don't touch UI components beyond what the issue's Allowed Files list permits.
