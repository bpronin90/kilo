# Closeout Script Spec

## Purpose

Provide a repo-local script that automates the mechanical parts of issue closeout after Codex has already posted `VERDICT=APPROVED`.

The script is not responsible for deciding whether work is truly complete. It executes a deterministic sequence from explicit human inputs.

## Goal

Reduce closeout work to:

1. human review and approval
2. any needed manual living-doc edits
3. one scripted closeout command

## Non-Goals

- Do not decide whether implementation quality is acceptable.
- Do not decide whether a triggered living doc needs content changes.
- Do not generate changelog prose or doc prose without explicit human input.
- Do not auto-fix a dirty or conflicted worktree.
- Do not widen into generic release automation for unrelated repo workflows.

## Proposed Interface

Primary command:

```bash
scripts/close-issue.sh <issue-number> \
  --version-bump <none|patch|minor> \
  --docs-reviewed <csv-or-none> \
  --docs-updated <csv-or-none> \
  --changelog <yes|no> \
  --close-issue <yes|no>
```

Example:

```bash
scripts/close-issue.sh 102 \
  --version-bump patch \
  --docs-reviewed docs/current-state.md,docs/architecture.md \
  --docs-updated docs/current-state.md \
  --changelog yes \
  --close-issue yes
```

## Manual Inputs Required

The caller must decide:

- whether the issue work is actually complete
- whether any triggered living docs need edits
- which docs were reviewed
- which docs were updated
- whether `CHANGELOG.md` requires an entry
- the correct version bump under repo policy

## Mechanical Responsibilities

The script should:

1. fetch issue metadata and comments with `gh`
2. verify required issue labels are present
3. verify a completion comment exists and includes the required fields from `AGENTS.md`
4. verify the current branch is an issue branch and is not `main`
5. verify the worktree is clean or fail with a clear message
6. inspect the issue branch diff against `main`
7. infer which living docs are triggered from changed files and print that list
8. validate that every triggered doc appears in `--docs-reviewed` or `--docs-updated`
9. validate that every path named in `--docs-reviewed` or `--docs-updated` exists
10. validate that every path named in `--docs-updated` is actually modified in git
11. update `CHANGELOG.md` only if `--changelog yes`
12. bump `package.json` only if `--version-bump` is not `none`
13. show the exact staged file set before commit
14. commit the closeout changes on the issue branch
15. merge the issue branch to `main`
16. push `main` to `origin`
17. close the GitHub issue if `--close-issue yes`
18. fast-forward local `main` to `origin/main`
19. delete the issue branch
20. verify the repository is left clean

## Human Confirmation Gates

The script should stop for confirmation before:

- writing changelog or version changes
- creating the closeout commit
- merging into `main`
- pushing to `origin`
- closing the GitHub issue
- deleting the issue branch

## Expected Changelog Behavior

If `--changelog yes`:

- create or update the latest version section
- use today’s date in the version heading
- add one bullet for the issue using the issue number and title
- do not attempt a long freeform summary unless an explicit message input is later added

If `--changelog no`:

- do not edit `CHANGELOG.md`

## Expected Version Behavior

- `none`: no `package.json` edit
- `patch`: increment `0.21.0 -> 0.21.1`
- `minor`: increment `0.21.0 -> 0.22.0`

The script must not infer the bump on its own.

## Failure Conditions

The script must fail closed when:

- the issue number does not exist
- required labels are missing
- the completion comment is missing
- required completion-comment fields are missing
- the current branch is `main`
- the branch name does not match the issue context closely enough
- the worktree is dirty before closeout begins
- triggered docs are not accounted for in the inputs
- a declared updated doc has no git diff
- merge, push, or issue-close operations fail

## Implementation Shape

Prefer a shell entrypoint with small helper functions over a large Node tool.

Suggested files:

- `scripts/close-issue.sh`

Optional follow-up if complexity grows:

- `scripts/lib/closeout.sh`

Rationale:

- the workflow is mostly `gh`, `git`, `npm version`, and file edits
- repo scripts already lean shell-first
- keeping the first version in bash lowers implementation overhead

## Acceptance Criteria

- given explicit closeout inputs, the script performs the full git and GitHub closeout sequence without manual command entry
- the script never silently decides subjective policy questions
- invalid or incomplete inputs fail with a specific message
- the script prints triggered docs before any destructive step
- the script leaves the repo on clean local `main` after a successful run

## Agent Fit

Recommended issue labels for implementation:

- `agent:codex`
- `type:implementation`
- `area:docs`
- `effort:default`
- `model:gpt-5.3-codex`
- `reasoning:medium`

## Model Assessment

Yes, `gpt-5.3-codex` with medium reasoning should be able to implement this.

Why that is sufficient:

- the workflow is bounded and deterministic
- the repo rules are explicit
- the work is mostly shell orchestration and validation
- subjective decisions are deliberately kept out of scope

When to raise difficulty:

- if the script later auto-generates nuanced changelog text
- if it starts editing multiple living docs automatically
- if it must reconcile dirty worktrees, partial merges, or unusual branch states
