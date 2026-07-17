# Contributing

Thanks for your interest in contributing. This guide covers the project's contributor-facing process: getting set up, how work is tracked, and what we expect before changes land.

## Project Layout

- Root tooling and convenience scripts live in the top-level `package.json`.
- The application lives in `mobile/` (an Expo / React Native project that also exports a web build).

## Getting Set Up

1. Install Node.js (use the version expected by the project's tooling).
2. Install dependencies at the repo root and in `mobile/`:
   ```sh
   npm install
   npm --prefix mobile install
   ```
3. Provide any required environment variables locally. Secrets and `.env*` files are not committed; copy the values you need from the appropriate source.

### Running the App

Common entrypoints are exposed from the root `package.json`:

```sh
npm run mobile:start      # start the Expo dev server
npm run mobile:android    # run on Android
npm run web:serve         # serve the exported web build
```

See `mobile/package.json` for the full set of platform-specific scripts (iOS, tunneling, web export, EAS builds).

## Issue And PR Workflow

- Work is tracked through GitHub issues. Each change should map to an issue describing the intended outcome and scope.
- Branch off `main` for your work and keep the branch focused on a single issue. A descriptive branch name such as `issue/<number>-<short-scope>` is preferred.
- Keep changes scoped to the problem being solved. Avoid unrelated refactors, opportunistic cleanup, or speculative changes in the same PR.
- Open a pull request against `main`. Do not commit directly to `main`.
- In the PR, summarize what changed, why, and how it was verified.

## Testing And Verification

- Run the relevant test suite before opening a PR. The mobile app uses Jest:
  ```sh
  npm --prefix mobile test
  ```
- For web-facing changes, the web export smoke check is available:
  ```sh
  npm run web:smoke
  ```
- If you cannot run a check that would normally apply, say so explicitly in the PR and explain why.
- Verify the actual behavior you changed, not just that the build passes.

## Versioning And Changelog

- The canonical version lives in the root `package.json`.
- Pre-1.0 versioning follows a simple convention:
  - `0.x.y` patch (`y`) bumps for bug fixes, docs, and small updates that do not materially change behavior.
  - `0.x.0` minor bumps for new user-visible capability or meaningful behavior changes.
  - `1.0.0` marks the launch-ready stable release.
- When the root version changes, keep the root lockfile and mobile version fields in sync by running:
  ```sh
  node scripts/sync-version.mjs
  ```
  Do not hand-edit the mobile version fields independently.
- Product pull requests add a changelog fragment when they change user-visible
  behavior, fix a bug, materially change an operational workflow, or update
  public documentation. Internal refactors, tests, and governance-only changes
  do not need a fragment.
- Name fragments `.changes/<issue>-<sequence>.md`. Use `patch` for fixes and
  small changes or `minor` for a new capability or meaningful behavior change:
  ```text
  issue: 600
  bump: patch

  Fixed the user-visible behavior.
  ```
- Validate fragments with `npm run check:changes`.
- A release maintainer runs `npm run release:prepare` in a dedicated release
  branch. The command selects the highest requested bump, creates the dated
  `CHANGELOG.md` entry, synchronizes version files, and consumes only the
  fragments present when preparation starts. Later fragments remain for the
  next release.

## Code Quality Expectations

- Match the style and conventions of the surrounding code.
- Prefer efficient, readable approaches; avoid needlessly expensive patterns (for example, repeated network or filesystem calls inside loops).
- Keep diffs reviewable: small, focused, and tied to the issue at hand.
