# Analytics UI Contract

For maintainers changing evidence ordering, strength, weight, and progression displays. Recovery evidence has its own [UI contract](ui-recovery.md).

## Analytics Screen

Source: `mobile/screens/AnalyticsScreen.js`

Analytics is the evidence surface; Home owns the summary, so there is no
Overview card. The legacy `overview` navigation id still means scroll offset 0.
Ordering lives in `screens/analytics/AnalyticsLayout.js`
(`orderAnalyticsSections`, pure):

- **Normal training:** Strength → Routine Health → Progressive Overload →
  Weight Trends → Recovery history (only when the Recovery section has
  something to render).
- **Active Recovery:** Recovery → Weight Trends → `Baseline training · paused
  during Recovery` disclosure (collapsed by default) holding Strength →
  Progressive Overload → Routine Health. Ending Recovery restores the normal
  order.

Strength owns the 1K/Big 3 evidence; Big 3 Mapping sits under the 1K panel,
collapsed by default with a one-line summary of the mapped lifts. Progressive
Overload (`AnalyticsProgressiveOverload.js`) is its own top-level section: the
canonical Exercise Progress counts (`analytics.exerciseProgress`), progression
suggestions, search/collapse controls and the table; tracked-span/inherited and
column methodology sits behind its `ⓘ`. Routine Health wraps `SessionGauge`
(`showTitle={false}`, the section titles it) over `deriveRoutineStatus()`, plus
the Session Check-ins card when fatigue tracking is on.

### Weight Trends Card

| Element | Property | Value | Line |
|---|---|---|---|
| Card padding | `20` | `356` |
| "Latest weigh-in" label | fontSize | `12` | `365` |
| | fontWeight | `700` | `366` |
| | textTransform | `uppercase` | `367` |
| Weight value | fontSize | `32` | `372` |
| | fontWeight | `900` | `373` |
| | color | `colors.accentText` | `374` |
| Chart | height | `100` | `166` |
| Window selector (`7D` / `30D`) | one chart; swaps `rolling7` ↔ `rolling30`, clears selection; radio role, `>=44dp` | | |
| Pace badge | borderRadius | `12` | `379` |
| | text fontSize | `12` | `387` |
| | text fontWeight | `800` | `388` |
| Footer stat value (7d/30d avg) | fontSize | `18` | `403` |
| | fontWeight | `700` | `404` |
| Footer stat label | fontSize | `11` | `408` |
| | fontWeight | `600` | `409` |
| | textTransform | `uppercase` | `410` |
| Footer divider | borderTopWidth `1` / `colors.cardBorder` | | `394-395` |

### 1K Progress Card

| Element | Property | Value | Line |
|---|---|---|---|
| Card padding | `24` | `413` |
| "1K PROGRESS" label | fontSize | `14` | `419` |
| | fontWeight | `700` | `420` |
| | textTransform | `uppercase` | `421` |
| | color | `colors.textMuted` | `421` |
| Total value | fontSize | `48` | `424` |
| | fontWeight | `900` | `425` |
| | color | `colors.accentText` | `426` |
| Breakdown divider | borderTopWidth `1` / `colors.cardBorder`, paddingTop `16` | | `433-436` |
| Breakdown value | fontSize | `18` | `443` |
| | fontWeight | `700` | `444` |
| | color | `colors.text` | `445` |
| Breakdown label | fontSize | `12` | `447` |
| | color | `colors.textMuted` | `448` |

### Strength Section (`AnalyticsStrengthSection.js`)

| Element | Property | Value | Line |
|---|---|---|---|
| Section wrapper | gap | `16` (`strengthSection`) | `171-173` |
| 1K card | padding / bg | `24` / `panelBackground` (ArtisanalPanel) | `174-179` |
| 1K label | fontSize / weight | `12` / `800`, uppercase, `letterSpacing: 1` | `180-186` |
| 1K value | style | `HeroMetric.hero` (single hero metric) | `187-190` |
| Big 3 Mapping card | header | collapsible `Pressable`, default collapsed with mapped-lift summary | `111-125` |
| Big 3 title | fontSize / weight | `12` / `700`, uppercase, `textMuted` | `297-303` |
| Big 3 / info collapse | icon | `MaterialIcons` `expand-more`/`expand-less`, `14-16`, `textMuted` | `119-124`, `79-84` |
| 1K explainer (#1245) | shared `InfoButton` | icon beside the `1K Progress` label (`What is 1K Progress?`); copy in an `InfoNote`, default hidden | `AnalyticsStrengthSection.js` |

### Progressive Overload Table (`AnalyticsProgressiveOverload.js`)

| Element | Property | Value | Line |
|---|---|---|---|
| Section | gap | `8` (`poSection`); not sticky — it no longer ends the tab | |
| Exercise Progress counts | three columns | `poSummaryCount` metric display over uppercase `label-sm` | |
| Column header row | paddingHorizontal / paddingBottom | `16` / `4` | `403-407` |
| Column label | fontSize / weight | `11` / `800`, uppercase, `letterSpacing: 0.5`, center | `408-416` |
| Group section | paddingBottom / border | `4` / 1px `divider` top (between groups) | `426+` |

Grouping (`analyticsDerivations.js` `deriveGroupedSignals`): sections are merged
by a **normalized leading-day key** (`MONDAY — Push` and `MONDAY — Push / Chest`
→ one `MONDAY` group), with exercise dedup on merge, so a note with gym+home
weeks no longer shows a day twice (#383/#385).

---
