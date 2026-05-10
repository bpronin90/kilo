# Kilo

Kilo is a client-only React fitness-logging prototype. No build step required.

---

## Starting the App

From the repo root, start a local HTTP server:

```sh
python3 -m http.server 8000
```

Open [http://localhost:8000/Kilo.html](http://localhost:8000/Kilo.html) in a
browser.

The app loads React, ReactDOM, and Babel from CDN and runs entirely in the
browser. All persistence is `localStorage`.

---

## Running Tests

Install dependencies (first time only):

```sh
npm install
```

Run the full test suite:

```sh
npm test
```

Tests run with Vitest + jsdom. No browser required.

---

## Key Docs for Launch Review

| Doc | What it covers |
|-----|----------------|
| [`docs/current-state.md`](docs/current-state.md) | MVP status, known gaps, launch prerequisite checklist |
| [`docs/architecture.md`](docs/architecture.md) | Script load order, parse paths, persistence model, global state |
| [`docs/testing-and-qa.md`](docs/testing-and-qa.md) | Automated coverage inventory and manual smoke checklist |
| [`docs/repo-structure.md`](docs/repo-structure.md) | File map: what each file does and what is prototype-only |

Start with `docs/current-state.md` for an accurate snapshot of what is
implemented and what is not.
