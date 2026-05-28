# MVP v3 Roadmap For Kilo

Status: complete and historical.

This roadmap's issue map has shipped on `main` through issues `#93`-`#109`.
The active roadmap now lives in `docs/roadmap-mvp-refine.md`. Treat this as a
historical snapshot of the v3 planning pass, not the place to add new roadmap
work.

## Historical Diagnosis
Current MVP friction is concentrated in five places:

- the shared mobile shell is not respecting Android top safe-area spacing
- Home is visually noisy and mixes branding, shortcuts, and low-value activity
- Log is still built around one canonical workout note instead of multiple
  named routines with one explicit current workout
- weight tracking has trust problems because pace is broken and long-history
  handling is too weak
- Analytics is visually clunky and semantically muddy, especially around 1k
  wording, tracked lifts, and weight trend presentation

## MVP v3 Principles
- Fix global usability before deeper feature work.
- Keep each issue small enough for one focused implementation session.
- Separate UI cleanup from parser, storage, and analytics logic changes.
- Make the selected current workout the only workout source of truth for Home
  and Analytics metrics.
- Prefer explicit warning states over blocking validation when a lighter MVP
  rule is sufficient.
- Avoid workout-note migration work for v3; allow a clean reset for the new
  multi-note model.

## Ordered MVP v3 Roadmap

### Phase 1: Global Mobile Shell Fixes (Complete)
- Phase goal: remove top-level mobile usability friction across the app.
- Why this phase comes here: every tab inherits the current shell and header,
  so this is the highest-leverage fix and reduces noise for all later UI work.

Ordered tasks:

#### Task 1: Fix mobile safe-area and top spacing across all tabs
- Goal: ensure app content clears the Android top system area consistently.
- Scope: adjust shared app shell and screen container spacing so Home, Log,
  Weight, Analytics, and More or Help render below the system bar.
- Out of scope: Home-specific redesign, tab bar redesign, analytics logic, log
  model work.
- Likely files or areas:
  - `mobile/App.js`
  - `mobile/components/ScreenShell.js`
  - shared screen container styles
- Verification:
  - Home, Log, Weight, Analytics, and More or Help no longer overlap the top
    Android system bar
  - shared top spacing is visually consistent across tabs
- Suggested agent or model tier: `frontend/UI implementation`
- Suggested labels:
  - `agent:gemini`
  - `area:ui`
  - `type:implementation`
  - `effort:default`

#### Task 2: Simplify the shared top header and normalize version presentation
- Goal: reduce global header noise and make version naming consistent.
- Scope: remove unnecessary logo use from the shared top-left title area,
  reduce version prominence, and standardize displayed version naming or
  formatting.
- Out of scope: Home card layout, Help-specific logo placement, tab renaming.
- Likely files or areas:
  - `mobile/components/ScreenShell.js`
  - shared branding assets only if still referenced
- Verification:
  - shared header looks cleaner on Home and More or Help
  - any retained version display is quiet and consistently named
- Suggested agent or model tier: `frontend/UI implementation`
- Suggested labels:
  - `agent:gemini`
  - `area:ui`
  - `type:implementation`
  - `effort:default`

### Phase 2: Home And Help Cleanup (Complete)
- Phase goal: make the default landing surfaces simpler, clearer, and more
  actionable without changing deeper data models yet.
- Why this phase comes here: once the shell is fixed, the next priority is the
  day-one usability of Home and Help.

Ordered tasks:

#### Task 3: Simplify the Home hero card and dashboard copy
- Goal: make Home read like a clean dashboard instead of a branding panel.
- Scope: change the subtitle to `Your training dashboard.`, reduce title-card
  clutter, rename `Total Workouts` to `Total Weeks`, and make `Latest Weight`
  and `Total Weeks` visually consistent by default.
- Out of scope: click-through navigation, graph redesign, conditional
  color-coding rules.
- Likely files or areas:
  - `mobile/screens/HomeScreen.js`
  - `mobile/components/UI.js`
- Verification:
  - Home shows the new subtitle and card labels
  - `Latest Weight` and `Total Weeks` have matched default visual weight
- Suggested agent or model tier: `frontend/UI implementation`
- Suggested labels:
  - `agent:gemini`
  - `area:ui`
  - `type:implementation`
  - `effort:default`

#### Task 4: Turn Home summary cards into shortcuts and remove Recent Activity
- Goal: make Home actionable and remove low-value clutter.
- Scope: make the summary cards navigate to their relevant tabs and remove the
  `Recent activity` section entirely.
- Out of scope: new analytics content, card color-coding rules, log data-model
  changes.
- Likely files or areas:
  - `mobile/screens/HomeScreen.js`
  - `mobile/App.js`
- Verification:
  - tapping `Latest Weight` opens Weight
  - tapping `Total Weeks` opens Log or Analytics as specified in the issue
  - `Recent activity` no longer renders
- Suggested agent or model tier: `frontend/UI implementation`
- Suggested labels:
  - `agent:gemini`
  - `area:ui`
  - `type:implementation`
  - `effort:default`

#### Task 5: Polish Help inside the More tab and preserve quick actions
- Goal: fix Help presentation without expanding navigation scope.
- Scope: apply the spacing and header cleanup to Help, keep quick actions, and
  allow centered logo placement above the Help panel only if the screen still
  benefits from it.
- Out of scope: renaming `More` to `Help`, Home analytics work, backup or
  import changes.
- Likely files or areas:
  - `mobile/screens/HomeScreen.js`
  - shared shell styles
- Verification:
  - Help content has clean top spacing
  - quick actions remain intact
  - any logo placement is deliberate rather than inherited clutter
- Suggested agent or model tier: `frontend/UI implementation`
- Suggested labels:
  - `agent:gemini`
  - `area:ui`
  - `type:implementation`
  - `effort:default`

### Phase 3: Log Model Reset (Complete)
- Phase goal: replace the single-note workout model with a small explicit
  multi-note routine system centered on one selected current workout.
- Why this phase comes here: Home and Analytics should not be rebuilt against
  the old workout-note model and then redone later.

Ordered tasks:

#### Task 6: Replace single workout note storage with multi-note current-workout storage
- Goal: establish the minimum data model needed for named routines.
- Scope: add workout-note collection storage, explicit manual titles,
  current-workout selection, and supporting hooks or state. Do not migrate the
  old single note into the new structure.
- Out of scope: full Log UI, analytics redesign, import or export compatibility
  expansion unless explicitly required by the implementation issue.
- Likely files or areas:
  - `mobile/storage/entries.js`
  - `mobile/hooks/useEntries.js`
  - `mobile/App.js`
- Verification:
  - user can create multiple titled workout notes
  - one note persists as the selected current workout
- Suggested agent or model tier: `default implementation`
- Suggested labels:
  - `agent:claude`
  - `area:workouts`
  - `type:implementation`
  - `effort:default`
  - `reasoning:medium`

#### Task 7: Rebuild Log tab around current workout and routine panels
- Goal: make the Log tab match the new routine model.
- Scope: show the selected current workout in structured view, render
  non-current workouts as truncated titled panels, and expose clear affordances
  to switch the current workout.
- Out of scope: raw-note editing internals, analytics metric fixes, deload
  support.
- Likely files or areas:
  - `mobile/screens/LogScreen.js`
  - `mobile/components/UI.js`
  - note-selection state from hooks or app shell
- Verification:
  - current workout is visually distinct and structured
  - non-current workouts appear as compact named panels
- Suggested agent or model tier: `frontend/UI implementation`
- Suggested labels:
  - `agent:gemini`
  - `area:ui`
  - `area:workouts`
  - `type:implementation`
  - `effort:default`

#### Task 8: Add raw note editor flow and fix Log save behavior
- Goal: preserve notepad flexibility inside the new routine model.
- Scope: any note can be opened as a raw notepad, `Save Note` works reliably,
  and switching the current workout requires explicit confirmation because
  analytics will change.
- Out of scope: deload logic, graph redesign, routine import or export
  expansion.
- Likely files or areas:
  - `mobile/screens/LogScreen.js`
  - `mobile/App.js`
  - note hooks or storage save paths
- Verification:
  - Save Note succeeds in raw-note mode
  - any note can be opened and edited as raw text
  - current-workout switches present a confirmation step
- Suggested agent or model tier: `default implementation`
- Suggested labels:
  - `agent:claude`
  - `area:ui`
  - `area:workouts`
  - `type:implementation`
  - `effort:default`
  - `reasoning:medium`

#### Task 9: Fix workout session counting for combined warmup and lifting days
- Goal: make workout-derived counts trustworthy before Home and Analytics
  depend on them.
- Scope: correct the logic that splits warmup and lifting from the same day
  into separate sessions, and define `Total Weeks` as the highest session count
  among days inside the current workout.
- Out of scope: deload handling unless a concrete bug blocks the counting rule.
- Likely files or areas:
  - `mobile/lib/parser.js`
  - `mobile/lib/data.js`
  - `mobile/tests/parser.test.js`
  - `mobile/tests/storage.test.js`
- Verification:
  - same-day warmup and lifting counts as one session
  - `Total Weeks` matches the highest per-day session count for the current
    workout
- Suggested agent or model tier: `default implementation`
- Suggested labels:
  - `agent:claude`
  - `area:parser`
  - `area:workouts`
  - `type:implementation`
  - `effort:default`
  - `reasoning:medium`

### Phase 4: Weight Log Reliability And Goals (Complete)
- Phase goal: make weight tracking trustworthy, scalable, and goal-aware before
  polishing downstream analytics.
- Why this phase comes here: Analytics should consume corrected weight logic
  instead of carrying forward broken pace behavior.

Ordered tasks:

#### Task 10: Fix shared weight pace calculation and regression coverage
- Goal: correct the broken pace flag wherever it appears.
- Scope: repair the shared pace calculation and ensure Weight and Analytics use
  the same corrected output.
- Out of scope: new goal UI, chart redesign, long-history UX redesign.
- Likely files or areas:
  - `mobile/lib/data.js`
  - `mobile/screens/WeightScreen.js`
  - `mobile/screens/StatsScreen.js`
  - `mobile/tests/storage.test.js`
- Verification:
  - known gain and loss scenarios classify correctly in tests
  - Weight and Analytics show the same pace behavior
- Suggested agent or model tier: `default implementation`
- Suggested labels:
  - `agent:claude`
  - `area:weight`
  - `type:implementation`
  - `effort:default`
  - `reasoning:medium`

#### Task 11: Redesign weight history rows for long-history use and delta severity
- Goal: keep the Weight tab readable as entry count grows.
- Scope: improve history handling for long lists and add delta severity styling
  for notable, spike, and outlier changes using the supplied thresholds.
- Out of scope: goal setting, calorie estimates, new charting.
- Likely files or areas:
  - `mobile/screens/WeightScreen.js`
  - `mobile/components/UI.js`
- Verification:
  - long histories remain usable
  - delta styling differentiates `>1.5 lb`, `>2.3 lb`, and stronger outlier
    changes
- Suggested agent or model tier: `frontend/UI implementation`
- Suggested labels:
  - `agent:gemini`
  - `area:ui`
  - `area:weight`
  - `type:implementation`
  - `effort:default`

#### Task 12: Add target weight and target-date goals with derived weekly pace and soft warnings
- Goal: turn weight logging into lightweight planning without overbuilding
  health logic.
- Scope: add target weight and target date, derive gain or loss direction,
  compute required weekly change, and warn without blocking when the target
  looks unrealistic or unhealthy.
- Out of scope: calorie estimates, broad profile systems, medical advice
  features.
- Likely files or areas:
  - `mobile/screens/WeightScreen.js`
  - weight-goal storage or helpers near `mobile/storage/entries.js`
  - shared formatting helpers if needed
- Verification:
  - user can save a goal
  - required weekly pace is shown
  - warning states are visible without blocking save
- Suggested agent or model tier: `default implementation`
- Suggested labels:
  - `agent:claude`
  - `area:weight`
  - `type:implementation`
  - `effort:default`
  - `reasoning:medium`

#### Task 13: Add lightweight calorie estimate helper for weight goals
- Goal: provide a basic planning estimate tied to the new goal concept.
- Scope: add a narrowly scoped calorie estimate based on the minimum stored
  user inputs needed for the chosen formula and display it as an advisory
  helper only.
- Out of scope: full nutrition planning, activity coaching, aggressive health
  recommendations.
- Likely files or areas:
  - weight-goal UI
  - any minimal profile or settings storage needed for the estimate
  - supporting weight-goal calculation helpers
- Verification:
  - user can enter the required inputs
  - app shows a stable estimate tied to goal direction
- Suggested agent or model tier: `exceptional/heavy only if truly warranted`
- Suggested labels:
  - `agent:claude`
  - `area:weight`
  - `type:implementation`
  - `effort:heavy`
  - `reasoning:high`

### Phase 5: Home And Analytics Redesign (Complete)
- Phase goal: replace low-value visuals with compact trustworthy analytics
  built on the new current-workout and weight-goal foundations.
- Why this phase comes here: this phase depends on the corrected log and weight
  data semantics from Phases 3 and 4.

Ordered tasks:

#### Task 14: Add reusable compact line-chart component with latest and tap values
- Goal: create one chart surface that Home and Analytics can reuse.
- Scope: build a compact line graph that can show the latest visible value and
  inspect values via tap.
- Out of scope: screen-specific copy or layout decisions, extra chart types,
  drag or hover interactions.
- Likely files or areas:
  - shared mobile UI chart component area
  - `mobile/components/UI.js` or a dedicated chart component
- Verification:
  - a screen can render a compact line chart
  - latest value is visible by default
  - tap reveals point values
- Suggested agent or model tier: `frontend/UI implementation`
- Suggested labels:
  - `agent:gemini`
  - `area:ui`
  - `type:implementation`
  - `effort:default`

#### Task 15: Replace Home workout and weight mini-analytics with line-based cards
- Goal: make Home analytics compact and meaningful.
- Scope: remove `sets per session`, add current-workout progress toward 1k, and
  replace the weight bars with a 7-day rolling-average line chart.
- Out of scope: Analytics tab redesign, extra color-rule systems,
  non-current-workout metrics.
- Likely files or areas:
  - `mobile/screens/HomeScreen.js`
  - shared chart component
  - current-workout analytics helpers
- Verification:
  - Home shows no sets-per-session panel
  - 1k progress and 7-day rolling weight average render with latest or tap
    values
- Suggested agent or model tier: `frontend/UI implementation`
- Suggested labels:
  - `agent:gemini`
  - `area:ui`
  - `area:weight`
  - `area:workouts`
  - `type:implementation`
  - `effort:default`

#### Task 16: Compact Analytics weight panels and remove awkward totals layout
- Goal: make the top half of Analytics readable and less bulky.
- Scope: shrink or clean up weight trend panels, ensure corrected pace behavior
  is used, and remove the low-value bottom totals or awkward four-bubble
  treatment.
- Out of scope: strength-metric redesign, exercise-picker filtering, Home
  analytics.
- Likely files or areas:
  - `mobile/screens/StatsScreen.js`
  - shared stat-card styles
- Verification:
  - Analytics no longer feels like a four-bubble grid
  - pace display matches shared logic
  - low-value totals are gone
- Suggested agent or model tier: `frontend/UI implementation`
- Suggested labels:
  - `agent:gemini`
  - `area:ui`
  - `area:weight`
  - `type:implementation`
  - `effort:default`

#### Task 17: Redesign Analytics strength section around useful lift metrics
- Goal: make lift analytics understandable and scalable beyond three tracked
  exercises.
- Scope: rename the 1k section to remove `club`, clarify and show both classic
  1RM and Kilo measure where available, filter the exercise picker so
  irrelevant options like `Bike` do not appear, remove low-value sets
  emphasis, and redesign tracked-lift cards to scale beyond three exercises
  with useful metrics: 1RM, Kilo max, highest completed weight, and overload
  trend.
- Out of scope: new exercise taxonomy beyond what is needed to filter obvious
  non-lifts, program redesign, deload analytics.
- Likely files or areas:
  - `mobile/screens/StatsScreen.js`
  - `mobile/lib/data.js`
  - `mobile/lib/parser.js`
  - targeted analytics tests if metric semantics change
- Verification:
  - strength analytics no longer use `1,000 lb Club` naming
  - irrelevant warmup entries are excluded from the selector
  - tracked-lift cards expose the agreed metrics cleanly for more than three
    exercises
- Suggested agent or model tier: `default implementation`
- Suggested labels:
  - `agent:claude`
  - `area:ui`
  - `area:workouts`
  - `type:implementation`
  - `effort:default`
  - `reasoning:medium`

## GitHub Issue Map
- Phase 1
  - Phase 1 / Task 1: Fix mobile safe-area and top spacing across all tabs #93
  - Phase 1 / Task 2: Simplify the shared top header and normalize version presentation #94
- Phase 2
  - Phase 2 / Task 1: Simplify the Home hero card and dashboard copy #95
  - Phase 2 / Task 2: Turn Home summary cards into shortcuts and remove Recent Activity #96
  - Phase 2 / Task 3: Polish Help inside the More tab and preserve quick actions #97
- Phase 3
  - Phase 3 / Task 1: Replace single workout note storage with multi-note current-workout storage #98
  - Phase 3 / Task 2: Rebuild Log tab around current workout and routine panels #99
  - Phase 3 / Task 3: Add raw note editor flow and fix Log save behavior #100
  - Phase 3 / Task 4: Fix workout session counting for combined warmup and lifting days #101
- Phase 4
  - Phase 4 / Task 1: Fix shared weight pace calculation and regression coverage #102
  - Phase 4 / Task 2: Redesign weight history rows for long-history use and delta severity #103
  - Phase 4 / Task 3: Add target weight and target-date goals with derived weekly pace and soft warnings #104
  - Phase 4 / Task 4: Add lightweight calorie-estimate helper for weight goals #105
- Phase 5
  - Phase 5 / Task 1: Add reusable compact line-chart component with latest and tap values #106
  - Phase 5 / Task 2: Replace Home mini-analytics with compact line-based cards #107
  - Phase 5 / Task 3: Compact Analytics weight panels and remove awkward totals layout #108
  - Phase 5 / Task 4: Redesign Analytics strength section around useful lift metrics #109

## MVP v3 Deferrals
- deload-specific session logic beyond what is strictly necessary to fix the
  current counting bug
- renaming `More` to `Help` or splitting Help into a new top-level tab
- rich chart drag or hover interactions beyond latest-value display and
  tap-to-inspect
- broader nutrition or profile systems beyond the narrow calorie-estimate
  helper
- analytics cleanup not tied to current-workout metrics, weight trends, or
  tracked lifts

## Open Questions Before Implementation
- Should the shared header keep a minimized version indicator or remove it
  entirely once version naming is normalized?
- Should the `Total Weeks` Home shortcut open Log or Analytics by default?
- Should the weight history redesign use a simple denser list only, or also
  introduce sectioning or collapse behavior when history grows long?
- Which lightweight calorie-estimate formula should be considered acceptable
  for the later helper task?

## Recommended First 3 GitHub Issues
1. Fix mobile safe-area and top spacing across all tabs
2. Simplify the shared top header and normalize version presentation
3. Simplify the Home hero card and dashboard copy
