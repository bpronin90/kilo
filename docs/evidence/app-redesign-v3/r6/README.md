# R6 (#1605) evidence: Home progress hero, summary cards and navigation

Real-app renders of the redesigned Home (tracker #1609).

- **Rendered commit:** `247aea0dc1259736d56f2dec9d2b89896182d906`, rebased onto
  main `eeeeabc1`. Later commits touch only
  `docs/evidence/`, tests, and the legacy-palette (no KUA palette) 1K series colour
  fallback in `HomeOneKPanel.js`. Every capture uses a KUA court palette, so that
  fallback cannot change these renders.
- **Viewport:** 390x844 CSS px at DPR 2 (PNGs are 780x1688).
- **Clock and data:** `FIXED_NOW` 2026-10-23T12:00Z; shared fixtures plus the
  issue-local overlays in [`fixtures.cjs`](fixtures.cjs). See the
  [harness README](../README.md).
- **Size:** 64 PNGs, 5,810,043 bytes. Themes: `hard-dark` and `clay-light` for every
  state; `grass-light` and `clay-dark` for the Home first screen
  (`first-home-*`).

## Reference and original problem

- **Reference:**
  [`home-hard-dark`](../../../design/app-redesign-v3/shots/hybrid/home-hard-dark.png),
  [`home-clay-light`](../../../design/app-redesign-v3/shots/hybrid/home-clay-light.png),
  [`state-home-recovery-hard-dark`](../../../design/app-redesign-v3/shots/hybrid/state-home-recovery-hard-dark.png),
  [`state-home-timer-running-hard-dark`](../../../design/app-redesign-v3/shots/hybrid/state-home-timer-running-hard-dark.png).
- **Before:** production Home (local only,
  `.visual-evidence/app-wide-redesign-exploration/baseline/shots/`): stacked
  summary cards, no ring, no sparkline, 1K via the shared summary.
- **After (primary):** [`populated-hard-dark`](after/populated-hard-dark.png),
  [`populated-clay-light`](after/populated-clay-light.png),
  [`recovery-open-week-hard-dark`](after/recovery-open-week-hard-dark.png),
  [`timer-home-clay-light`](after/timer-home-clay-light.png).

## Layout checklist (from the reference)

1. Header: Kilo wordmark left, Cloud Sync icon right; notices sit under it.
2. Hero panel: "Current routine . Week N" mono label, routine title, ring with
   the exercise count at centre, and Progressing / Steady / Regressing counts
   from the existing Exercise Progress values; chevron opens Analytics.
3. Full-width primary "+ Log workout" and secondary "Log weight" side by side.
4. 1K card: title with chevron, "N lb to 1,000", total, one stacked bar,
   Squat / Bench / Deadlift split. No graph.
5. Body weight card: latest weight, goal context only with a verified goal,
   neutral teal sparkline (needs 2 points) with optional goal line.
6. Active Recovery replaces the hero and hides 1K; body weight stays.
7. Touch targets 44dp or more; ring and bar have text equivalents.
8. Unchanged: calculations, Recovery math, notices, retry actions, timer.

## Commands

```sh
# from mobile/ at the rendered commit
EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key \
  npx expo export --platform web --output-dir <scratch>/dist
node docs/evidence/app-redesign-v3/r6/capture.cjs <scratch>/dist <dir>/node_modules <scratch>/work
```

`R6_ONLY=populated,first` limits the run. The runner imports the frozen shared
harness and writes PNGs only to `after/`; the manifest goes to the work dir.
Fixture setup is in `fixtures.cjs` (overlays: 1K selected, aggressive goal, no
or empty routine, Recovery between weeks / note missing / unreadable, pending
sync, running timer).

## State and theme coverage

Each row is shot as `after/<name>-hard-dark.png` and `after/<name>-clay-light.png`.

| Name | State | Result |
| --- | --- | --- |
| `first-home` | Home first screen (also `grass-light`, `clay-dark`) | pass |
| `populated`, `populated-scrolled` | Hero + ring + legend, 1K, body weight; scrolled end clears docked bar | pass |
| `one-k-setup` | No complete Big 3 cycle: setup line, no remaining caption | pass |
| `no-goal`, `goal-review`, `goal-ended` | No goal; active goal with pace warning + Review goal; Goal ended | pass |
| `weigh-in-empty`, `weigh-in-one` | No weigh-in; one weigh-in (no sparkline) | pass |
| `no-routine`, `empty-routine` | Choose routine; Add exercises, no ring | pass |
| `recovery-open-week`, `recovery-between-weeks`, `recovery-note-missing`, `recovery-retry` | Recovery panel replaces hero, 1K hidden; unreadable record keeps Retry recovery | pass |
| `error-retry`, `sync-notice` | Goal-read error banner + Retry; Cloud Sync notice | pass |
| `empty`, `first-use` | Welcome panel; walkthrough | pass |
| `loading-cold-start` | Real cold-start loading: the shell's "Loading your training" overlay covers Home (#1372). Held by reload under 200x CPU throttling; the runner retries until `app-startup-overlay` is present both before and after the shot (manifest records `overlay_present_before/after` and attempts). Shot via CDP with a 2x clip, so the PNGs are 780x1688 like the others. Home itself is not drawn during loading, by design. | pass |
| `timer-home`, `timer-log`, `timer-back-home` | Rest timer visible on Home, Log, and back on Home; clears docked bar | pass |
| `link-ring-analytics` | Ring row opens Analytics (Progressive Overload) | pass |
| `link-onek-analytics` | 1K title opens Analytics (Strength) | pass |
| `link-sparkline-analytics` | Body card / sparkline opens Analytics (Bodyweight) | pass |
| `link-weight-title` | Body weight title opens Weight; no double navigation | pass |
| `link-review-goal` | Review goal opens Weight | pass |
| `link-recovery-evidence` | Recovery Evidence opens Analytics (Recovery) | pass |
| `link-sync-icon`, `link-log-workout` | Sync icon opens More > Cloud Sync; + Log workout opens Log | pass |

The manifest recorded 64 entries, 0 errors and the theme reached for every shot (the
requested tab selected for every non-loading shot).

## Comparison against the checklist

Pass on every item. Ring, legend, buttons, 1K stacked bar and sparkline match the
reference layout in both themes. Deliberate differences, all from production
data: counts and totals come from real fixtures (reference numbers are
illustrative); the ring centre reads "EXERCISES" and the sync icon is the
production sync status icon (outline when synced). Undrawn production states
(first-use, loading, notices, error, no-goal, goal-ended, weigh-in gaps) are
compared to production behaviour and remain reachable. No failures.
