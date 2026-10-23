# Kilo app-wide redesign (hybrid-v3): implementation spec

Status: **visually approved by the product owner.** It is the design source for the redesign implementation issues. It does not authorize new behaviour, new calculations or parser changes.

## Sources of truth, in precedence order

1. **Existing production behaviour, calculations, parsing and persistence.** These are authoritative wherever the prototype only illustrates them. The prototype's fixture numbers are illustrative.
2. **Kilo theme tokens and court palettes** (`mobile/theme/*`, the KUA package in `docs/design/kinetic-utilitarian-athletic/`). These are authoritative for colour, type and geometry. The prototype's `shared/tokens.css` mirrors them; if they differ, production tokens win.
3. **The approved prototype and screenshots:**
   - **Weight and Analytics:** `hybrid-v3/` is the approved design. Its screenshots are in `shots/hybrid-v3/`, and in `shots/hybrid-v2/` for the Analytics chapters and navigation.
   - **Home, Log and More:** unchanged since the first hybrid. Their screenshots are `shots/hybrid/{home,log,more}-*` and `shots/hybrid/state-{home,log,more}-*`.
   - **Write-ups:** `hybrid/README.md` (structure, functionality map), `hybrid-v2/README.md` (chapters), `hybrid-v3/README.md` (Weight averages, Latest weigh-in).
4. **Baseline (current production renders):** `baseline/shots/`. The harness that captures the real app with the same fixture is `baseline/capture-baseline.cjs`.

The first implementation issue copies the reference set into the repo under `docs/design/app-redesign-v3/`, so reviewers have tracked evidence. From then on, that copy is the reference.

## Global non-negotiables

- **UI redesign only.** Do not modify:
  - workout note parsing, grammar or supported syntax (`mobile/lib/parser/**`);
  - exercise recognition, matching or normalization;
  - set, rep, load or prescription semantics;
  - calculations in `mobile/lib/data/**` (1K, Big 3, progression, Training Breakdown, recovery, weight analytics, goal math);
  - persistence or storage formats.

  If a visual element needs any of these, stop and report the dependency.
- **No capability is removed.** Every action, sheet, setting and state that production reaches today must stay reachable, even if the prototype does not draw it. The list of undrawn states is in `hybrid/README.md`, "Existing functionality not represented".
- **Out of scope:** the Training Breakdown movement-classification (35%) issue. Training Breakdown internals stay unchanged.
- **The 600-line production file cap applies** (`npm run check:app-lines`). `AnalyticsScreen.js` (598), `LogScreen.js` (599) and other files are at the cap, so extract components rather than grow them.
- **Accessibility:**
  - touch targets are 44dp or larger;
  - icon buttons are labelled;
  - disclosures expose their expanded state;
  - charts and rings carry text equivalents;
  - segmented controls use radio or tab roles.
- **Visual verification** (AGENTS.md Visual acceptance gate):
  - render the real app (Expo web export plus the capture harness) at 390×844 @2x;
  - compare against the reference;
  - cover hard-dark and clay-light for every state, plus grass-light and clay-dark for each tab's first screen.

## Global shell (all tabs)

- **Tab bar: docked, not floating.**
  - Full width at the bottom, with a top hairline (`border`) and the card background.
  - Five tabs: Home, Log, Weight, Analytics, More. Each has an icon over an 11px uppercase mono label.
  - The active tab uses the primary tint plus a 2–3px indicator bar on the top edge.
  - Hide-on-scroll (#1209), the safe-area offset and wide-window column alignment keep their current behaviour.
- **Root header:**
  - Title at 28px/700 in the display font, with an optional mono context line underneath (for example "Upper / Lower — Block 3 · Week 9" on Analytics, or "43 weigh-ins · Cutting → 183 lb" on Weight).
  - A hairline sits under the header.
  - Optional right-side actions.
  - Home keeps the wordmark and the sync icon.
  - Root tabs have no back chevron.
- **Panels:**
  - Flat panels (card background, 1px border, large radius) with hairline-separated rows.
  - Only the single "active" panel per screen gets the 2px primary border: the routine card, the weigh-in entry, or the active Recovery card.
  - No cards nested inside cards.
- **Type scale:**
  - Nothing smaller than 12px except tab labels and chart axes (11px).
  - Body text 15px; row titles 16px; section titles 17–20px.
  - Mono labels are uppercase with letter-spacing.
  - One 44px mono hero number per screen; 28px for card metrics.
- **Data-series colours** follow the existing series tokens. A weight series uses the neutral teal series token, not primary.
- **Change indicators:** an arrow plus a signed value, toned by production's `weightTrendTone` (goal-aware: toward the goal positive, away negative, zero neutral).

## Home (reference: `shots/hybrid/home-*`, `state-home-recovery-*`, `state-home-timer-running-*`)

- **Hero panel** (active border):
  - "Current routine · Week N" label and the routine title.
  - Exercise-progress ring with a legend: Progressing / Steady / Regressing counts. These are the existing Exercise Progress counts; the ring is presentational.
  - Chevron to Analytics Progress.
  - Primary "+ Log workout" and secondary "Log weight" buttons.
- **1K Progress card:**
  - Total / 1,000 lb with "N lb to 1,000".
  - Stacked bar of existing per-lift values, plus a Squat / Bench / Deadlift split.
  - No graph (#1458).
  - The title chevron opens Analytics Progress.
- **Body weight card:**
  - Latest weight, then goal context ("Cutting · 183 lb · 10 weeks left") **only when a goal is active**.
  - Compact sparkline (the existing series) with an optional goal line.
  - **Tapping the sparkline or the card opens Analytics › Bodyweight** through the existing section deep-link mechanism (`navigateToSection`). The "Body weight ›" title can still open the Weight tab.
- **Active Recovery:** the Recovery card replaces the hero and 1K is hidden, as production does today (`HomeRecoverySummary`).
- **App-shell rest-timer pill:** visible on every tab while a timer runs (`state-home-timer-running`).
- **Empty states:** keep production's first-use and attention states ("Review goal", "Goal ended", adoption prompts), restyled into the panel system.

## Log (reference: `shots/hybrid/log-*`, `state-log-*`) — highest regression risk

- **Header:**
  - "Log" title, plus a **Plates** button and a `⋯` actions button (approved exception).
  - These move out of `LogActiveRoutineCard`'s header and open the **same** Plate calculator modal and routine-actions sheet with the same labels and actions: Edit, Skip week, Remove skip, Plate calculator, Copy, Share, Share as Image, and the More-routines entries.
- **Routine / Deload segmented control.** The Recovery tab appears during Recovery, as now.
- **Single routine card** (active border):
  - Title, "Week N · Current", and the Week A/B toggle.
  - A sticky day index (Mon Upper / Tue Lower / …).
  - Per-day blocks with the day heading, exercise count and block labels (Strength / Accessories).
- **Per exercise:**
  - Name, a history icon button, and the Tracked toggle (the existing control and semantics).
  - The **last three sessions inline**: older rows muted, the latest row bold and tagged "LAST".
  - "N earlier sessions" expands the rest in place.
- **History icon → per-exercise history sheet.** This is a new bottom sheet that reads only the set lines already parsed for that exercise; it introduces no new data. The "top-set load by session" line is a presentation derivation over existing parsed values. If it needs anything beyond them, stop.
- **Editing:** tapping a set line or double-tapping the card opens the existing editor (`LogScreenEditorCard`) with every current action intact: Save, Import routine, Insert example note, Merge Week A and Week B, Revert this edit, Delete routine, Syntax help, problem list, Set as current, Clear draft, and deload date/session editing.
- **Editor toolbar rest timer:**
  - A compact control docked in the editor toolbar.
  - It opens the anchored preset panel (0:30–3:00, Cancel timer / Dismiss).
  - The existing `RestTimerBanner` timing logic is unchanged.
- **Deload and Recovery tabs:** keep every action (Confirm deload complete, Regenerate, Delete active deload; Complete week, Add next week, Movement groups, Rebuild baseline, End block, and so on), restyled only.
- **Parser regression suites must pass unchanged.**

## Weight (reference: `shots/hybrid-v3/weight-*`, `full-weight-*`, `compare-weight`, `compare-crops`)

The order, top to bottom:

1. **Log weigh-in panel** (active border): weight input, date button ("Today"), Save, and "+ Add note". This is the existing `WeightEntryForm` behaviour.
2. **Latest panel:**
   - "LATEST · <date>", with the weight as the 44px hero and "<arrow> <signed change> vs previous" underneath.
   - On the right, behind a hairline divider: **7-DAY AVG** and **30-DAY AVG**, each a 17px mono value plus a toned change. These are the existing rolling values from production's weight analytics; there are no new calculations.
   - A row at the bottom: "Full trend in Analytics ›", which deep-links to Analytics › Bodyweight.
3. **Goal panel:**
   - **With an active goal:**
     - mode label (CUTTING / BULKING / …) and the On Track status (existing);
     - "N lb to go · N weeks left";
     - a progress bar **only when a `start_weight` is stored**; never invent one;
     - a split of Target, Target date, Target pace and Suggested deficit (existing values);
     - Edit / Archive / Clear, plus the inline goal form (existing `useWeightGoalForm` lifecycle).
   - **With no goal:** a compact panel with a "Set a goal" action that opens the existing goal form. Goal progress, pace and deficit are not shown.
   - **Ended or review-needed goals:** keep production's states.
4. **History panel:**
   - "HISTORY · N" with the date-range filter button (From/To pickers).
   - Column table: Weight / Change / Date / delete.
   - "Show more weight entries".
   - Tapping a row edits it (existing).
5. **Goal history disclosure** (existing `GoalHistoryPanel` content).

- **No trend chart on Weight.** `WeightTrendSection` is no longer rendered here; its capabilities live in Analytics › Bodyweight.
- **Empty and one-entry states:** keep production's copy ("Weigh in on two different days…"), restyled.

## Analytics (reference: `shots/hybrid-v2/*` for chapters and navigation; `shots/hybrid-v3/analytics-*` and `compare-bodyweight*` for Bodyweight)

- **One continuous scroll** with a **sticky chapter index** directly under the header:
  - four equal-width items: PROGRESS / TRAINING / BODYWEIGHT / RECOVERY;
  - the active item gets an underline and `aria-current`.
- **Index behaviour:**
  - Tapping an item scrolls to its chapter (animated unless reduce-motion).
  - Scrolling updates the active item (scroll-spy).
  - The active item is kept in view.
- **Chapter header:** a mono number ("01"), a 22px title and a hairline rule. No intro paragraphs and no extra screens.
- **Chapter contents:**
  - **01 Progress:**
    - 1K Progress: hero total / 1,000 lb, stacked bar, per-lift values. Lift values open plate loading. "What is 1K Progress?" info.
    - The **existing "1K total over sessions" chart** inside a disclosure, unchanged.
    - Big 3 mapping disclosure.
    - **Progressive Overload:**
      - summary bar;
      - filter chips All / Progressing / Steady / Regressing (UI filter over existing statuses);
      - search, Collapse all, per-day groups;
      - rows with a trend pill and right-aligned 1RM / Kilo / Best columns;
      - the suggestion card;
      - both explainers;
      - row tap → exercise detail sheet with "View in Log", reusing the existing values.
  - **02 Training:**
    - Training Breakdown, **unchanged** (Last 4 / Last 12 / All session windows; Movement / Muscles / Equipment; tile drill-down).
    - Routine Health: the since-deload gauge and zones, Total, Deload mode, and the session check-ins strip, all in one panel. The deload-off state shows production's existing "Total" only.
  - **03 Bodyweight:** the single authoritative weight visualization, in one panel:
    - top-left: **LATEST WEIGH-IN**, a 36px mono value with "lb";
    - top-right: the 7D AVG / 30D AVG segmented control, which **switches the rolling-average line only, never the date range**;
    - under those, full width: "<date> · <arrow> <signed change> vs previous weigh-in";
    - the chart, which plots every weigh-in at its recorded date with:
      - the rolling-average line (series token);
      - a dashed goal line labelled "GOAL <target>", **only when a goal is active**;
      - a hollow ring on the latest weigh-in;
      - point selection, which shows a callout (value · date · N-day avg · note);
      - axis labels;
    - the caption: "N weigh-ins at recorded dates · Line: N-day rolling average · Ring: latest weigh-in";
    - a split of 7-DAY AVG and 30-DAY AVG with toned changes;
    - a split of Goal (mode, target, to go) and Target pace, **only when a goal is active**;
    - a row "Log or manage weight ›" that opens the Weight tab;
    - the existing pace badge (spike / notable), if present, which sits in the top header slot;
    - production's empty and insufficient-data states.
  - **04 Recovery:** the Recovery history row, which opens Recovery management.
- **Active Recovery:**
  - The index becomes RECOVERY / BODYWEIGHT / PAUSED.
  - **01 Recovery** (tag "Active"): the recovery card with weeks, per-lift bars and "Manage recovery in Log", then Recovery history.
  - **02 Bodyweight:** the same chapter.
  - **03 Baseline training** (tag "Paused"):
    - a dashed, collapsed toggle row "Progress and Training · paused during Recovery";
    - when expanded, the paused sections render **below** the row, behind a dashed left rule, **not inside a card**;
    - the order inside is Strength → Overload → Training Breakdown → Health.
  - The collapse default and semantics stay as production's (#871).
- **Deep links:**
  - Existing section ids (`overview`, `strength`, `progressive-overload`, `weight`, `recovery`, plus any others in use) must still land.
  - Add `bodyweight` (or alias it to `weight`) for the Home and Weight entry points.
  - A destination inside the collapsed baseline still auto-expands it first.

## More (reference: `shots/hybrid/more-*`, `full-more-*`, `state-more-settings-*`)

- **Account row:** avatar, email and sync status (existing auth state).
- **Grouped sections**, each a panel with icon rows (title + one-line subtitle + chevron):
  - **Preferences:** Settings, User profile.
  - **Account & data:** Account, Data and backup, Import routine.
  - **Tools & help:** Routine prompt tools, App guide, About Kilo (version).
- **Settings:** grouped panels in production's order and labels:
  1. Features.
  2. Reminders, with times.
  3. Appearance: court picker and mode.
  4. Units.
  5. Fatigue multiplier, with "Reset to default (1.07)".

  Every setting keeps its control and behaviour.
- **Sub-screens** (Profile, Account, Backup, Help, About, prompt tools, import) keep their content. Only their shell and header change.

## Explicitly not changed

- Parser, data, storage and sync.
- Training Breakdown internals.
- Recovery semantics.
- Goal lifecycle rules.
- Unit conversion.
- Modal content not listed above.
