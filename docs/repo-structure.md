# Repo Structure

Status: current directory-level map. This document describes stable ownership
boundaries, not every file in the repository. Use `rg --files` for an exact
inventory and the package manifests for current commands.

## Entry Points

The active application is the Expo/React Native project under `mobile/`.

```sh
npm run mobile:start
npm run mobile:android
npm --prefix mobile test
```

The root `package.json` provides convenience, verification, deployment, and
release commands. `mobile/package.json` owns app-specific development, build,
update-policy, audit, and Jest commands.

## Top-Level Layout

| Path | Responsibility |
|------|----------------|
| `README.md` | Project introduction and shortest setup path. |
| `CONTRIBUTING.md` | Public contribution, issue/PR, testing, and changelog workflow. |
| `package.json` | Root command surface and canonical application version. |
| `.github/` | Pull-request template, dependency automation, and CI workflows. |
| `.changes/` | Unreleased changelog fragments consumed by release preparation. |
| `mobile/` | Active Expo/React Native application. |
| `supabase/` | Kilo migrations, Edge Functions, configuration, operations, and database tests. |
| `scripts/` | Repository verification, deployment, monitoring, and release tooling. |
| `docs/` | Current documentation indexed by [`docs/README.md`](README.md). |
| `docs/archive/` | Historical plans, specifications, samples, and retired prototype code. |

Local workflow-layer files such as `AGENTS.md`, `CLAUDE.md`, `CODEX.md`,
`GEMINI.md`, and `.codex/` are gitignored and are not product artifacts.

## Mobile Application

| Path | Responsibility |
|------|----------------|
| `mobile/App.js` | App providers, persistent five-tab shell, top-level orchestration, and typed cross-screen navigation. |
| `mobile/index.js` | Expo application registration. |
| `mobile/app.config.js` and `mobile/app.json` | Expo runtime, platform, and build configuration. |
| `mobile/screens/` | Home, Log, Weight, Analytics, and More screens plus screen-owned helpers. |
| `mobile/components/` | Shared UI, feature panels, charts, modals, and sub-screens. |
| `mobile/hooks/` | Auth, storage, sync, and screen-facing state boundaries. |
| `mobile/lib/parser/` | Workout-note parsing, session construction, and parser-derived analytics. |
| `mobile/lib/data/` | Domain calculations for workouts, weight, goals, fatigue, recovery, and strength. |
| `mobile/lib/parser.js` and `mobile/lib/data.js` | Compatibility barrels for the domain modules. |
| `mobile/storage/entries/` | Local persistence, backup/import, migrations, settings, and domain stores. |
| `mobile/storage/cloud/` | Cloud bootstrap, transport, reconciliation, and cloud domain methods. |
| `mobile/storage/secureStorage.js` | Native encrypted-storage boundary and device wipe. |
| `mobile/theme/` | Appearance preference, semantic colors, and theme context. |
| `mobile/tests/` | Jest unit, integration, source-contract, and rendered-component tests. |
| `mobile/assets/` and `mobile/certs/` | Packaged assets and public certificate documentation. |

Screen code should consume domain behavior through `hooks/`, `lib/`, and
`storage/` rather than creating parallel parser, calculation, or persistence
rules.

## Supabase

| Path | Responsibility |
|------|----------------|
| `supabase/migrations/` | Ordered schema and database-behavior history for Kilo. |
| `supabase/functions/` | Server-owned account export/deletion and health-data deletion endpoints. |
| `supabase/functions/_shared/` | Shared auth, rate-limit, health-scope, and response helpers. |
| `supabase/tests/` | pgTAP and concurrency/security contract tests. |
| `supabase/operations/` | Explicit operator-run SQL that is not ordinary migration history. |
| `supabase/config.toml` | Local project and function configuration. |

Kilo owns only the `kilo` schema in the shared production project. Other
application schemas are outside this repository's ownership boundary.

## Repository Tooling

The `scripts/` directory contains focused tools for:

- changelog fragment validation and release preparation;
- synchronized version checks;
- review-disposition enforcement;
- migration drift detection;
- Edge Function deployment and verification;
- health-deletion monitoring and end-to-end verification;
- audit and static web-export smoke checks.

Use the scripts exposed by the root package manifest instead of copying their
internal commands into documentation.

## Documentation

[`docs/README.md`](README.md) is the canonical documentation index.
[`docs/archive/README.md`](archive/README.md) explains the historical boundary.
Living docs describe current contracts; completed delivery chronology belongs in
the changelog, GitHub issues, or the archive.
