# Kilo hybrid, revision 3: compact averages on Weight, latest weigh-in on Bodyweight

**Design only.** No production code was changed, nothing was committed, and no issue, PR or Codex work has started.

- **Prototype:** `hybrid-v3/index.html`, built from `hybrid-v2/`. Revision 2 is kept unchanged as the "before".
- **Screenshots:** `../shots/hybrid-v3/` (390×844 @2x, in hard-dark and clay-light). Regenerate them with `node ../capture-hybrid-v3.cjs`.
- **Unchanged:** everything else from revision 2, including the four chapters, the sticky index, and Home, Log and More. See `../hybrid-v2/README.md` for that revision's structure and dependencies.

## 1. Weight: compact trend restored

- **Latest panel layout:** the 7-day avg and 30-day avg now sit on the right of the existing Latest panel, behind a hairline divider.
  - Each is a small mono label over a 17px mono value plus its change.
  - Latest weight stays the hero (44px), and the panel grows by only about 8px.
- **No chart, no new card.** The link row is shortened to "Full trend in Analytics" and still opens Analytics › Bodyweight.
- **Order unchanged:** weigh-in entry, then Latest, Goal, History and Goal history.

## 2. Analytics › Bodyweight: latest weigh-in made unmistakable

- **Latest weigh-in metric:** a labelled metric opens the existing Bodyweight panel. It sits top-left, with the 7D/30D toggle top-right and no extra card.
  - The value is 36px mono. That is deliberately a step below the 44px heroes elsewhere, so it is strong but proportionate.
  - Under it are the measurement date and the change vs the previous weigh-in.
- **Distinct from the averages:**
  - The latest weigh-in is the large number above the chart, and the chart marks it with a hollow ring at its real date.
  - The 7-day and 30-day averages stay as smaller figures in the row below the chart, and the averages are the line.
  - The caption names all three: weigh-ins, line, ring.
- **Unchanged:** the chart, point selection and callout, the goal line, the 7D/30D behaviour (it swaps the average line, not the range), and the goal/pace rows. The ring stays visible while a point is selected.
- **Active Recovery:** the same chapter renders in both modes, so the change applies there too (`compare-bodyweight-active-recovery`).
- **Removed:** the "43 weigh-ins" header label. The count now sits in the chart caption.

## Trend indicators

Every change value has a direction arrow and a sign, coloured by **goal direction**. This is production's `weightTrendTone` rule: movement toward the goal uses the completion (positive) colour, movement away uses the error-text (negative) colour, and zero is neutral. The fixture is Cutting, so the falling values show green with a down arrow.

Revision 2 coloured every decrease green regardless of goal. Revision 3 matches production instead.

## Implementation dependencies

1. **WeightScreen Latest panel** shows the existing 7-day and 30-day average and change values (already on `weightSummary` / rolling7 / rolling30). No new calculations.
2. **`AnalyticsWeightTrendsCard`:**
   - Production already leads with "Latest weigh-in" (or "Selected · date"). The design keeps **Latest** fixed, puts the selected point in the chart callout instead, and adds the date and change vs previous under the value.
   - A small `LineChart` addition is needed: a latest-weigh-in ring marker.
3. **Change colours** use `weightTrendTone` with the goal direction on both screens. With no gain/loss goal, production's directional (gaining/losing) tone applies.
4. **Not modelled here:** production's pace badge (spike/notable) beside the latest value. It would sit in the same header slot, and it isn't drawn because the fixture has no anomaly.

## Screenshots (`../shots/hybrid-v3/`)

| What | Files |
|---|---|
| Weight at 390×844 | `weight-{hard-dark,clay-light}` |
| Weight, full length | `full-weight-{hard-dark,clay-light}` |
| Bodyweight at 390×844 | `analytics-bodyweight-*` |
| Bodyweight, point selected | `analytics-bodyweight-point-*` |
| Bodyweight, 30-day line | `analytics-bodyweight-30d-*` |
| Bodyweight, active Recovery | `analytics-active-recovery-bodyweight-*` |
| Before/after boards | `compare-weight`, `compare-bodyweight`, `compare-bodyweight-active-recovery`, `compare-crops` (close-ups of the two changed panels) |
| Raw close-up crops | `crop-{v2,v3}-{weight-latest,bodyweight-panel}-*` |
