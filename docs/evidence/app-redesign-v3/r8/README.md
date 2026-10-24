# R8 (#1607) visual evidence — Log history sheet and rest-timer surfaces

- **Rendered commits:** `history-*` and `log-first-*` at `eaa4bf492bd954963af27563e6b4c02e3c84eb21` (chart point selection); timer/pill states at `795f739a6d5e20da854a19965ace2a84bd60535f` — the later commits touch only `ExerciseHistorySheet.js` (selection, scrim token that was never rendered), which is not mounted on any timer screen. Real app Expo web export, not prototype HTML.
- **Viewport:** 390×844 @2x via the shared harness (`../capture.cjs`, read-only); issue-local overlays in `fixtures.cjs`.
- **Themes:** every state in hard-dark and clay-light; Log first screen and Home pill (first affected screens) also in grass-light and clay-dark.
- **References:** `docs/design/app-redesign-v3/shots/hybrid/` state-log-history-sheet, state-log-editor, state-log-editor-timer, state-home-timer-running (hard-dark).

## Layout checklist (from the references)

1. History icon: 44dp labelled button between the exercise name and Tracked; Tracked/earlier/LAST rows unchanged.
2. Sheet: bottom sheet with handle; 20/26 title + "day · block · N sessions" subtitle (no dates); 44dp close at right.
3. Chart: a callout ("Latest · 225 lb" / "Session N · X lb") above the line; each point a labelled 44dp target that selects it (marker enlarged + vertical guide); "TOP-SET LOAD (UNIT) · BY SESSION" kicker; line with min/max gridlines and right-hand labels; "SESSION 1 … LATEST" axis; latest point larger.
4. Table: tinted "# / SESSION" header; rows newest-first, 44dp min, index centred on the set line, latest logged row bold with LAST, older muted.
5. Timer panel: big countdown + "of m:ss rest", progress track, five equal 0:30–3:00 presets (running length selected), Cancel timer + Dismiss side by side; done = Rest over + Dismiss.
6. Pill: centred, primary 1.5px outline, timer icon, 18px tabular countdown, uppercase action; sits above the tab bar.
7. Unchanged: day index, fold, Track, editor actions, danger zone, tab bar.

**Deviation (documented):** the docked control stays in the editor header's top-right action slot (production's existing editor toolbar) rather than a new in-card toolbar row; moving it would need product files outside Allowed Files (editor card is at the 600-line cap). Placement, docking/handoff and modal behaviour are unchanged.

## Reproduction

```sh
cd mobile && EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key   npx expo export --platform web --output-dir /tmp/kilo-1607-dist-795f
cd .. && KILO_RENDERED_COMMIT=795f739a6d5e20da854a19965ace2a84bd60535f   node docs/evidence/app-redesign-v3/r8/capture.cjs /tmp/kilo-1607-dist-795f /tmp/kilo-review-tools/node_modules
```

The runs (full matrix at 795f739; `history,log-first` rerun at eaa4bf4 with the same command, `only` = `history,log-first`) captured all 48 states without a step failure (manifest written to the work dir). Later commits on this branch change only docs/evidence/changelog, so the renders still apply.

## Degradation and preserved capabilities

- BW-only / timed-only exercises: chart replaced by a text fallback; sessions still listed (`history-bw-only`, `history-timed`).
- Unparsed and skipped rows stay verbatim in the list and are never charted (`history-unparsed`, `history-repeated-accessories`).
- Selection: latest point selected by default (`history-sheet`); tapping session 1 moves the callout and marker (`history-point-earlier`).
- Repeated names: Monday, Thursday-Strength and Thursday-Accessories Bench Press each open only their own sessions with distinct context (`history-sheet`, `history-repeated-*`); A/B routine names the week (`history-ab-week`).
- Timer: idle/presets/running/cancelled/done in the editor; scrolled-off editor hands the countdown to the pill (`editor-scrolled-pill`); running pill on Home, Log read view, Weight, Analytics, More; completion pill with Dismiss; inset-device panel (`editor-safe-area`). The web build has no software keyboard; keyboard placement is unchanged code (pill clearance logic untouched).
- Background alert unavailable flag remains on the control, panel and pill.

## States

| After | Reference | Result |
|---|---|---|
| [editor-presets-idle-clay-light](after/editor-presets-idle-clay-light.png) | [state-log-editor-timer-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-timer-hard-dark.png) | Pass |
| [editor-presets-idle-hard-dark](after/editor-presets-idle-hard-dark.png) | [state-log-editor-timer-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-timer-hard-dark.png) | Pass |
| [editor-presets-running-clay-light](after/editor-presets-running-clay-light.png) | [state-log-editor-timer-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-timer-hard-dark.png) | Pass |
| [editor-presets-running-hard-dark](after/editor-presets-running-hard-dark.png) | [state-log-editor-timer-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-timer-hard-dark.png) | Pass |
| [editor-safe-area-clay-light](after/editor-safe-area-clay-light.png) | [state-log-editor-timer-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-timer-hard-dark.png) | Pass |
| [editor-safe-area-hard-dark](after/editor-safe-area-hard-dark.png) | [state-log-editor-timer-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-timer-hard-dark.png) | Pass |
| [editor-scrolled-pill-clay-light](after/editor-scrolled-pill-clay-light.png) | [state-log-editor-timer-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-timer-hard-dark.png) | Pass |
| [editor-scrolled-pill-hard-dark](after/editor-scrolled-pill-hard-dark.png) | [state-log-editor-timer-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-timer-hard-dark.png) | Pass |
| [editor-timer-cancelled-clay-light](after/editor-timer-cancelled-clay-light.png) | [state-log-editor-timer-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-timer-hard-dark.png) | Pass |
| [editor-timer-cancelled-hard-dark](after/editor-timer-cancelled-hard-dark.png) | [state-log-editor-timer-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-timer-hard-dark.png) | Pass |
| [editor-timer-done-clay-light](after/editor-timer-done-clay-light.png) | [state-log-editor-timer-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-timer-hard-dark.png) | Pass |
| [editor-timer-done-hard-dark](after/editor-timer-done-hard-dark.png) | [state-log-editor-timer-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-timer-hard-dark.png) | Pass |
| [editor-toolbar-idle-clay-light](after/editor-toolbar-idle-clay-light.png) | [state-log-editor-timer-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-timer-hard-dark.png) | Pass |
| [editor-toolbar-idle-hard-dark](after/editor-toolbar-idle-hard-dark.png) | [state-log-editor-timer-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-timer-hard-dark.png) | Pass |
| [history-ab-week-clay-light](after/history-ab-week-clay-light.png) | [state-log-history-sheet-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-history-sheet-hard-dark.png) | Pass |
| [history-ab-week-hard-dark](after/history-ab-week-hard-dark.png) | [state-log-history-sheet-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-history-sheet-hard-dark.png) | Pass |
| [history-bw-only-clay-light](after/history-bw-only-clay-light.png) | [state-log-history-sheet-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-history-sheet-hard-dark.png) | Pass |
| [history-bw-only-hard-dark](after/history-bw-only-hard-dark.png) | [state-log-history-sheet-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-history-sheet-hard-dark.png) | Pass |
| [history-point-earlier-clay-light](after/history-point-earlier-clay-light.png) | [state-log-history-sheet-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-history-sheet-hard-dark.png) | Pass |
| [history-point-earlier-hard-dark](after/history-point-earlier-hard-dark.png) | [state-log-history-sheet-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-history-sheet-hard-dark.png) | Pass |
| [history-repeated-accessories-clay-light](after/history-repeated-accessories-clay-light.png) | [state-log-history-sheet-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-history-sheet-hard-dark.png) | Pass |
| [history-repeated-accessories-hard-dark](after/history-repeated-accessories-hard-dark.png) | [state-log-history-sheet-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-history-sheet-hard-dark.png) | Pass |
| [history-repeated-thursday-clay-light](after/history-repeated-thursday-clay-light.png) | [state-log-history-sheet-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-history-sheet-hard-dark.png) | Pass |
| [history-repeated-thursday-hard-dark](after/history-repeated-thursday-hard-dark.png) | [state-log-history-sheet-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-history-sheet-hard-dark.png) | Pass |
| [history-sheet-clay-light](after/history-sheet-clay-light.png) | [state-log-history-sheet-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-history-sheet-hard-dark.png) | Pass |
| [history-sheet-hard-dark](after/history-sheet-hard-dark.png) | [state-log-history-sheet-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-history-sheet-hard-dark.png) | Pass |
| [history-timed-clay-light](after/history-timed-clay-light.png) | [state-log-history-sheet-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-history-sheet-hard-dark.png) | Pass |
| [history-timed-hard-dark](after/history-timed-hard-dark.png) | [state-log-history-sheet-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-history-sheet-hard-dark.png) | Pass |
| [history-unparsed-clay-light](after/history-unparsed-clay-light.png) | [state-log-history-sheet-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-history-sheet-hard-dark.png) | Pass |
| [history-unparsed-hard-dark](after/history-unparsed-hard-dark.png) | [state-log-history-sheet-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-history-sheet-hard-dark.png) | Pass |
| [home-timer-pill-clay-dark](after/home-timer-pill-clay-dark.png) | [state-home-timer-running-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-home-timer-running-hard-dark.png) | Pass |
| [home-timer-pill-clay-light](after/home-timer-pill-clay-light.png) | [state-home-timer-running-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-home-timer-running-hard-dark.png) | Pass |
| [home-timer-pill-grass-light](after/home-timer-pill-grass-light.png) | [state-home-timer-running-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-home-timer-running-hard-dark.png) | Pass |
| [home-timer-pill-hard-dark](after/home-timer-pill-hard-dark.png) | [state-home-timer-running-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-home-timer-running-hard-dark.png) | Pass |
| [log-first-clay-dark](after/log-first-clay-dark.png) | [state-log-editor-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-hard-dark.png) | Pass |
| [log-first-clay-light](after/log-first-clay-light.png) | [state-log-editor-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-hard-dark.png) | Pass |
| [log-first-grass-light](after/log-first-grass-light.png) | [state-log-editor-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-hard-dark.png) | Pass |
| [log-first-hard-dark](after/log-first-hard-dark.png) | [state-log-editor-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-log-editor-hard-dark.png) | Pass |
| [pill-analytics-clay-light](after/pill-analytics-clay-light.png) | [state-home-timer-running-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-home-timer-running-hard-dark.png) | Pass |
| [pill-analytics-hard-dark](after/pill-analytics-hard-dark.png) | [state-home-timer-running-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-home-timer-running-hard-dark.png) | Pass |
| [pill-done-home-clay-light](after/pill-done-home-clay-light.png) | [state-home-timer-running-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-home-timer-running-hard-dark.png) | Pass |
| [pill-done-home-hard-dark](after/pill-done-home-hard-dark.png) | [state-home-timer-running-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-home-timer-running-hard-dark.png) | Pass |
| [pill-log-clay-light](after/pill-log-clay-light.png) | [state-home-timer-running-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-home-timer-running-hard-dark.png) | Pass |
| [pill-log-hard-dark](after/pill-log-hard-dark.png) | [state-home-timer-running-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-home-timer-running-hard-dark.png) | Pass |
| [pill-more-clay-light](after/pill-more-clay-light.png) | [state-home-timer-running-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-home-timer-running-hard-dark.png) | Pass |
| [pill-more-hard-dark](after/pill-more-hard-dark.png) | [state-home-timer-running-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-home-timer-running-hard-dark.png) | Pass |
| [pill-weight-clay-light](after/pill-weight-clay-light.png) | [state-home-timer-running-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-home-timer-running-hard-dark.png) | Pass |
| [pill-weight-hard-dark](after/pill-weight-hard-dark.png) | [state-home-timer-running-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-home-timer-running-hard-dark.png) | Pass |
