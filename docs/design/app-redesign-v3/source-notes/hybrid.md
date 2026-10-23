# Kilo final hybrid: design for review

**Design only.** No production code was changed, and no issue, PR or Codex work has started. The prototype is `hybrid/index.html`; open it at a window ≥720px wide to see the state rail. The screenshots are in `../shots/hybrid/` (85 files, 390×844 @2x) and are regenerated with `node ../capture-hybrid.cjs`.

The prototype uses the shared fixture, the KUA court palettes and the fonts from `../shared/`. It adds no tokens. Concept A and Concept B files are untouched.

## Screenshot index

| What | Files |
|---|---|
| Every tab, both themes | `{home,log,weight,analytics,more}-{hard-dark,clay-light}.png` |
| Full length (Log, Analytics and the rest) | `full-<tab>-{hard-dark,clay-light}.png`, `full-analytics-recovery-hard-dark.png` |
| Other courts | `{home,log,analytics}-{grass-light,grass-dark,hard-light,clay-dark}.png` |
| Log | `state-log-history-expanded`, `-history-sheet`, `-actions-sheet`, `-plates-sheet`, `-editor`, `-editor-timer`, `-tuesday`, `-deload`, `-recovery` |
| Rest timer outside the editor | `state-home-timer-running` |
| Weight | `state-weight-chart-point`, `-30d-avg`, `-goal`, `-goal-edit`, `-history` |
| Analytics | `state-analytics-strength-plates`, `-breakdown`, `-breakdown-sheet`, `-health`, `-overload`, `-overload-rows`, `-overload-sheet`, `-recovery`, `-recovery-baseline-open` |
| Home in Recovery | `state-home-recovery` |
| Settings | `state-more-settings` |

Every state is captured in both `-hard-dark` and `-clay-light`.

## Adopted from A (Ledger): the structure

- **Panels:** flat panels with hairline rows. Only the active card (routine, Recovery) gets the 2px primary border.
- **Navigation:** a docked tab bar, and no back chevrons on root tabs.
- **Log:** stays note-first in one style-locked routine card:
  - the last three sessions are shown inline, with "N earlier sessions" expanding in place;
  - a sticky day index;
  - a double-tap or a tap on a set line opens the editor;
  - the suggestion card sits in context.
- **Weight:** the quick weigh-in stays inline (weight · date · Save, plus "Add note"). History is a column table (Weight / Change / Date / delete) with a date filter and "Show more".
- **Analytics:** one continuous scroll with a slim sticky section index (44px, one line).
- **More:** grouped rows (Preferences / Account & data / Tools & help) with no dashboard elements.
- **Settings:** grouped panels.
- **Editor rest timer:** a compact control docked in the editor toolbar.

## Adopted from B (Center Court): the hierarchy and visuals

- **Home hero:** a progress ring with legend (5 Progressing · 4 Steady · 0 Regressing) and a clear split between primary and supporting content: one active hero, then quieter 1K and Body weight cards.
- **Metric scale:** large mono metrics with one hero number per screen (44px), and 28px card metrics.
- **Bottom sheets:** one sheet component app-wide:
  - per-exercise history (Log);
  - exercise detail (Overload);
  - routine actions;
  - plate calculator;
  - Training breakdown drill-down;
  - info explainers.
- **Weight chart:** a prominent trend chart as the Weight hero, with a goal line, a tappable point callout and a clearer goal progress bar.
- **Progressive Overload:**
  - a trend pill under each name instead of a bare arrow;
  - compact filter chips (All / Progressing / Steady / Regressing);
  - stronger group headers.
- **Rest timer:** the anchored preset panel (0:30–3:00, Cancel timer / Dismiss) plus the app-shell pill on other tabs.

## Readability changes (the brief said Ledger was too small in places)

- **Type floor:** nothing smaller than 12px except the 11px tab-bar labels and chart axes, which match the production tab bar.
- **Body text:** 15px.
- **Row and exercise titles:** 16px.
- **Section titles:** 20px.
- **Overload rows:**
  - the name and pill sit on the first line;
  - 1RM / Kilo / Best follow in 17px right-aligned mono columns that line up with the header;
  - rows are 60px or taller.

## Functionality preserved and where it lives

| Capability | Location in the hybrid |
|---|---|
| Workout logging and editing | Log card: tap a set line or double-tap to edit. The editor holds Save, Import routine, Insert example note, Merge Week A and Week B, Revert this edit, Delete routine and Syntax help. Done saves. |
| Exercise history | Last 3 inline, "N earlier" expands, and the history icon opens the full sheet |
| Routine management | Header `⋯` sheet: Edit, Skip week, Remove skip, Plate calculator, Copy, Share, Share as Image. More routines: New routine, plus per-routine View, Set as current, Copy, Share, Share as Image, Delete. |
| Plates | Header **Plates** button (approved exception), the editor toolbar, the actions sheet, and Analytics lift values |
| Rest timers | Editor toolbar control, anchored panel, and the app-shell pill on every tab |
| Week A/B | Toggle in the routine card |
| Deload | Log `Deload` tab: Confirm deload complete (session #), Regenerate, Delete active deload |
| Weight and goals | Inline entry, chart, goal panel (Target, Target date, pace, deficit, On Track, Edit / Archive / Clear, goal form), history (filter, delete, show more), Goal history, "See full trends" |
| Progressive Overload | Summary, filter chips, search, Collapse all, per-group collapse, suggestion, both explainers, rows, detail sheet with "View in Log" |
| 1K Progress | Home card (no graph); Analytics Strength: total, info "What is 1K Progress?", lift values open plate loading, the existing session chart (see below), Big 3 mapping |
| Training breakdown | `P.breakdown` renders unchanged: Movement / Muscles / Equipment, Last 4 / 12 / All, tile drill-down sheet |
| Routine Health | Since-deload gauge and zones, Total, the Fatigue check-in strip |
| Recovery | Home: the Recovery card replaces the hero and 1K is hidden. Log: Recovery tab with Complete week, Add next week, Movement groups, Rebuild baseline and End block. Analytics: Recovery → Weight → collapsed "Baseline training · paused". Recovery history row. |
| Analytics order | Normal: Strength → Training breakdown → Routine Health → Progressive Overload → Weight Trends → Recovery history, unchanged from `AnalyticsLayout.js`. Active Recovery: Recovery → Weight → Baseline (Strength, TB, PO, Health). |
| Settings | Production order and labels: Features → Reminders (with times) → Appearance → Units → Fatigue multiplier with "Reset to default (1.07)" |
| Accessibility | 44dp targets (the Track toggle stays the existing exception), labelled icon buttons, `aria-expanded` on disclosures, a ring and bars with text equivalents, `role=switch` / `radio` / `tab` |

## Implementation dependencies (new behaviour, data or architecture)

1. **Plates and routine actions in the Log header.** These are the approved exception. They move out of `LogActiveRoutineCard`'s header into the screen header and keep the same Modal sheet and labels. The routine-card header keeps title collapse and Week A/B.
2. **Per-exercise history sheet in Log.** This is new UI with no new data. It reads the exercise's set lines from the note. The "top-set load by session" line is a **UI derivation** (load of each logged session, x = session index, no dates). It needs a tap target on the exercise name row and a new sheet component.
3. **Overload filter chips.** These are new UI state that filters existing rows by the existing status. They need no new calculation.
4. **Overload row → detail sheet.** Production rows don't expand. The sheet reuses the existing 1RM / Kilo / Best values plus derivation 2.
5. **Goal progress bar** ("START 192.4 · 49% · TARGET 183"). This is a **new derived value**: production shows only "to go" and On Track. It needs a goal start weight. If one isn't stored with the goal, it must be defined (for example, the first weigh-in on or after goal creation), and that is a data-model decision. Drop the bar if that isn't wanted; the panel works without it.
6. **Weight chart over all weigh-ins.** Each point is plotted at its recorded date, and the line is the existing 7D/30D rolling average, so the toggle keeps production semantics. The range shown is the full history. Both earlier concepts invented a 30D/90D/All range control; it is not used here. A long history may need decimation or a horizontal scroll, which is an architecture note for `LineChart`.
7. **Home ring.** This is presentational only, using the existing Exercise Progress counts.
8. **Home 1K stacked bar.** This is presentational only (existing totals), with no graph, as #1458 requires.
9. **Home weight sparkline.** It changes colour from primary to the neutral teal series `--s1`, following the data-series rule. That is a styling change.
10. **Docked tab bar.** It replaces the production floating pill tab bar (the navigation component changes, but the destinations stay the same).
11. **Slim sticky section index on Analytics.** This is new: a sticky header inside the scroll plus anchor scrolling. Deep links still land on section anchors.
12. **Root headers.** These change to a title plus a mono context line.

## 1K: a chart already exists in production

The brief said not to introduce a combined session-based 1K chart. Production **already renders one**: `AnalyticsStrengthSection.js` shows "1K total over sessions" whenever there are 2 or more points. It totals the most recent complete Big 3 cycle and marks deload sessions.

The hybrid keeps that chart as an unchanged disclosure ("1K total by session · existing chart"). It is deliberately **not re-plotted**: the placeholder says the production chart renders there unchanged, so the prototype doesn't invent synchronized session values. Please confirm the existing chart should stay. If it should not, removing it from production is a separate decision.

## Routine Health "TOTAL 10": recorded separately, not fixed

The earlier baseline capture showed Routine Health as just "TOTAL 10", with no gauge.

In `components/ui/workout.js`, `SessionGauge` renders "Since deload" and the zones meter only when deload mode is enabled; "Total" always renders. The baseline fixture never set `kilo_deload_mode_enabled` (`DELOAD_MODE_KEY`). So "TOTAL 10" is most likely the designed deload-off state, not a defect.

**This is unverified.** The hybrid shows the deload-on gauge (its settings show Deload mode on) and changes nothing in production. If the deload-off state should say more than "Total", that is a separate design question.

## Existing functionality not represented (still reachable in production, not drawn)

- First-use states: RoutineAdoptionPrompt, the "Start logging this routine" card, empty Log/Overload/Weight states ("Go to Log", "Weigh in on two different days…", `No matches for "…"`).
- PRMomentBanner and SessionCheckInModal.
- Editor problem list, "Set as current routine", "Clear draft", and deload date / session-number editing inside the editor.
- Cross-day comparison ("Also on …"): the fixture has no exercise logged on two days.
- Recovery detail:
  - Start-recovery confirm;
  - Reopen week / Undo completion / Reopen block;
  - Tidy names / Match exercise names / Unlink;
  - inclusion toggles;
  - RecoveryManagementScreen;
  - "Retry recovery" and the fallback messages.
- Weigh-in edit form (tapping a history row edits it in production; here the row is only a target), and the From/To pickers themselves.
- Home "Review goal" attention state and "Goal ended".
- Profile, Account, Data and backup, App Guide, About, Routine prompt tools and Import routine sub-screens: rows are present, screens are not redrawn.
- Deload tab content is illustrative: loads are not the production generator's output.
- System theme mode.
