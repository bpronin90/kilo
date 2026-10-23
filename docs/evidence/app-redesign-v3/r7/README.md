# R7 (#1606) visual evidence: Log

These screenshots come from the real app: an Expo web export driven by the
shared harness (`../capture.cjs`, `../fixtures.cjs`, both unchanged) with
issue-local overlays (`fixtures.cjs`).

- **Rendered commit:** `11675b9814e1867ac4f45110da9f31f595fc958b` for every
  state except Recovery. `log-recovery-*` was re-rendered at
  `cbdcae5ba999ada59fc47869c3b7cdeeea285247`, the commit that keeps the Recovery
  state zone on `surfaceSection`. That commit changes no other screen. Later
  commits touch only this README.
- **Viewport:** 390×844 CSS px at 2x, UTC, clock fixed at `2026-10-23T12:00Z`.
- **Themes:**
  - Every state in hard-dark and clay-light.
  - The first screen also in grass-light and clay-dark.

## Reproduce

```sh
cd mobile
EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key \
  npx expo export --platform web --output-dir <dist>
cd ..
node docs/evidence/app-redesign-v3/r7/capture.cjs <dist> <dir containing playwright> [workDir]
```

The run reported 32 states and 0 failures. Every state passed the theme canvas
check.

## References

These are in `docs/design/app-redesign-v3/shots/hybrid/`:

- `log-hard-dark.png`
- `log-clay-light.png`
- `state-log-tuesday-hard-dark.png`
- `state-log-history-expanded-hard-dark.png`
- `state-log-actions-sheet-hard-dark.png`
- `state-log-plates-sheet-hard-dark.png`
- `state-log-deload-hard-dark.png`
- `state-log-recovery-hard-dark.png`

The production "before" is `../r1/after/first-log-hard-dark.png`, the old
"Workout Notes" card.

## States

All files are in [`after/`](after/). The fixture for each state:

- **populated:** the shared scenario.
- **`deloadOn`:** sets Settings › Deload mode. Production shows the
  Routine/Deload control only with this setting on.
- **`edgeRows`:** an R7 overlay that replaces the current routine's text.

| File | State | Fixture | Result |
|---|---|---|---|
| `log-first-*` (4 themes) | First screen: `Log` header with Plates and ⋯; Routine/Deload; routine panel; day index; Monday with 3 inline sessions, latest LAST; `7 earlier sessions` | populated + `deloadOn` | Pass. Matches `log-*` references except the deviations below. |
| `log-first-deload-off-*` | Default settings: no segmented control (production gating) | populated | Pass |
| `log-routine-ab-*` | Week A/B radio group in the panel's meta row | `routine-ab` | Pass |
| `log-day-tuesday-*` | Tue chip tapped: scrolled to Tuesday; the index is pinned under the header with Tue active | populated | Pass. Matches `state-log-tuesday`. |
| `log-history-expanded-*` | Bench Press expanded in place: all 10 sessions in note order, `Show last 3` | populated | Pass. Matches `state-log-history-expanded`. |
| `log-actions-sheet-*` | Header ⋯ sheet: Edit, Skip week, Plate calculator, Copy, Share, Share as Image | populated | Pass. Matches `state-log-actions-sheet`. |
| `log-plates-*` | Header Plates button opens the existing plate calculator | populated | Pass. Production modal, not the reference's sheet. |
| `log-editor-open-*` | Edit routine opens the existing editor (not restyled) | populated | Pass |
| `log-more-routines-*` | End of the Log: Recovery entry, More Routines · 2, New routine | populated | Pass |
| `log-deload-*` | Generate deload, then the active panel: `Active deload` kicker, day heading, bold lines, no LAST/Track | populated + `deloadOn` | Pass. Matches `state-log-deload`. |
| `log-recovery-*` | Recovery tab: active block with a primary border; existing kicker, week table and actions | `recovery-active` | Pass. See the deviations. |
| `log-edge-rows*-*` | Skipped session (`—`), kg-converted load, BW, two parse warnings shown in full (never folded), block label, second day | populated + `edgeRows` | Pass |
| `log-empty-*` | Empty account: `Log` header without routine actions; first-routine card | `empty` | Pass |

## Deviations (deliberate)

- **No "Week N" on the routine panel.** Production has no week-number concept,
  so the identity line keeps `Current routine` / `Baseline routine · paused`.
- **Deferred to R8 (#1607):** the history icon and history sheet, the editor
  timer, and the app-shell timer pill.
- **Progression suggestions** stay below the routine content, not inline under
  each exercise.
- **Recovery copy is unchanged.** The panel keeps production's kicker
  (`CURRENT TRAINING` / `RECOVERY BLOCK`), headline, week table and action
  zone, including the zone's `surfaceSection` fill (pinned by `theme-rendering`).
  Only the panel border and the kicker/headline type were restyled.
- **Plates** opens the existing centred `PlateCalculatorModal`, not a new sheet.
- **`← Home` web back bar.** It sits above the header in web captures and
  comes from R1's shell, not from this change.
- **Plank rows in `edgeRows`.** The `-Plank 3×45s` header does not declare a
  duration under production grammar, so its rows render as BW reps. This is
  identical to the default renderer. Timed (`Ns`) formatting reuses the
  `SetLine` mapping; this fixture does not exercise it.
