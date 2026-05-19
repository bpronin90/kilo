# AGENTS.md

Shared repo protocol. Keep scope narrow, token usage low, and work tied to the assigned GitHub issue.

## Task Contract

The GitHub issue is the task contract.

Start from:

```sh
gh issue view <issue-number> --json number,title,body,labels
gh api repos/<owner>/<repo>/issues/<issue-number>/comments
```

Do not use `gh issue view <issue-number> --comments`. In this repo, that path currently hits deprecated GitHub Projects fields through the local `gh` query.

Every issue must be labeled before work begins.

Required labels:
- exactly one `agent:` label: `agent:codex`, `agent:claude`, or `agent:gemini`
- at least one `area:` label: `area:parser`, `area:ui`, `area:supabase`, `area:weight`, `area:workouts`, or `area:docs`
- exactly one `type:` label: `type:planning`, `type:implementation`, `type:review`, or `type:bug`

Optional sizing label:
- at most one `effort:` label: `effort:default` or `effort:heavy`

`effort:` describes task scale only. It is a sizing hint for the work itself, not the runtime setting for the assigned agent, and must not be used as a substitute for `model:` or `reasoning:`.
- `effort:default` means normal scoped work with ordinary implementation and verification burden
- `effort:heavy` means materially larger, riskier, or more coordination-heavy work, such as multiple moving parts, higher verification burden, or a greater chance of hidden edge cases

Reasoning label policy:
- when an agent/runtime supports an explicit reasoning control, prefer `reasoning:medium`
- use `reasoning:high` only when the task is unusually complex and that complexity is visible in the issue itself
- `reasoning:low` and `reasoning:xhigh` should be rare and require explicit justification in the issue body or comments
- shape issues to avoid needing more than `reasoning:high` when practical

Agent runtime labels:
- if `agent:codex` is set, require exactly one `model:` label: `model:gpt-5.4`, `model:gpt-5.4-mini`, or `model:gpt-5.3-codex`
- if `agent:codex` is set, require exactly one `reasoning:` label: `reasoning:low`, `reasoning:medium`, `reasoning:high`, or `reasoning:xhigh`
- if `agent:claude` or `agent:gemini` is set, do not add `model:` labels unless the repo later introduces agent-specific runtime labels for them
- if `agent:claude` is set, require exactly one `reasoning:` label: `reasoning:low`, `reasoning:medium`, `reasoning:high`, or `reasoning:xhigh`
- if `agent:gemini` is set, do not require `reasoning:` unless that agent path later supports an explicit reasoning control and the repo adopts labels for it

Read only:
- `AGENTS.md`
- your own agent file if present: `CODEX.md`, `CLAUDE.md`, or `GEMINI.md`
- the issue body and comments
- files explicitly named in the issue

Do not read unrelated docs, specs, prototypes, source files, `README` files, or broad repo areas unless the issue explicitly requires it.

If the issue lacks needed context, stop and report the missing context instead of searching broadly.

## Scope Control

Only edit files listed in the issue's `Allowed Files`.

`Allowed Files` is the hard edit boundary for all work, including `CHANGELOG.md`, `package.json`, and any living docs.

Reviewer exception:
- During review and closing procedure, Codex may update living docs, `CHANGELOG.md`, and `package.json` when those updates are required to accurately close out completed issue work.
- This exception exists to keep implementers focused on the assigned product change while reserving final documentation and versioning alignment for the reviewer.
- This exception does not authorize unrelated product edits outside the issue scope.

If required implementation work falls outside `Allowed Files`, stop and report the mismatch.

If changelog, version, or doc updates seem required by another rule but those files are not listed in `Allowed Files`, stop and report the mismatch instead of editing them, unless you are the reviewer performing closing procedure under the reviewer exception above.

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

## Versioning And Changelog

Canonical repo version lives in `package.json`.

Pre-1.0 versioning policy:
- `0.1.0` is the initial documented MVP baseline.
- `0.1.x` is for bug fixes, docs/process changes, and small updates that do not materially change MVP behavior or flows.
- `0.x.0` is for a new MVP-visible capability or a meaningful behavior change.
- `1.0.0` is the launch-ready stable MVP.

Implementation agents do not update `CHANGELOG.md` unless it is explicitly listed in `Allowed Files`.

During closing procedure, the reviewer updates `CHANGELOG.md` whenever an issue changes behavior, workflow, docs, or version, even if `CHANGELOG.md` was not part of the implementation `Allowed Files`.

Changelog format:
- use a version heading with the release date
- list issue-based bullets under each version

## Git And Completion

Create a branch for your assigned issue before committing. Treat the issue branch as the default working branch for that task.

Issue branches must use this format:
- `issue/<issue-number>-<short-kebab-scope>`
- example: `issue/103-redesign-weight-history-rows`

Do not invent agent-specific prefixes, usernames, or alternate issue branch formats when the work is tied to a GitHub issue.

Never commit directly to `main` unless explicitly told.

Merging to `main` requires explicit approval.

Do not commit or push unless explicitly approved.

Work is not complete until the agent posts a GitHub issue comment with:
- branch name
- head commit if code changed
- files changed
- what was done
- verification performed
- Docs reviewed: ...
- Docs updated: ... or `none`
- Changelog updated: `yes`/`no`
- Version bump: `old -> new` or `none`
- tests not run, with reason
- blockers or follow-up

## Living Doc Review Map

Use issue scope plus changed files to decide which living docs need review. Do not reread every doc by default.

For implementation agents, review requirements in this section do not authorize edits outside `Allowed Files`. During closing procedure, the reviewer may update the triggered living docs even when they were not part of the implementation `Allowed Files`.

- `docs/current-state.md`
  Review when issue scope changes shipped status, current behavior, or known gaps for a user-visible feature; or when changed files affect active product flows.
- `docs/repo-structure.md`
  Review when changed files add, remove, move, or repurpose top-level directories, app surfaces, shared modules, or operational entrypoints.
- `docs/testing-and-qa.md`
  Review when issue scope changes test strategy, required verification steps, quality gates, or the meaning of existing test coverage; or when changed files add or remove test suites, helpers, or CI-facing verification paths.
- `docs/architecture.md`
  Review when issue scope changes system boundaries, data flow, integration contracts, or runtime responsibilities; or when changed files alter cross-module coordination, persistence, auth, or external service usage.
- `docs/mvp-roadmap.md`
  Review when issue scope changes MVP scope, sequencing, dependency order, milestone readiness, or completion status for roadmap work.

### Closing procedure

If the user tells the reviewer to `carry out closing procedure`, treat that as explicit approval to perform the full closeout sequence for the current issue once the reviewer has confirmed the issue work is complete.

`carry out closing procedure` has two required phases:

1. Issue close readiness
   - Verify the assigned issue task is actually complete, whether the work was done by the reviewer or another agent.
   - Verify the required completion comment is posted on the GitHub issue and includes all required completion details.
   - Verify there are no known blockers preventing the issue from being closed.
   - Close the GitHub issue once the reviewer confirms it is ready.

2. Repository closeout
   - Review only the living docs whose trigger conditions were hit by the issue scope or changed files.
   - Update reviewed docs only when the issue actually changed the documented state.
   - Update `CHANGELOG.md` for qualifying issue work.
   - Bump `package.json` version according to the versioning policy when the completed issue warrants it.
   - Commit the completed issue work on the issue branch.
   - Merge the issue branch to `main`.
   - Push the resulting `main` branch to `origin`.
   - Align the local repository with `origin/main`.
   - Delete the no-longer-needed issue branch.
   - Leave the repo in a clean post-merge state.

What `carry out closing procedure` does not mean:
- do not close or merge work that is not actually complete
- do not widen scope beyond the issue except for living docs whose trigger conditions were hit and genuinely need updates
- do not preserve extra local branches or a dirty worktree without a stated reason

`AGENTS.md` owns shared rules only. Agent-specific behavior belongs in `CODEX.md`, `CLAUDE.md`, `GEMINI.md`, or agent-owned skills.
