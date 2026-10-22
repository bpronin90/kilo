# Training breakdown dashboard (#1588): visual evidence

Rendered evidence for issue #1588. It replaces the #1580 text lists with the
approved hybrid dashboard.

## Reference (approved, copied unchanged)

- [`reference/hybrid.html`](reference/hybrid.html) and [`reference/data-hybrid.js`](reference/data-hybrid.js).
  Open `hybrid.html?view=movement|muscles|equipment&range=30D|90D|All`.
- Approved screenshots: [`reference/shots/h-*.png`](reference/shots/), 390x844 at 2x.

## Setup (local only)

- Rendered commit: **`80dd85933d2ad48837492ba843ce2d9d2bc59fa6`**. That commit contains every
  production change. Later commits on the branch add only this evidence directory, which
  cannot affect rendering.
- Build: `EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key npx expo export --platform web --output-dir <dist>` (run from `mobile/`).
- Driver: [`capture.cjs`](capture.cjs). Run it as `node capture.cjs <dist> after [<playwright node_modules dir>] [<chromium path>]`,
  optionally with `ONLY=<regex>`. It uses headless Chromium at a **390x844 viewport, deviceScaleFactor 2**.
  The script serves the export on 127.0.0.1 and seeds about 200 days of synthetic dated workout notes
  into local storage. These include a saved legacy group choice for Face Pull, unknown exercises
  (Spoto Press, Kroc Row, Incline Dumbbell Press, …), Plank and Bike entries, and court and
  appearance preferences. It also injects a fake session for the mock project `mockproj`, answers
  Supabase calls with empty data, and aborts all other hosts. No production data was used.
- For each capture, the script opens Analytics, scrolls Training breakdown to the top, selects the
  view, and taps the listed controls. It also reports horizontal overflow and every
  `training-breakdown-*` button, tab, or radio smaller than 44x44 CSS px. All captures reported
  `overflowX: false` and no undersized targets (14 to 24 controls checked per screen).
- The real data is sparser in library metadata than the prototype's sample. Equipment
  therefore shows a large Unknown row, and the numbers differ from the reference. The
  reference figures are sample data, so only structure and behavior are compared.

## Layout checklist (from the reference, before coding)

1. Range selector 30D / 90D / All at top right; the selected option uses a container fill. "Analytics" page chrome is not duplicated.
2. Hero: a large completed-sets number with "completed sets" under it, and two compact stat boxes on the right (exercises; timed/cardio with ›, tappable).
3. Underlined tabs Movement / Muscles / Equipment, with a circular info control at the right end and a divider under the row.
4. Movement: Compared card (title + "sets in library groups"; Push|Pull and Knee-dominant|Hip-dominant bars with counts above and % below). Then a Movement groups card: two wide heat tiles, three narrower ones, a dashed "+N more groups incl. unclassified · View all ›" tile, and a footer with "N% classified" and "✎ N sets use your saved group".
5. Muscles: Body regions card with a 2x3 heat grid (Chest, Back, Shoulders, Arms, Legs, Core). Each tile shows the label, a number at the top right, "Most: <muscle>", and a per-muscle strip. Below: a Fewer→More legend, an "Overlapping counts" pill, and "N sets · unknown muscles ›".
6. Equipment: "Share of sets using each" with an "Overlapping counts" pill, the top six ranked rows (label, count, %, and a bar scaled to the top row), a hatched muted Unknown row, a dashed "All N equipment ›" button, and the coverage line.
7. Sheets: a scrim, a rounded top sheet with a grab handle and title, a meta line, and exercise rows with count and proportional bar. Stacked navigation shows a circular ‹ back control.
8. 16px gutters, 6px tile gaps, 14px card padding, radius 12 tiles / 16 cards. Labels wrap inside tiles and nothing overflows horizontally.
9. Unchanged: the section stays after Strength and before Routine Health. Other Analytics sections are untouched. During Recovery it sits inside the existing baseline disclosure.

## After screenshots (`after/`)

| File | State | Reference | Result |
| --- | --- | --- | --- |
| [01-movement-hard-dark](after/01-movement-hard-dark.png) | Hard dark, 90D, Movement | h-movement.png | PASS |
| [02-muscles-hard-dark](after/02-muscles-hard-dark.png) | Hard dark, 90D, Muscles | h-muscles.png | PASS |
| [03-equipment-hard-dark](after/03-equipment-hard-dark.png) | Hard dark, 90D, Equipment | h-equipment.png | PASS |
| [04-movement-30d-hard-dark](after/04-movement-30d-hard-dark.png) | 30D (re-derived: 310 sets) | h-movement-30d.png | PASS |
| [05-movement-all-hard-dark](after/05-movement-all-hard-dark.png) | All | h-movement-all.png | PASS |
| [10-drill-group](after/10-drill-group.png) | Group sheet | h-drill-group.png | PASS |
| [11-drill-allgroups](after/11-drill-allgroups.png) | All groups sheet | h-drill-allgroups.png | PASS |
| [12-drill-override](after/12-drill-override.png) | All groups → saved choice "Pull" (stacked, back) | h-drill-override.png | PASS |
| [13-drill-unclassified](after/13-drill-unclassified.png) | All groups → Unclassified (stacked) | (none) | PASS |
| [14-drill-region](after/14-drill-region.png) | Legs region sheet, primary + secondary (+n) | h-drill-region.png | PASS |
| [15-drill-muscle-back](after/15-drill-muscle-back.png) | Region → Glutes, back control | h-drill-muscle.png | PASS |
| [16-drill-unknown-muscles](after/16-drill-unknown-muscles.png) | Unknown muscles | h-drill-unknown-muscles.png | PASS |
| [17-drill-equipment](after/17-drill-equipment.png) | Barbell sheet | h-drill-equipment.png | PASS |
| [18-drill-unknown-equipment](after/18-drill-unknown-equipment.png) | Unknown equipment | (none) | PASS |
| [19-drill-allequipment](after/19-drill-allequipment.png) | All equipment | h-drill-allequipment.png | PASS |
| [20-drill-timed](after/20-drill-timed.png) | Timed/cardio, "not counted as strength sets" | h-drill-timed.png | PASS |
| [21-drill-info](after/21-drill-info.png) | Methodology | h-info.png | PASS |
| [30](after/30-movement-hard-light.png) / [31](after/31-muscles-hard-light.png) | Hard light | n/a | PASS |
| [32](after/32-movement-clay-light.png) / [33](after/33-muscles-clay-dark.png) / [34](after/34-equipment-clay-dark.png) / [38](after/38-drill-region-clay-light.png) | Clay light/dark | n/a | PASS |
| [35](after/35-movement-grass-light.png) / [36](after/36-muscles-grass-dark.png) / [37](after/37-equipment-grass-light.png) | Grass light/dark | n/a | PASS |
| [40-integration-strength-above](after/40-integration-strength-above.png) | Analytics header and Strength above the section | n/a | PASS |
| [41](after/41-large-text-movement.png) / [42](after/42-large-text-muscles.png) | Text scaled 1.3x (see note) | n/a | PASS |
| [43-recovery-disclosure-collapsed](after/43-recovery-disclosure-collapsed.png) | Active Recovery, baseline disclosure collapsed | n/a | PASS |
| [44-recovery-paused-expanded](after/44-recovery-paused-expanded.png) | Disclosure expanded: "Paused during Recovery · baseline history" | n/a | PASS |

## Comparison against `reference/shots/h-*.png`

All nine checklist items hold. The structure, hierarchy and interactions match the reference.
Each difference below is either a permitted theme-token difference or a contract requirement:

- **Colour:** everything comes from the court palette. Heat uses `primary` opacity steps over
  `surfaceCard`. The comparison's second series is `onSurfaceVariant` instead of the prototype's purple.
  Pills and the selected range use `primaryContainer`/`primaryOnContainer`. Unknown rows use a
  hatched `onSurfaceVariant` bar. Tile text is `onSurface` or `onPrimary`, whichever has more contrast
  against the composited fill. As a result, the highest-intensity tiles in dark mode get dark text
  (e.g. Squat/Legs), where the prototype used white.
- **Type:** numerals use Kilo's JetBrains Mono metric tokens. The prototype used Space Grotesk.
- **"Analytics" title:** omitted as page chrome, per the issue. The range selector sits on the
  "Training breakdown" title row instead.
- **Touch targets:** range options, tabs, the info control, sheet back/close and footer links are 44dp.
  This makes the range selector slightly taller than the prototype's.
- **Sheet:** adds a ✕ close control beside the title, so the sheet can be dismissed accessibly without the scrim.
- **Region strip:** draws one cell for each muscle with primary sets in that region, using #1589's
  region membership. The prototype used a smaller hard-coded map. A region with no primary sets shows one dim cell.
- **Unclassified reachability:** with five or fewer classified groups, the "more" tile reads
  "Unclassified · N sets · View all ›", so Unclassified stays reachable.
- **Large text:** this simulation multiplies the rendered DOM font sizes by 1.3. It approximates OS font scaling;
  it is not a native Dynamic Type run. The tab row wraps Equipment onto a second line, and the stat boxes wrap under the
  hero. There is no clipping or horizontal overflow.
- **Legacy (non-KUA) palette:** not reachable in the app, because `useTheme()` always resolves a court `kuaPalette`.
  `resolveBreakdownPalette` still maps legacy roles for isolated renders.

## Tests

`mobile/tests/analytics-training-breakdown.test.js` covers the following. Ranges are re-derived through
`deriveTrainingBreakdownForRange`. Unverified readiness, broken pairing and invalid `now` each show the
unavailable state, never the empty state. The suite also covers per-range empty states, date rollover
(prop change and a real midnight timer), history changes, all drill-downs including the stacked
back navigation, overrides and unreadable overrides, loading/error/paused states, and 44dp style minimums.
`mobile/tests/analytics-screen-refactor.test.js` covers screen wiring: the paired verified population,
`populationVerified` true after the Recovery filter resolves, and false when it cannot be read.
