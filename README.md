# Kilo

Kilo is a client-only React fitness-logging prototype for two core MVP loops:

- logging workout rows through a constrained freeform parser
- logging body-weight entries and reviewing recent saved history

There is no build step, backend, or Supabase wiring in the current app. The
prototype runs directly in the browser and persists user-created entries in
`localStorage`.

## Start The App

From the repo root:

```sh
python3 -m http.server 8000
```

Open [http://localhost:8000/Kilo.html](http://localhost:8000/Kilo.html) in a
browser.

The browser entry point is `Kilo.html`. It loads React, ReactDOM, and Babel
from CDN and then loads the app source from `src/`.

## Run Tests

Install dependencies once:

```sh
npm install
```

Run the full suite:

```sh
npm test
```

Watch mode:

```sh
npm run test:watch
```

Tests run with Vitest + jsdom. No browser or app server is required for the
test suite.

## Repo Map

| Path | What it is |
|------|------------|
| `Kilo.html` | Browser entry point for the prototype |
| `src/app.jsx` | Top-level tab routing across Home, Log, Weight, Stats, and More |
| `src/parser.jsx` | Workout and weight parse/validation logic |
| `src/data.jsx` | Seeded exercises, sessions, weights, goals, and global runtime state |
| `src/screens/` | User-facing screens for dashboard, workout logging, weight logging, stats, and more |
| `src/components/ui.jsx` | Shared UI primitives and design tokens used across screens |
| `tests/` | Parser tests, weight/home UI tests, and jsdom runtime setup |
| `docs/` | Current-state, architecture, testing/QA, roadmap, and repo-structure docs |

## Key Docs For Launch Review

| Doc | What it covers |
|-----|----------------|
| [`docs/current-state.md`](docs/current-state.md) | MVP status, known gaps, and launch prerequisites |
| [`docs/architecture.md`](docs/architecture.md) | Script load order, parser paths, persistence model, and global state |
| [`docs/testing-and-qa.md`](docs/testing-and-qa.md) | Automated coverage inventory and manual smoke checklist |
| [`docs/repo-structure.md`](docs/repo-structure.md) | File map, structural verdict, and repo-orientation notes |
| [`docs/mvp-roadmap.md`](docs/mvp-roadmap.md) | Broader MVP scope and the pre-launch readiness sequence |

Start with `docs/current-state.md` if you need the fastest accurate snapshot of
what is implemented and what still gates launch validation.
