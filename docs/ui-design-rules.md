# UI Design Rules

Status: **Adopted.** UI implementation issues and reviews reference these rules.
Cite the relevant section in an issue's acceptance criteria; a reviewer may block
work that violates a rule here. Keep this doc and `docs/design-system-map.md` in
sync when a UI change intentionally changes an established pattern.

Scope: mobile app (`mobile/`). Companion reference: `docs/design-system-map.md`
(the token/line-level audit). This doc states the *rules*; the map states the
*current values*.

These rules are drawn from the UI cleanup that ran from #383 through #413
(tab-spacing polish, the unified Weight/Goal history panel system, collapse
standardization, and the analytics hierarchy fixes). They describe the patterns
that survived user verification, and the anti-patterns that caused the problems
those issues fixed.

---

## 1. Top-of-tab content alignment

- Every screen renders inside `ScreenShell` (`mobile/components/ScreenShell.js`).
  Do not build a screen's outer scroll/padding by hand.
- `ScreenShell` owns the top-of-tab contract: **16px horizontal padding**, a
  **16px vertical gap between top-level children**, and **120px bottom padding**
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
- Group analytics content under `SectionTitle`s ("Weight Trends", "Fatigue",
  "Strength", "Progressive Overload") so the tab has a clear top-to-bottom
  reading order.
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

## 11. Issue-writing rules: ownership vs. Role

These are process rules, enforced today in `AGENTS.md` / `CLAUDE.md` /
`CODEX.md`; restated here because UI issues repeatedly got them wrong.

- **Labels define ownership.** The `agent:` label (`agent:claude`,
  `agent:codex`, `agent:gemini`) is the single source of truth for who owns a
  task. Never state ownership in prose.
- **The `Role` section defines the implementer's engineering stance**, not who
  owns the work. Write it as a task-specific discipline, e.g. "Assume the role
  of a mobile UI systems engineer" or "Assume the role of a regression-focused
  analytics engineer."
- Do not use `Role` to restate the agent name, model, or reasoning routing —
  those live only in labels.
- UI implementation issues should list exact `Allowed Files` and reference the
  relevant sections of this doc (once adopted) and `docs/design-system-map.md`
  for the concrete token values, rather than restating pixel values inline.

### Ownership pause (active policy)

Do not assign new UI implementation issues to `agent:gemini` until the repo
owner states the ownership pause is lifted.
