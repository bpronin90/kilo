# UI Design Rules

Status: **Adopted.** This document owns durable UI behavior and composition
rules. Keep it and `docs/design-system-map.md` in sync when an intentional UI
change alters an established pattern.

Scope: mobile app (`mobile/`). Companion reference: `docs/design-system-map.md`
(the token/line-level audit). This doc states the *rules*; the map states the
*current values*.

These rules describe the patterns established by completed UI work and the
anti-patterns that previously caused inconsistency. Delivery history belongs in
the changelog and archived roadmaps.

---

## 1. Top-of-tab content alignment

- Every screen renders inside `ScreenShell` (`mobile/components/ScreenShell.js`).
  Do not build a screen's outer scroll/padding by hand.
- `ScreenShell` owns the top-of-tab contract: **16px horizontal padding**, a
  **16px vertical gap between top-level children**, and bottom padding sized
  as the measured `TabBar` height + 24px visual gap + bottom safe-area inset,
  for tab-bar clearance. Every tab's content therefore starts at the same left
  edge and the same top offset.
- The screen title is a single 34/700 line inside the shell header. Do not
  re-implement per-screen titles at other sizes or with custom top padding.
- Anything you want spaced as a "top-level block" must be a direct child of the
  shell so it inherits the 16px gap. Do not wrap several panels in an extra
  `View` unless that wrapper is itself one logical block — a stray wrapper
  swallows the shell gap and desyncs that screen from the others.

## 2. Title-to-panel spacing

- Use `SectionTitle` (18/700, `marginTop: 6`) for the label above a panel.
- The gap between a `SectionTitle` and the panel it introduces is the shell's
  16px child gap. **Do not** add ad-hoc `marginBottom`/`marginTop` between a
  title and its panel to simulate spacing — that was the exact defect behind the
  reopened #383 verification (title sitting flush against its card, or uneven
  gaps between screens).
- If a title and its panel must be grouped (e.g. a collapsible section that owns
  both), wrap them in a container with `gap: 16` so the internal title→panel
  spacing matches the shell gap everywhere else. See `archivedContainer` in
  `WeightScreen.js`.

## 3. Panel-to-panel spacing

- Panel-to-panel spacing is the 16px shell gap. It is the single source of truth
  for vertical rhythm; do not introduce a second spacing value between panels.
- A panel whose outer `View` has no `gap` will visually collide with its title
  or neighbor. Every multi-part panel wrapper must declare its own `gap: 16` to
  stay consistent (the fix applied to `AnalyticsWeightTrendsCard` and
  `WeightScreen` goal history).
- Sticky headers (e.g. the Progressive Overload header) must carry symmetric
  `paddingTop`/`paddingBottom` (currently 8/8) so the pinned title keeps
  breathing room at the top of the viewport.

## 4. When panels/cards are allowed, and how dense

- Use `Card` (`mobile/components/UI.js`) for a bounded, self-contained block:
  radius 24, padding 18, 1px `cardBorder`, `gap: 10` between children.
- Use a card when the content is a discrete unit (an input form, a goal summary,
  a single analytics metric group). Do **not** nest cards inside cards; a card
  inside a card reads as visual noise and breaks the padding rhythm.
- Long, repeating data (history lists, mapping rows) belongs in a **panel** with
  a header row and full-bleed rows, not in a padded `Card`. Panels set
  `padding: 0` / `overflow: 'hidden'` on the container and let each row own its
  16px horizontal padding, so header and rows align to one grid.
- Keep density high but scannable: one primary value per row, secondary values
  as smaller muted text, no more than three columns of data per row on phone
  width.

## 5. Section headers and column headers for history/long lists

- Any list that can grow with real user data (weight history, goal history, PO
  signals) must have a **column-header row** so a collapsed or scrolled list
  never loses context.
- Column header labels use the shared micro-label style: 11px / 700 (analytics
  PO uses 800) / uppercase / `letterSpacing: 0.5` / `textMuted`, over a
  `subtleBg` header row.
- Header columns and body columns must share the same flex weights so values sit
  directly under their labels. The Weight/Goal history system fixes these
  weights as shared constants (`HISTORY_COL1/2/3_FLEX`, control cell width 56).
  Never let a header column drift from its body column.
- Column alignment convention: primary value left, secondary value centered,
  date right. Keep this consistent across every history panel.

## 6. Collapse / expand behavior for long panels

- Long or secondary panels must be collapsible. Default state is **expanded**.
- The collapse control is a `MaterialIcons` chevron — `expand-less` when
  expanded, `expand-more` when collapsed — size 16–18, `textMuted`, living in a
  trailing control cell. This is the standardized convention (#389, #410); do
  **not** use text glyphs like `▲`/`▼` or rotate custom SVGs.
- The whole header row is the press target (`accessibilityRole="button"` with an
  Expand/Collapse label), not just the icon.
- A collapsed panel must show a one-line **summary** (count + latest value), so
  collapsing hides detail without hiding meaning. See the history panels'
  `summaryStack` (count 12/600 over a "Latest: …" line).
- A list of several independently collapsible groups may carry one **bulk
  collapse control** in the list's own header (Analytics' Progressive Overload
  is the reference). It is a labelled text control — `Collapse all` / `Expand
  all`, 12/700 uppercase `textMuted` — paired with the `unfold-less` /
  `unfold-more` `MaterialIcons` glyph, deliberately *not* the per-panel
  `expand-less`/`expand-more` chevron, which would read as the header
  collapsing itself. It reports `accessibilityState={{ expanded }}` and is
  omitted entirely when there is nothing to collapse.

## 7. Date-range / filtering controls for long histories

- History filtering is client-side over already-loaded entries. Do not add a new
  data model, hook, or backend round-trip just to filter a visible list.
- The filter affordance is a `date-range` `MaterialIcons` icon in the Date header
  cell; it turns `accent` when a range is active or the filter row is open.
- The From/To controls appear as their **own row directly under the header**,
  never overlapping the first data row. Toggling the filter off, or clearing
  (`✕`), closes and clears the range.
- If the panel is collapsed when the filter icon is tapped, expand the panel and
  reveal the filter row so the controls are immediately visible.
- Web uses text inputs; native uses `DateTimePicker`. Keep both paths behind the
  same icon and row so behavior reads identically.

## 8. Visual hierarchy for analytics panels

- One hero metric per analytics card, using `HeroMetric`/accent color. Do not
  put two competing hero-sized numbers in the same card.
- Supporting stats sit below the hero as a row of equal-weight items (value
  18/700 over an 11/600 uppercase muted label). Dividers between supporting
  stats are 1px `cardBorder`/`divider`, not heavy rules.
- Group analytics content under `SectionTitle`s ("Overview", "Weight Trends",
  "Fatigue", "Strength") so the tab has a clear top-to-bottom reading order.
  **One `SectionTitle` per section.** Progressive Overload is a heading *inside*
  Strength (15/700, not `SectionTitle`), because the 1K total and the per-lift
  table are one subject; two section titles were splitting it in half.
- An analytics tab leads with an **overview block**: one row per permanent
  signal, each stating its current value, what changed and over what window, and
  linking to the section that itemises it. Rows are full-width, not a column
  grid, so a large font scale wraps rather than clipping. The overview computes
  nothing — it reads the same series its sections plot, so the two cannot drift.
- **A failed read is not an empty state.** Any surface summarising a source that
  can fail must distinguish "unavailable" from "nothing logged yet"; reporting a
  load failure as an empty state produces a confident, wrong report (#737).
- Insufficient-data copy states the **threshold and one action** ("Weigh in on
  two different days to see this trend" + a link to logging), never a bare
  "Not enough data".
- Secondary/explanatory content (Big 3 mapping, "How is this calculated?") is
  collapsible and defaults appropriately — mapping expanded, long explainer
  collapsed.

## 9. Mobile-first spacing and overflow

- Design for phone width first. Assume three data columns is the practical
  maximum per row; prefer stacking a secondary value under the primary (as the
  history note sits under the weight value) over adding a fourth column.
- Panels clip with `overflow: 'hidden'` so rounded corners stay clean and no row
  bleeds past the card border.
- Long single-line values (dates, notes, latest-summary lines) use
  `numberOfLines={1}` with the row grid absorbing width; never let one long
  value push the layout wider than the shell.
- The desktop-web build caps content width (640px, centered) in `ScreenShell`;
  do not defeat that cap with fixed pixel widths on panels.
- Native bottom navigation uses the runtime bottom safe-area inset without
  device checks. Add that inset once to both the tab bar's 24px visual gap and
  `ScreenShell`'s content clearance (measured `TabBar` height + 24px gap +
  inset); do not apply it as a second top inset. The bar's own height is not
  added to its bottom offset — only `ScreenShell`'s clearance depends on it.

## 10. Anti-patterns (what caused the fixed problems)

- **Flush title/panel:** a panel wrapper with no `gap`, so its `SectionTitle`
  touches the card edge. (Reopened #383 spacing failure.)
- **Per-screen spacing drift:** hand-tuned margins between panels instead of the
  shell's 16px gap, so tabs stopped lining up with each other.
- **Header/body column drift:** column headers whose widths don't match the body
  rows, so values no longer sit under their labels.
- **Stacked, unaligned history rows:** date/weight/goal stacked without a shared
  column grid — the original "misaligned and hard to scan" goal-history panel.
- **Inconsistent collapse glyphs:** mixing text arrows, SVG chevrons, and icon
  chevrons across panels. Use the one `MaterialIcons` chevron convention.
- **Collapse that hides meaning:** collapsing a list to nothing instead of a
  count + latest summary.
- **Filter overlapping data:** filter controls rendered on top of or flush
  against row 1 instead of in their own separated row.
- **Duplicated logical groups:** the same day showing twice under Progressive
  Overload because grouping keyed on full heading strings instead of a
  normalized day key. Group by the semantic key, not the raw label. (#383/#385.)
- **Competing hero metrics:** two accent-sized numbers fighting for attention in
  one analytics card.

## 11. Truthful UI control and prerequisite copy

Copy in empty states, help screens, and onboarding materials must be accurate to
the shipped UI and feature state. This rule prevents misleading guidance and
reduces friction when a user follows documented instructions but encounters
different or unavailable surfaces.

- **Copy referencing a UI control must match the control's actual accessible
  name or visible label exactly.** If your copy says "tap the bookmark," the
  screen must have a button or icon labeled "Bookmark" or with
  `accessibilityLabel="Bookmark"`. If the real control reads "Track," your copy
  must use that word, not a synonym or prior name. This matters for screen-reader
  users who search by label, and for sighted users who hunt for a named affordance
  in an unfamiliar interface. At review time, a reviewer can catch this mismatch by
  searching the codebase for the exact control label — if it does not appear, the
  copy is inaccurate. (§4/§9 already govern label size, color, and placement; this
  rule covers semantic accuracy only.)

- **Feature descriptions must state material prerequisites, not describe only
  the populated end-state.** If a chart appears only after a user has marked
  exercises as tracked *and* logged multiple sessions, your copy must say so,
  not describe the chart as available to "tracked exercises" alone. Onboarding
  copy that describes only a feature's final, full state will misguide a
  first-time user who follows the instructions but still sees an empty state or
  placeholder. Differentiate between preconditions (what the user must do) and
  gated data (what the app requires internally). If a feature is truly unavailable
  (a chart or history view promised in old copy but never shipped), do not qualify
  its preconditions — remove the feature from the description entirely and
  describe what actually appears instead.

- **Empty-state guidance, help copy, and feature summaries are not locations
  to promise unavailable functionality.** Onboarding copy should teach the
  current app; it should not reference future features or suggest workarounds
  for limitations. If a user needs a feature that does not exist yet, that is a
  product roadmap question, not a UX-writing question. Keep empty-state and help
  copy narrowly scoped to what is actually shipped and reachable today.

## 12. Appearance modes and semantic color

Kilo ships Light and Dark (indigo) appearances plus a System option. Every UI
change must work in both palettes. Concrete values live in
`docs/design-system-map.md`.

- **Never write a literal color into a screen or component.** Read the active
  palette with `useTheme()` and build the sheet with
  `useThemedStyles(createStyles)`, where `createStyles` is a module-level
  `(colors) => StyleSheet.create({ ... })` factory. A module-scope
  `StyleSheet.create()` captures values at import time and cannot repaint on a
  mode change, so it is an anti-pattern under this rule.

- **There is no static palette import and no mutable global palette.** A helper
  that renders JSX but cannot hold a hook (for example `formatOverload`) takes
  `colors` as a parameter from its calling component; it does not reach for a
  module-level object.

- **Use the semantic token, not the nearest-looking one.** `success`, `caution`,
  and `error` are *direct status* colors for marks, dots, meter segments, and
  colored text — dark mode makes them deliberately bright. A *filled* surface
  that carries a `textLight` label must use its `card*Bg` counterpart instead;
  a *tinted* surface uses `errorSurface` / `cautionSurface` with the paired ink.
  Text on an accent fill uses `onAccent`; the shared Button's label uses
  `buttonLabel`.

- **Any new filled surface + label pairing needs a recorded contrast ratio.**
  Add the measured value to the derived-token table in
  `docs/design-system-map.md` and an assertion in
  `mobile/tests/theme-rendering.test.js`. Normal text targets WCAG AA 4.5:1 in
  both modes.

- **Card borders stay uniform.** Every ordinary card uses the shared 1px
  `cardBorder`; in dark mode that border is accent-tinted for all of them. The
  only sanctioned deviation is the current-routine card's 4px `accent` border.

- **The only intentionally fixed color is the `#FF5C00` Kilo wordmark accent.**
  Anything else hardcoded is a bug.

- **No surface may require a reload.** A preference change or an OS scheme
  change must repaint the shell, every screen, and every modal immediately.

### Ownership pause (active policy)

Do not assign new UI implementation issues to `agent:gemini` until the repo
owner states the ownership pause is lifted.

## 13. Card headers carry identity; actions live in the body or an action strip

- **A card header holds identity only:** title, subtitle, and a status badge. It
  does not host action controls. The header row itself may still be the
  expand/collapse press target — that is the card's own disclosure, not an
  action competing with the title for width.
- **Actions belong in one of two places:** the card's expanded body (for
  occasional actions, reached by the expand-on-tap disclosure the app already
  ships), or a single dedicated action strip directly under the header (for
  actions needed every session). Do not use both for the same card.
- **A collapsed list shows zero buttons, with one narrow exception (#756,
  #836).** Scanning a list of records is a reading task; nothing in it should
  be pressable except the records themselves — except a single compact
  action for something common enough that opening the row first would cost
  an everyday tap (e.g. `Set as current routine` on a collapsed routine row,
  icon-only; `New routine` in the panel header, icon plus a visible label so
  its purpose isn't icon-only guesswork — and, since #836, this section's
  ONE create-routine affordance, not one of two duplicates). Anything less
  frequent than that stays inside the row's own expand-on-tap body. See
  `LogPreviousRoutines.js` for the reference implementation.
- **Place a control by frequency, not by convenience.** An action performed once
  per training block does not belong on every card. If N cards each open the
  same modal, and that modal can already choose its own subject, the N entry
  points are duplicates — replace them with one entry point in the section that
  owns the feature.
- **A state-dependent action renders in exactly one form at a time.** Two
  opposite controls (`Skip week` / `Remove skip`) must not both sit on screen
  with one dimmed; render the one that applies. Opacity over already-muted text
  is not a legible disabled state (see §13 contrast).
- **Do not introduce a `•••` overflow menu, bottom sheet, or action sheet** to
  solve a crowded header. No such pattern exists in `mobile/components/`, and
  adopting one is a separate design decision, not an implementation detail.

Anti-pattern this replaces: a header row where a `flex: 1` title column competes
with an unbounded action container, so the title collapses or truncates to make
room for controls that were never everyday actions (#709 Stage 2 §5 Issue B;
contained in #710, removed in #711).

## 14. Destructive actions: button tone and the Danger Zone container

- **Irreversible/destructive actions use `Button tone="danger"`**
  (`mobile/components/UI.js`): transparent fill, a `1.5px` `colors.error`
  border, and `colors.error` label text, instead of the shared Button's
  default solid fill. This is a visual hierarchy signal in addition to
  wording — never rely on color alone (the label must still state the
  consequence, e.g. "Delete Account", not just "Delete"). Routine actions
  (Sign Out, Export, Import) keep the default tone even when they open a
  confirmation.
- **Group irreversible actions in a Danger Zone container**, not loose among
  routine controls: `backgroundColor: colors.errorSurface`, `borderWidth: 1`,
  `borderColor: colors.error`, `borderRadius: 24`, `padding: 18`, `gap: 12`,
  with a small heading (`fontSize: 12`, `fontWeight: '800'`,
  `letterSpacing: 0.6`, uppercase, `colors.error`, "⚠ Danger Zone"). This is a
  local `View` style per screen, not a shared `UI.js` primitive — only the
  Button tone is factored out, since the container has no interactive
  behavior of its own. See `AccountScreen.js` (Delete Account) and
  `BackupScreen.js` (Wipe Device Data) for the reference implementation
  (#822).
- **Autosaved editor rollback is explicit and confirmed.** Safe Routine and
  Recovery editor exit is `Done` (including Android Back) and keeps the latest
  authored state. A
  whole-edit rollback is labelled `Revert this edit`, lives in the editor body
  rather than the compact header, and requires destructive confirmation that
  explains it will restore the editor-entry snapshot, including over autosaved
  changes. A control labelled `Cancel` may only open this explicit choice; it
  must never perform the rollback directly (#851).

## 15. Interactive targets: 44dp minimum with complete semantics

- **Every interactive control presents a ≥44×44dp effective target.** This is a
  floor, not a style: it applies to chips, segmented tabs, text-only actions,
  and disclosure rows alike, not only to the shared `Button`.
- **Prefer growing the box:** `minHeight: 44` (plus `minWidth: 44` on a compact
  control) with `justifyContent: 'center'` / `alignItems: 'center'`, so the
  padding and type stay as designed while the box reaches the minimum. This is
  the default because the target then matches what the user sees.
- **When a control's visual must keep a fixed size, wrap it in a real target
  box** rather than reaching for `hitSlop`: React Native clips a slop at the
  parent's bounds, so a slop that grows past a one-line-tall row claims a
  target the control never had (the same finding that shaped #757's info
  button). `ReminderSettingsCard`'s weekday chips keep their 36dp circle inside
  a 44dp-tall `flex: 1` Pressable, so the targets are contiguous across the row
  and no press between two circles is lost.
- **An expanded target may never overlap a neighbour** or a parent disclosure
  trigger. Targets that touch are fine; targets that overlap steal presses.
- Seven-across weekday circles are the one place the width minimum is not
  reachable on a 320dp screen (seven 44dp boxes need 308dp inside a card that
  offers 252dp). Taking the full row width is the documented ceiling there.
- **Semantics ship with the target.** An interactive control declares
  `accessibilityRole` (`button`, or `checkbox` for a multi-select chip), an
  accessible name that matches its visible label, and its state —
  `selected` for a segmented or toggle choice, `disabled` where the control can
  be inert, `expanded` on a disclosure trigger, `checked` on a checkbox. Mark
  the label `Text` inside as `accessible={false}` so the control announces once.
- Assert the contract per control in the style of
  `mobile/tests/interaction-target-a11y.test.js`: the flattened
  `minHeight`/`minWidth`/`hitSlop` plus the role/name/state props, so a later
  style edit that drops the minimum fails a test rather than shipping.
