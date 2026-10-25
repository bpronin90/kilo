# App redesign v3: real-app capture harness

> **Historical images:** completed captures have been removed from the current tree.
> [Browse the preserved image snapshot](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/evidence/app-redesign-v3/) at
> `f7cf024e488471136e11e76834570093b140eaec`; image filenames, counts and sizes below describe that snapshot.
> Capture scripts, fixtures and the verification record remain here.

This folder holds the shared harness that renders the **real app** (an Expo web
export) for every app-redesign-v3 issue (tracker #1609). R1 (#1600) added it.
Design references live in
[`docs/design/app-redesign-v3/`](../../design/app-redesign-v3/reference-index.md).

- `capture.cjs`: the browser harness (serve, seed, open, act, shoot, smoke).
- `fixtures.cjs`: deterministic localStorage scenarios at a fixed clock.
- `<rid>/`: one folder per redesign issue (`r1/`, `r2/`, ...) holding that
  issue's runner, overlays and evidence README; the historical PNGs are linked above.

**The two shared files are frozen.** Downstream issues `require()` them from
`<rid>/capture.cjs` and add their own data in `<rid>/fixtures.cjs` overlays.
Do not edit `capture.cjs` or `fixtures.cjs` in a downstream issue; if the API
truly lacks something, use a `{ run }` action or `session.page` (raw
Playwright) in your own runner and say so in your evidence README.

## Isolation and determinism

- The export is served from `127.0.0.1` on a random port. Every other request
  is aborted, except `mockproj.supabase.co`, which is answered locally with
  empty data. Nothing reaches production.
- A mock signed-in Supabase session for `mockproj` is seeded, so the app runs
  as a signed-in user with no cloud data.
- The page clock is installed at `FIXED_NOW` = `2026-10-23T12:00:00.000Z`. It
  keeps flowing from there (timers tick), so "today", relative dates and
  rest-timer countdowns render the same on every run.
- Timezone `UTC`, locale `en-US`, device scale factor 2.
- Storage is seeded once per session, before the app boots. The walkthrough is
  dismissed unless a scenario says otherwise, and the ownership prompt is
  dismissed automatically.

## Prerequisites

1. Export the branch under test, from `mobile/`:

   ```sh
   EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co \
   EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key \
   npx expo export --platform web --output-dir <scratch>/dist
   ```

   The Supabase URL must be `mockproj`; the harness only answers that host.
   Re-export after any change under `mobile/`.
2. A directory whose `node_modules` has `playwright` (1.40 or newer) and its
   Chromium. Pass the `node_modules` directory itself as `pw`. The harness
   does not add Playwright to the repo.

Never commit the export or a `mobile/node_modules` symlink.

## Smoke check

```sh
node docs/evidence/app-redesign-v3/capture.cjs \
  --dist <scratch>/dist --pw <dir>/node_modules --out <scratch>/smoke \
  --scenarios all --themes hard-dark --tabs marker
```

- `--scenarios all | a,b`: default `populated`.
- `--themes a,b`: default `hard-dark,clay-light`.
- `--tabs marker | Home,Log`: `marker` shoots only each scenario's marker tab.
  Default is all five tabs.

It writes one PNG per scenario × theme × tab and `smoke-manifest.json`. One
session per scenario and theme visits the tabs in order. Before each shot it
selects the tab and records the tab bar's actual selection (`selected_tab`). If
that is not the requested tab, it records an error and takes no shot. For each
shot it records whether the theme was reached (the top safe area matches the
court canvas colour). On the scenario's marker tab only, it also records
whether the marker text is visible (or absent). It exits 1 on any failure,
including a tab that cannot be selected. Under `first-use`, the walkthrough
blocks every tab except Home. Run it first in every redesign issue: it shows the
scenarios still load on your branch.

## Module API

```js
const { launch, smoke, runActions, TABS, THEMES, STATE_THEMES,
        FIRST_SCREEN_THEMES, PHONE, fixtures } = require('../capture.cjs');

const h = await launch({ dist, pw, out });   // out: default folder for shots
const s = await h.open({ scenario: 'populated', theme: 'clay-light', tab: 'Log' });
await s.wheel(600);                            // user scroll down
await s.shot('log-scrolled-clay-light.png');   // relative to out
await s.close();
await h.capture({ name: 'weight-goal', scenario: 'goal-ended', tab: 'Weight',
                  themes: STATE_THEMES });     // weight-goal-<theme>.png
await h.close();
```

### `launch({ dist, pw, out })`

Returns `{ open, capture, close, base }`. `base` is the served URL. Always call
`close()`.

### `open(options)` returns a `Session`

| Option | Default | Meaning |
|---|---|---|
| `scenario` | `'populated'` | A key of `fixtures.SCENARIOS`, or `{ build(now) }` |
| `overlay` | `null` | `(storage, helpers) => storage`, see Overlays |
| `theme` | `'hard-dark'` | A key of `THEMES` |
| `viewport` | `PHONE` (390×844) | CSS px |
| `insets` | `null` | Emulated safe area `{ top, bottom, left, right }` in CSS px |
| `tab` | `null` (Home) | Tab to open first |
| `now` | `FIXED_NOW` | Clock start (ms) |

### `Session`

| Method | Does |
|---|---|
| `tab(name)` | Selects the tab (`role=tab`, exact name) and verifies it is now the selected tab; throws otherwise. Does nothing if the tab is already selected. Fails after 5 s if the bar is hidden or covered |
| `selectedTab()` | Name of the app tab bar's selected tab (the one with the active indicator), or `null` |
| `click(target)`, `waitFor(target)`, `isVisible(target)` | Act on the first **visible** match. Inactive tabs stay mounted but hidden |
| `wheel(by, { steps, settle })` | **User** scroll with real wheel input at the viewport centre. Positive is down. The tab bar's auto-hide reacts |
| `scrollTo('top' \| 'end' \| y \| { by }, { selector })` | **Programmatic** scroll of the main scroller (or `selector`). No input events, so the app treats it as a programmatic jump |
| `tabBar()` | Docked tab bar box `{ top, bottom, height, visible }` in CSS px. `visible` means on screen and touchable |
| `verifyTheme()` | `{ ok, expected, actual }` for the court canvas colour |
| `shot(file, { fullPage })` | PNG at DPR 2. A relative `file` goes under `out` |
| `wait(ms)`, `close()` | |
| `page`, `ctx`, `info` | Raw Playwright page and context, and the resolved open options |

A **target** is a string (exact text) or one of `{ testID }`, `{ text, exact }`,
`{ role, name, exact }`, `{ label }` or `{ selector }`, with an optional `nth`
(which turns off the visible-only filter).

### `capture({ name, themes, actions, ...openOptions })`

Opens one session per theme (default `STATE_THEMES`) and runs `actions`. If no
action is a `{ shot }`, it writes `${name}-${theme}.png`. A `{ shot }` file may
contain `{theme}`. It returns the written paths.

Actions, run in order by `runActions(session, actions)`:

```js
{ tab: 'Log' }   { click: target }   { waitFor: target }   { wait: 500 }
{ wheel: 600 }   { scrollTo: 'end', selector? }   { shot: 'x-{theme}.png', fullPage? }
{ run: async (session) => { /* anything */ } }
```

### Themes

`THEMES` keys: `hard-dark`, `hard-light`, `clay-dark`, `clay-light`,
`grass-dark`, `grass-light`. Each maps to `[court, mode, canvas hex]`; the court
and mode are seeded as the stored theme selection and appearance preference.

Required coverage for redesign issues:

- `STATE_THEMES` (`hard-dark`, `clay-light`): every state.
- `FIRST_SCREEN_THEMES` (adds `grass-light`, `clay-dark`): each affected tab's
  first screen.

## Scenarios (`fixtures.SCENARIOS`)

All are relative to `FIXED_NOW`. The populated account has the "Upper / Lower —
Block 3" routine (week 9, Monday to Friday, about nine weeks of tracked
history), two other routines, a "Cutting → 183 lb" goal with a stored start
weight, and 43 weigh-ins ending at 187.8 lb on 10-23-2026.

| Key | State | Smoke marker |
|---|---|---|
| `populated` | The account above | Home shows "Cutting" |
| `routine-ab` | Populated, routine split into Week A / Week B with `---` | Log shows "Week B" |
| `no-goal` | Populated, no goal | Home has no "Cutting" |
| `goal-no-start` | Goal without a stored `start_weight` (no progress bar allowed) | Home shows "Cutting" |
| `goal-ended` | Goal whose target date has passed | Home shows "Goal ended" |
| `goal-unreadable` | Stored goal record is corrupt JSON | Weight shows "Could not load your weight goal" |
| `weigh-in-empty` | Routine present, no weigh-ins, no goal | Home has no "187.8" |
| `weigh-in-one` | Routine present, a single weigh-in, no goal | Home shows "187.8" |
| `recovery-active` | Active Recovery week 1 with its baseline | Log shows "Recovery" |
| `timer-running` | Populated plus a 3:00 rest timer started 30 s before `FIXED_NOW` | Home shows "Cancel" |
| `empty` | New signed-in account, no data | Home shows "Welcome to Kilo" |
| `first-use` | Empty account with the walkthrough showing | Home shows "1 of 5" (tabs are blocked) |

Building blocks are exported for overlays: `populated(now, opts)`, `base()`,
`notes()`, `tracked()`, `weights(now, { days, count })`,
`goal(now, { startWeight, targetDays, target })`, `recovery(now)`,
`RECOVERY_BASELINE`, `ROUTINE`, `ROUTINE_AB`, `PREV`, `RECOVERY_WEEK`, the note
ids, `isoAgo`, `dateAgo`, `J` (JSON.stringify), `DAY`, `FIXED_NOW`,
`FIXED_NOW_ISO`.

## Overlays

An overlay changes one scenario's storage without touching the shared file:

```js
// <rid>/fixtures.cjs
function longHistory(storage, { now, J, isoAgo, dateAgo }) {
  return { ...storage, some_key: J({ ... }), key_to_remove: null };
}
module.exports = { longHistory };
```

A `null` value removes the key. Storage keys and record shapes must be the
production ones (`mobile/lib/storage`, `mobile/lib/data`); the harness never
stubs app logic. You can also pass a whole scenario object
(`{ build: (now) => storage }`) as `scenario`.

## Historical downstream layout

```
docs/evidence/app-redesign-v3/<rid>/
  capture.cjs     # node <rid>/capture.cjs <dist> <pw> [workDir]; writes after/*.png
  fixtures.cjs    # optional overlays
  README.md       # the issue's evidence note
  after/          # generated PNGs only (smoke shots as smoke-*.png)
```

`r1/capture.cjs` is a worked example. It covers first screens across four
themes, tab-bar behaviour states, an overlay, a wide window, emulated insets, a
manifest with `verifyTheme()` and `tabBar()` per shot, and the smoke run.
The completed issue scopes tracked PNGs under `after/`; those images now live
in the linked snapshot. For new work, follow the [evidence retention rules](../README.md#retention)
and select only the captures needed for review. Keep scratch manifests outside
the tracked tree and record relevant results in the evidence note.

The evidence README records the reference images, the viewport and DPR, the
rendered commit, the export and capture commands, fixture setup and a pass/fail
comparison, following the Visual acceptance gate in `AGENTS.md`.

## Known limits

- Web export only. It shows layout, type, colour and web scroll behaviour, not
  native gesture physics or platform fonts. Active labels on web use synthetic
  bold where a bold face is not loaded.
- `insets` patches what `react-native-safe-area-context` measures on web. Other
  `env(safe-area-inset-*)` CSS is not emulated.
- Native-only surfaces (notifications, share sheets, haptics) do not render.
