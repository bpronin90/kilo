# UI Compatibility and Earlier Comparisons

For maintainers interpreting older screen comparisons and intentional legacy differences. These pre-migration tables retain provenance; newer per-screen contracts and the [KUA specification](design/kinetic-utilitarian-athletic/README.md) take precedence. They are not a current defect backlog.

## Cross-Screen Inconsistencies

**Reconciled after #383→#413.** These were resolved:
- Weight History and Goal History are now one shared panel system (identical
  header/grid/summary/collapse), replacing the two divergent stacked layouts.
- Collapse toggles are unified on the `MaterialIcons` chevron convention across
  history panels and analytics (was: mixed text arrows / SVGs).
- Title-to-panel and panel-to-panel spacing is normalized to the 16px shell gap
  (was: flush titles and per-screen drift — the reopened #383 defect).
- The duplicate-day Progressive Overload group is fixed via normalized day-key
  grouping.

The items below recorded cross-screen differences at that cleanup. Read them
as historical compatibility evidence; current screen contracts supersede them.

### Hero Metric Sizes

| Screen | Element | fontSize | fontWeight | color |
|---|---|---|---|---|
| Home | Weight value | `48` | `800` | `accent` |
| Home | 1K total | `48` | `900` (`HeroMetric.hero`) | lerped `accent`→`success` |
| Analytics | Weight value | `32` | `900` | `accent` |
| Analytics | 1K total | `48` | `900` | `accent` |
| Weight | Goal value | `24` | `900` | `accent` |
| Weight | Trend value | `20` | `900` | `text` |

Home uses `800` for bold metrics; Weight uses `900` with no shared system between
those two screens. The Home/Analytics 1K pair shares the same `HeroMetric.hero`
scale — see below.

### 1K Card: Home vs Analytics (#763, restored #771)

Home is the compact-summary treatment; Analytics is the detail owner (chart,
Big 3 mapping, calculation explanation, plate calculator). #763 gave Home's
hero total its own smaller `32`/`800` override to signal that hierarchy, but
that read as a visual demotion of a primary progress summary — #771 restored
the pre-#763 scale so the total spreads `HeroMetric.hero` (`48`/`900`) exactly
like Analytics' owner card. A plain, quiet chevron in the card's header still
marks Home as a handoff rather than the destination, so the compact-vs-owner
distinction lives in scope and ownership, not typographic scale. Everything
that plays a supporting role — progress track, unit suffix,
and per-lift breakdown typography — stays normalized so the two surfaces read
as one family.

| Property | Home | Analytics | Status |
|---|---|---|---|
| Total fontSize | `48` (`HeroMetric.hero`) | `48` (`HeroMetric.hero`) | normalized (#771; was a `32`/`800` explicit override on Home, #763) |
| Total fontWeight | `900` (`HeroMetric.hero`) | `900` (`HeroMetric.hero`) | normalized (#771) |
| Card padding | `24` | `24` | normalized |
| Progress bar background | `colors.divider` | `colors.divider` | normalized (#763; was `cardBorder` on Home) |
| Progress bar borderRadius | `4` | `4` | normalized (#763; was `6` on Home) |
| Unit suffix | literal leading space (`" {unit}"`) | literal leading space (`" {unit}"`) | normalized (#763 review) — both are a `Text` nested inside the value `Text`, where native RN treats the child as an inline attributed run, not a Yoga box, so `marginLeft` on the nested `Text` did not reliably create spacing on either surface; both now use a literal leading space to guarantee "1000 lb" renders correctly on iOS/Android |
| Breakdown value fontWeight | `700` | `700` | normalized (#763; was `800` on Home) |
| Breakdown value fontSize | `16` | `18` | intentional (scales with hero size) |
| Breakdown label | `11`, uppercase | `11`, uppercase | normalized (#763; Home was `12`, sentence case) |
| Breakdown divider | vertical `borderLeft/Right` between items | horizontal `borderTop` above row | intentional (Home's 3-column grid vs Analytics' row-then-chart layout) |

The remaining differences (breakdown fontSize, divider orientation) are the
owner-vs-compact-summary hierarchy working as intended, not unresolved drift.

### Support Label Patterns

| Pattern | fontSize | Weight | Case | Screens |
|---|---|---|---|---|
| Uppercase micro-label | `10` | `700` | `uppercase` | Analytics (column headers, trend labels), Weight (trend labels) |
| Uppercase small label | `11` | `600` | `uppercase` | Home (hero sublabels, 1K breakdown labels — #763), Analytics (footer stat labels, 1K breakdown labels) |
| Uppercase label | `12` | `700` | `uppercase` | Home (goal stat label), Analytics (weight label, 1K label, slot title), Weight (section titles, goal labels) |
| Section title label | `14` | `700` | `uppercase` | Analytics (1K progress label) |

Four different sizes for the same role (metadata label above a value). The `10px` labels on Home classifications and Analytics column headers are the smallest text in the app.

### Card Padding

| Screen | Card | Padding |
|---|---|---|
| Shared default | Card component | `18` |
| Home | Weekly hero | `18` (#1278) |
| Home | Goal card | `24` |
| Home | 1K card | `24` |
| Analytics | Weight card | `20` |
| Analytics | 1K card | `24` |
| Analytics | Slot card | `16` |
| Weight | Trends card | `0` (merged sections, `16` per section) |

### Divider Patterns

| Type | Used Where |
|---|---|
| Full-bleed `marginHorizontal: -24` | Home hero divider |
| `borderTop 1px` | Analytics weight footer, Analytics 1K breakdown, Weight trend sections |
| `borderBottom 1px` | Weight history rows, Analytics signal rows |
| `borderLeft/Right 1px` | Home 1K breakdown items |
| `opacity: 0.5` divider | Weight goal divider |

### Orange Usage (colors.accent)

| Screen | Elements using accent |
|---|---|
| Home | Weight value, sparkline, CTA text, CTA chevron, 1K total, wordmark SVG |
| Analytics | Weight value, 1K total, pace badge bg, loading spinners |
| Weight | Goal display values, save button bg, edit title, delta notable |
| Log | Current routine card border, the primary-action fill, A/B active segment, dots and glyphs. Its **copy** — current note title, subheadings, mode toggle, switch/create buttons — moved to `accentText` / `chipAccentText` in #918 |

Home has the highest orange density — 6 distinct elements. The wordmark is fixed (brand), but the remaining 5 compete for attention inside a single scroll view.

### SectionTitle Usage

| Screen | Between-card SectionTitles |
|---|---|
| Home | none — Home does not import `SectionTitle` |
| Analytics | "Strength", "Progressive Overload", "Weight Trends", "Routine Health", "Recovery" |
| Weight | "Goal", "Trends", "Goal History", "History" |
| Log | "Recovery", "More Routines" |

On Analytics/Weight, SectionTitles separate genuinely different content areas with many items each. Home relies on card content alone to communicate section purpose. `LogRecoverySection` and `LogPreviousRoutines` both render their heading through the shared `SectionTitle` component (`UI.js`), so `Recovery` and `More Routines` already match in size, weight, color, casing, and spacing (#771) — no separate token or override exists for either.

## Earlier Home 1K layout

Home is the **compact-summary** treatment (#763): the breakdown is plain data
(no chart, mapping, or explanation — those stay Analytics-owned). Progress
bar, unit suffix, and per-lift value/label typography are normalized against
the [Analytics owner card](ui-analytics.md#1k-progress-card). The hero total itself spreads `HeroMetric.hero`
just like Analytics' — #763 gave it a smaller `32`/`800` override to signal
the compact-vs-owner distinction, but that read as a visual demotion of a
primary progress summary, so #771 restored the shared hero scale; the
compact-summary role is now carried by scope (no chart/mapping/explanation),
not a shrunken total.

**Header stays the handoff (#820).** The 44dp header tap-target box, stacked
on top of the card's `24` padding, left ~78px of empty space before the hero
number the card exists to show. A footer-link split (moving the handoff below
the grid) was tried and reverted — it broke the header-is-the-handoff pattern
shared with Exercise Progress and Analytics for one card without applying it
to the others. The fix is instead a trimmed card top padding (`24` → `14`) and
`gap` (`10` → `6`) around the still-44dp header, so the space shrinks without
touching the touch target every Home handoff is held to. The Recovery card
got the identical treatment for the same reason.

| Element | Property | Value | Line |
|---|---|---|---|
| Card padding / paddingTop / gap | `24` / `14` / `6` | | `1289` |
| Card borderRadius | `16` | | `1289` |
| Header (`home-one-k-link`) | minHeight | `44` (no fixed `height`) | |
| | label fontSize / fontWeight | `12` / `800`, uppercase | |
| | color | `colors.textMuted` | |
| Hero total value | fontSize | `48` (`HeroMetric.hero`) | `1153` |
| | fontWeight | `900` (`HeroMetric.hero`) | `1153` |
| | color | `colors.accentText` lerped toward `colors.success` as progress nears 1000 (inline override, always applied — `oneKHeroValue`'s own `colors.text` is never seen, `729`) | `1153` |
| Hero unit | fontSize | `16` | `1157` |
| | color | `colors.textMuted` | `1157` |
| Progress bar | height | `8` | `1165` |
| | background | `colors.divider` | `1165` |
| | fill | `colors.accent` | `1173` |
| | borderRadius | `4` | `1165` |
| | marginBottom | `16` | `1165` |
| Breakdown value | fontSize | `16` | `1194` |
| | fontWeight | `700` | `1194` |
| | color | `colors.text` | `1194` |
| Breakdown label | fontSize | `11`, uppercase | `1199` |
| | fontWeight | `600` | `1199` |
| | color | `colors.textMuted` | `1199` |
| Breakdown dividers | borderWidth | `1` | `1187` |
| | color | `colors.cardBorder` | `1187` |

The vertical `borderLeft/Right` breakdown dividers (vs. Analytics' single
`borderTop` above the whole row) stay an intentional structural deviation —
Home's three-column grid reads at a glance, Analytics' row sits under its own
divider ahead of the chart and info disclosure beneath it.

---
