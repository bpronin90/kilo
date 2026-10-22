# Training breakdown session windows (#1597): visual evidence

The defect: in release 1.21.1, Training breakdown's 30D and 90D were always empty.
They read `note.date`, but real workout notes don't have that field. #1597 replaces
them with per-exercise session windows: **Last 4 / Last 12 / All**, defaulting to
Last 12.

## References

- Original layout: [`../1588-training-breakdown-dashboard/after/01-movement-hard-dark.png`](../1588-training-breakdown-dashboard/after/01-movement-hard-dark.png)
  (90D Movement, hard dark). That evidence used an invented `date` seed, so it hid the defect.
  It is read-only and unchanged here.
- Defect statement and window contract: issue #1597.

## Setup

- Rendered commit: **`41eefa19d91b13d13442586c46834d0c52186997`**. Later commits on this
  branch add only this evidence directory, so the rendering still applies.
- Build (from `mobile/`): `EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key npx expo export --platform web --output-dir <dist>`
- Capture: `WRITE_SEED=seed-notes.json node capture.cjs <dist> after <playwright node_modules dir> <chromium path>`.
  This runs headless Chromium at **390x844, deviceScaleFactor 2**.
- [`capture.cjs`](capture.cjs) is adapted from #1588's driver, which itself is unchanged. It keeps the
  same real-app mounting, mock `mockproj` session, empty Supabase stubs and blocked external hosts, so
  no production data is touched. Its seed is replaced: three **date-free**, real-shaped routine
  notebooks ([`seed-notes.json`](seed-notes.json)) mirror `makeWorkoutNoteItem`, with `id`, `title`,
  `raw_text`, `saved_at`/`updated_at` and null metadata, and **no `date` property**. Each notebook has
  recurring Monday/Wednesday/Friday headings and one logged row per weekly session, with some weeks
  missing a set. Block 1 carries a saved Face Pull → Pull choice. The obsolete
  `training-breakdown-range-30D/90D` selectors are replaced.
- Large text: every text node's computed font size is scaled by **1.3x**, the same method as #1588.

## Layout checklist (before coding)

1. Selector shows three options (Last 4 / Last 12 / All) in the existing segmented container. The
   selected option uses the container fill. Labels are never clipped or truncated.
2. Every option is at least 44x44 CSS px.
3. At 390px the title row may wrap: the selector moves under the title, right-aligned, with no overlap.
4. Hero, tabs, Compared card, Movement groups tiles and footer are unchanged from the #1588 layout, with
   16px gutters, tile gaps and radii as before. There is no horizontal overflow.
5. Large text (1.3x): the selector still fits on one row without clipping. The surrounding wrapping
   matches #1588's large-text behaviour.

## Results

Expected totals were computed independently with `deriveTrainingBreakdownForRange` over
`seed-notes.json` → `deriveParsedSections`. The observed values were read from the rendered
`training-breakdown-completed-sets`.

| Window | Expected sets / timed-cardio / saved-group sets | Observed |
| --- | --- | --- |
| Last 4 | 163 / 8 / 0 | 163 / 8 / (no saved-group footer) |
| Last 12 (default) | 457 / 24 / 0 | 457 / 24 / (no saved-group footer) |
| All | 842 / 36 / 22 | 842 / 36 / ✎ 22 |

The saved Face Pull choice sits in the oldest notebook. It appears only in All because the two
bounded windows retain only newer sessions, and each retained unit resolves against its own note.

| File | Theme | State | Result |
| --- | --- | --- | --- |
| [01-movement-last4-hard-dark](after/01-movement-last4-hard-dark.png) | Hard dark | Last 4 selected, 163 | PASS |
| [02-movement-last12-hard-dark](after/02-movement-last12-hard-dark.png) | Hard dark | default Last 12, 457 | PASS |
| [03-movement-all-hard-dark](after/03-movement-all-hard-dark.png) | Hard dark | All, 842 | PASS |
| [11-movement-last4-hard-light](after/11-movement-last4-hard-light.png) | Hard light | Last 4, 163 | PASS |
| [12-movement-last12-hard-light](after/12-movement-last12-hard-light.png) | Hard light | Last 12, 457 | PASS |
| [13-movement-all-hard-light](after/13-movement-all-hard-light.png) | Hard light | All, 842 | PASS |
| [21-large-text-selector-last12](after/21-large-text-selector-last12.png) | Hard dark, 1.3x | Last 12 | PASS |
| [22-large-text-selector-last4](after/22-large-text-selector-last4.png) | Hard dark, 1.3x | Last 4 | PASS |
| [30-info-methodology](after/30-info-methodology.png) | Hard dark | Methodology sheet | PASS |

Per-capture probe results: `overflowX: false` everywhere, and no `training-breakdown-*` control is
under 44x44 (14 to 16 checked per capture). Selector options measured 58–60 / 66–68 / 44 px wide
at 1x and 71–73 / 81–83 / 44 px at 1.3x, all 44 px tall, with no clipped labels.

## Comparison with #1588

- The selector now sits on its own right-aligned row under the title. "Last 12" is wider than "90D",
  so the existing `flexWrap` title row wraps cleanly; nothing overlaps or is clipped (checklist 1–3).
- The hero, tabs, Compared card and Movement groups grid keep the same structure, spacing and theme
  tokens. Only the numbers change, and they differ in each window (checklist 4).
- At 1.3x the selector stays on one row. The tabs wrap Equipment to a second line, as in #1588's
  large-text captures (checklist 5).
- The methodology sheet states that Kilo records sessions, not per-session dates, and gives the
  per-exercise rule. The old calendar and missing-date copy is gone.

Verdict: **PASS**. Every window shows a different nonempty total from date-free real-shaped data.
