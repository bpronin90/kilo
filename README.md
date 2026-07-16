# Kilo

Kilo is a local-first fitness tracking app with optional cloud sync, built with Expo/React Native.

- `mobile/` is the active app path. It persists user-created entries locally
  via AsyncStorage-backed modules under `mobile/storage/`.
- The legacy browser prototype is archived under
  `docs/archive/browser-prototype/` for reference.

Since v0.70.0 a Supabase backend exists: a `kilo` schema with RLS, an
auth/session client, and a storage-seam cloud adapter. The app stays
local-first — with no env config it runs entirely on AsyncStorage. Cloud mode
activates only when `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`
are provided, and signed-out users stay local-only either way.

## Tech Stack

| Layer | Technology |
|-------|------------|
| App runtime | Expo / React Native native app under `mobile/` |
| Language | JavaScript modules for screens, parser, storage, and shared data helpers |
| Persistence | Local AsyncStorage-backed storage modules under `mobile/storage/` |
| Testing | Jest suites under `mobile/tests/`, run with `npm --prefix mobile test` |
| Native packaging | EAS Build for physical-device Android preview builds |
| Backend/services | Optional Supabase backend (`kilo` schema with RLS, auth/session client, cloud storage adapter); local-only when no env config is set |

## Run The Native App

From the repo root, the default native dev entrypoint is:

```sh
npm run mobile:start
```

From `mobile/`, the equivalent Expo command is `npm start`.

For physical-device Android packaging, the currently documented native build
path is:

```sh
cd mobile
eas build --platform android --profile preview
```

## Run Tests

Install dependencies once:

```sh
npm --prefix mobile install
```

Run the test suite:

```sh
npm --prefix mobile test
```

## Repo Map

| Path | What it is |
|------|------------|
| `mobile/` | Active Expo/React Native app |
| `mobile/lib/parser.js` | Workout and weight parse/validation logic |
| `mobile/lib/data.js` | Exercise catalog, entry factories, and shared analytics helpers |
| `mobile/screens/` | Native screens: Home, Log, Weight, Analytics, More |
| `mobile/tests/` | Jest test suites for parser, data, storage, and screen coverage |
| `supabase/` | Tracked Supabase config, Edge Functions (`account-export`, `account-delete`, `health-data-delete`), and pgTAP DB tests |
| `scripts/` | Repo maintenance/deploy scripts: `sync-version.mjs`, `deploy-kilo-functions.sh` |
| `docs/` | Current-state, architecture, testing/QA, roadmap, and repo-structure docs |
| `docs/archive/browser-prototype/` | Archived legacy browser prototype (reference only) |

## Key Docs For Launch Review

| Doc | What it covers |
|-----|----------------|
| [`docs/current-state.md`](docs/current-state.md) | MVP status, known gaps, and launch prerequisites |
| [`docs/architecture.md`](docs/architecture.md) | Script load order, parser paths, persistence model, and global state |
| [`docs/testing-and-qa.md`](docs/testing-and-qa.md) | Automated coverage inventory and manual smoke checklist |
| [`docs/repo-structure.md`](docs/repo-structure.md) | File map, structural verdict, and repo-orientation notes |
| [`docs/backend-roadmap.md`](docs/backend-roadmap.md) | Active roadmap for the web-first Supabase transition |
| [`docs/tester-guide.md`](docs/tester-guide.md) | Tester-facing guide for installing and exercising preview builds |

Start with `docs/current-state.md` if you need the fastest accurate snapshot of
what is implemented and what still gates launch validation.

## Copyright

Copyright © Benjamin Pronin. All rights reserved.
