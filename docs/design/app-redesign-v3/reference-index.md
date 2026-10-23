# App redesign v3: reference index

This folder is the tracked design reference for the approved app-wide redesign
(hybrid-v3, tracker #1609). It was copied in by R1 (#1600) from the local
exploration folder `.visual-evidence/app-wide-redesign-exploration/`, which is
not tracked. From now on, this copy is the reference.

These are **static design references**, not renders of the app. Real-app
evidence for each redesign issue lives under `docs/evidence/app-redesign-v3/`.

## Precedence

When sources disagree, the higher one wins:

1. **Production behaviour, calculations, parsing and persistence.** The
   prototype's fixture numbers are illustrative only.
2. **Existing KUA theme tokens and court palettes** (`mobile/theme/*`).
   `shared/tokens.css` mirrors them; if they differ, production tokens win.
3. **The consolidated spec, [README.md](README.md).** It is an unchanged copy
   of the approved `IMPLEMENTATION-SPEC.md`. It overrides statements in the
   older write-ups that it supersedes: no chart on Weight, no inferred goal
   baseline (a progress bar only with a stored `start_weight`), and the
   Weight panel order it lists.
4. **The approved prototype and screenshots** listed below.
5. **The earlier write-ups** in `source-notes/` and `hybrid-v3/README.md`.

`source-notes/hybrid.md` keeps the inventory of production capabilities the
prototype does not draw ("Existing functionality not represented"). Those must
stay reachable. `source-notes/hybrid-v2.md` keeps the Analytics chapter
write-up.

## Which reference covers which surface

| Surface | Screenshots | Write-up |
|---|---|---|
| Home, Log, More | `shots/hybrid/{home,log,more}-*`, `shots/hybrid/state-{home,log,more}-*`, `shots/hybrid/full-*` | `source-notes/hybrid.md` |
| Analytics chapters, navigation, Progress overload states | `shots/hybrid-v2/*`, `shots/hybrid/state-analytics-*` | `source-notes/hybrid-v2.md` |
| Weight and Analytics › Bodyweight | `shots/hybrid-v3/*` | `hybrid-v3/README.md` |
| Global shell (docked tab bar, root header, panels, type scale) | every screenshot | [README.md](README.md), "Global shell" |

All screenshots are 390×844 CSS px at device scale 2 (780×1688 px), except
`full-*`, which are full-length.

## Prototype

`hybrid-v3/index.html` runs from a static file server rooted at the repository
root (for example `npx http-server .` and open
`/docs/design/app-redesign-v3/hybrid-v3/`). It loads `shared/*.js` and
`shared/*.css`.

The local `shared/fonts/` folder was **not** copied. `shared/tokens.css` points
Space Grotesk and JetBrains Mono at the production files in
`mobile/assets/fonts/`, and MaterialIcons at the copy installed with
`@expo/vector-icons` (`mobile/node_modules/...`, present after `npm install` in
`mobile/`). Without that install, icon glyphs fall back to blanks; layout and
type are unaffected. No production font or token changed.

## Curated PNG manifest

Exactly these 47 files, copied byte-for-byte with their original names:
**5,118,403 bytes**.

| Folder | Files | Bytes |
|---|---:|---:|
| `shots/hybrid/` | 24 | 2,523,350 |
| `shots/hybrid-v2/` | 12 | 1,245,569 |
| `shots/hybrid-v3/` | 11 | 1,349,484 |

- `shots/hybrid/`: `full-log-hard-dark`, `full-more-hard-dark`,
  `home-{clay-light,hard-dark}`, `log-{clay-light,hard-dark}`,
  `more-{clay-light,hard-dark}`, `state-analytics-overload-hard-dark`,
  `state-analytics-overload-rows-hard-dark`,
  `state-analytics-overload-sheet-hard-dark`,
  `state-analytics-strength-plates-hard-dark`,
  `state-home-recovery-hard-dark`, `state-home-timer-running-hard-dark`,
  `state-log-actions-sheet-hard-dark`, `state-log-deload-hard-dark`,
  `state-log-editor-hard-dark`, `state-log-editor-timer-hard-dark`,
  `state-log-history-expanded-hard-dark`, `state-log-history-sheet-hard-dark`,
  `state-log-plates-sheet-hard-dark`, `state-log-recovery-hard-dark`,
  `state-log-tuesday-hard-dark`, `state-more-settings-hard-dark`.
- `shots/hybrid-v2/`: `analytics-{clay-light,hard-dark}`,
  `nav-scroll-training-hard-dark`, `nav-tap-bodyweight-hard-dark`,
  `state-analytics-active-recovery-baseline-open-hard-dark`,
  `state-analytics-active-recovery-hard-dark`,
  `state-analytics-overload-deeplink-hard-dark`,
  `state-analytics-progress-hard-dark`, `state-analytics-recovery-hard-dark`,
  `state-analytics-training-hard-dark`, `state-weight-goal-edit-hard-dark`,
  `state-weight-history-hard-dark`.
- `shots/hybrid-v3/`: `analytics-active-recovery-bodyweight-{clay-light,hard-dark}`,
  `analytics-bodyweight-30d-{clay-light,hard-dark}`,
  `analytics-bodyweight-{clay-light,hard-dark}`,
  `analytics-bodyweight-point-{clay-light,hard-dark}`, `full-weight-hard-dark`,
  `weight-{clay-light,hard-dark}`.

Comparison boards, crops and the other exploration shots stay local only.

## Package size

| Part | Bytes |
|---|---:|
| Curated PNGs (47) | 5,118,403 |
| Spec, write-ups, prototype source and this index (14 files) | 161,995 |
| **Total** | **5,280,398** (about 5.3 MB), under the 8 MB budget |

The R1 real-app evidence (`docs/evidence/app-redesign-v3/`) is counted
separately; its README lists its size.

## Production baselines

Renders of the app before the redesign are local only:
`.visual-evidence/app-wide-redesign-exploration/baseline/shots/`. Each redesign
issue's evidence README links the "before" it compares against. The shared
real-app capture harness is
[`docs/evidence/app-redesign-v3/`](../../evidence/app-redesign-v3/README.md).
