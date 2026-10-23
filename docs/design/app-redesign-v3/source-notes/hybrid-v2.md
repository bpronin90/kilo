# Kilo hybrid, revision 2: Analytics chapters and weight responsibilities

**Design only.** No production code was changed, and no issue, PR or Codex work has started.

- **Prototype:** `hybrid-v2/index.html`. Open it at ≥720px wide to see the state rail.
- **Before reference:** `hybrid/`, kept unchanged.
- **Screenshots:** `../shots/hybrid-v2/` (59 files, 390×844 @2x). Regenerate them with `node ../capture-hybrid-v2.cjs`.
- **Comparison boards:** the `compare-*.png` files in the same folder. Each places the before shot from `shots/hybrid/` beside the after shot.

Concept A and Concept B are untouched. Log and More are unchanged. Home has one change: the target of its weight sparkline.

## Tab responsibilities

| Tab | Weight role |
|---|---|
| Home | Compact sparkline (unchanged visually). Tapping it now opens **Analytics › Bodyweight**. |
| Weight | Data entry and management: quick weigh-in first, then latest weight, goal, history and goal history. **It has no chart.** |
| Analytics | The single authoritative weight visualization: the Bodyweight chapter. |

## What moved

- **The interactive weight chart moved from Weight to Analytics › 03 Bodyweight.** It keeps:
  - real weigh-in dates;
  - point selection with a callout;
  - the goal line;
  - the 7D/30D toggle, which changes the rolling-average series, not the date range;
  - the 7-day and 30-day average stats.

  Goal and target-pace context sit under the chart, and a row "Log or manage weight" links back to Weight.
- **Strength (1K) and Progressive Overload** now form **01 Progress**. 1K comes first with its existing-chart disclosure and Big 3 mapping, then Overload.
- **Training breakdown and Routine Health** now form **02 Training**. The breakdown itself is unchanged. The session check-ins strip sits inside the Routine Health panel instead of as a separate block.
- **Recovery history** is now **04 Recovery**.
- **The Weight screen order** is now: Log weigh-in → Latest → Goal → History → Goal history. Entry used to sit below the chart; it is now the first thing on the screen.

## What stayed

- Home, Log and More.
- Every sheet: breakdown drill-down, Overload detail, plates and info.
- The goal create / edit / archive / clear flow, the history filter / delete / show more controls, and Goal history.
- The 1K existing-chart disclosure.
- Breakdown's Last 4 / 12 / All and Movement / Muscles / Equipment.
- Recovery semantics.
- Deep links: the old section ids (`strength`, `breakdown`, `health`, `overload`, `weight`, `rhistory`) still resolve. Each maps to its sub-section anchor inside the matching chapter.

## What was removed

- **From Weight:** the hero trend chart, the 7D/30D average split and the "See full trends" link. A single row, "Trend and rolling averages in Analytics", replaces them.
- **From Analytics:**
  - the separate small "Weight trends" card (the full chart replaces it, so there is only one weight visualization);
  - the six-item section index (replaced by the four-item chapter index).
- **No capability was removed.** Everything that left Weight is available in Analytics.

## Chapter navigation

- **Index:** a sticky four-item index (Progress / Training / Bodyweight / Recovery) with no extra screens.
- **Chapter headers:** a mono number, a 22px title and a hairline. There are no intro paragraphs.
- **Tapping an item** smooth-scrolls to its chapter (see `nav-tap-*`).
- **Scrolling** updates the highlighted item (scroll-spy, see `nav-scroll-*`). The active item is scrolled into view inside the index if it would overflow.

## Active Recovery

- **Index:** Recovery / Bodyweight / Paused.
  1. **01 Recovery** is tagged Active and holds the recovery card and Recovery history.
  2. **02 Bodyweight** is the same chapter as in normal mode.
  3. **03 Baseline training** is tagged Paused. It is a dashed, collapsed toggle row. When open, the paused Progress and Training sections render below the row and are marked with a dashed left rule. They do not render inside a card.
- **Semantics are unchanged:** what is paused, what is computed and what is shown.

## Implementation dependencies and behaviour changes

1. **`WeightScreen` loses its chart** and the 7D/30D stats. Inline entry moves to the top. Goal and history are unchanged. *Behaviour change:* users who checked their trend on Weight now tap through to Analytics.
2. **`AnalyticsWeightTrendsCard` becomes the full chart.**
   - It gains point selection with a callout, the goal line, and the goal/pace rows.
   - It plots every weigh-in at its recorded date. A long history may need decimation in `LineChart`.
   - *New interaction:* the point callout on Analytics.
3. **The Home sparkline target** changes from Weight to Analytics › Bodyweight. This is a navigation change only.
4. **Chapter index.**
   - New: a sticky header inside the Analytics scroll, scroll-to-anchor, scroll-spy, and keeping the active item visible.
   - It replaces the hybrid's section index.
   - Deep-link callers that pass old section ids need a mapping from each id to its chapter or sub-anchor.
5. **Normal Analytics order changes** from production's Strength → TB → Health → Overload → Weight → Recovery history to:
   1. Progress: Strength, Overload.
   2. Training: TB, Health.
   3. Bodyweight.
   4. Recovery.

   This is a presentation-order change in `AnalyticsLayout.js` only.
6. **Routine Health:** the check-in strip merges into the Routine Health panel. The content is the same and only the container changes.
7. **Active-Recovery order.**
   - **Recovery history now sits directly under the recovery card**, in the Recovery chapter. Before, it came after the weight content.
   - **Inside the paused disclosure, the order is now** Strength → Overload → TB → Health. Production's order is Strength → TB → PO → RH.
   - **When expanded, the paused content renders outside the toggle card.**
   - These are presentation changes only.
8. **Carried forward from the hybrid, still open:**
   - the goal progress bar is a **new derived value** that needs a goal start weight;
   - please confirm the existing 1K session chart stays (see `../hybrid/README.md`).

## Screenshot index (`../shots/hybrid-v2/`)

| What | Files |
|---|---|
| Before/after boards | `compare-weight`, `compare-analytics`, `compare-weight-full`, `compare-analytics-full`, `compare-analytics-recovery` |
| Tabs at 390×844 | `{home,weight,analytics}-{hard-dark,clay-light,grass-light,clay-dark}` |
| Full length | `full-weight-*`, `full-analytics-*`, `full-analytics-active-recovery-*` |
| Chapters | `state-analytics-{progress,training,bodyweight,recovery}-*` |
| Bodyweight states | `state-analytics-bodyweight-point-*`, `-bodyweight-30d-*` |
| Deep link | `state-analytics-overload-deeplink-*` |
| Navigation | `nav-tap-{training,bodyweight,recovery}-*`, `nav-scroll-{midprogress,training}-*` |
| Active Recovery | `state-analytics-active-recovery-*`, `-bodyweight-*`, `-baseline-open-*`, `state-home-recovery-*` |
| Weight states | `state-weight-goal-edit-*`, `state-weight-history-*` |

Every state is captured in `-hard-dark` and `-clay-light`.
