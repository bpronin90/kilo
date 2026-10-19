# Recovery Evidence and Management UI

For maintainers changing Recovery evidence, disclosure, accessible measures, and the Log-owned Manage block. Shared state and write verification are owned by [Recovery State](../architecture/recovery-state.md).

### Recovery Section (`AnalyticsRecoverySection.js`)

Placement (#1347; see [Analytics ordering](ui-analytics.md#analytics-screen)): during active Recovery this
section leads the tab, above Weight Trends and the collapsed baseline-training
disclosure; otherwise it closes the tab after Routine Health, and only while it
has something to render (completed-block history, loading, stale or error).
Completed history stays inside this section. Recovery keeps `HeroMetric` +
per-exercise meters; Routine Health keeps `SessionGauge` + its Session
Check-ins card, with no shared measure between them.

Progressive disclosure (#758, R5b, restructured #1315): the section answers "how
close am I to my normal training?" before it shows any evidence, and it is
**read-only**. Under the one `Recovery` `SectionTitle` it is two sibling cards
(never nested): **card 1** = headline `%` + ONE caption → week rows (the sole week
selector, #1307) → quiet block context (`Baseline`, `Started {date}` with its info
button, read-only `Reason`, and at most one `Manage in Log` link); **card 2** =
the per-exercise disclosures (`Lifts`, `Movement groups`, `N not retested`,
`N not scored for strength`). **ONE disclosure rule** for every per-exercise
list: collapsed by default, a `>=44dp` header with a counted title/caption and a
`MaterialIcons` chevron (`RecoveryDisclosure`), reset to collapsed when the block
or week changes. The strength ladder and the older Exercise details overlapped
(both are per-lift evidence for the same baseline lifts), so they are ONE `Lifts`
disclosure with ONE list: each lift's row shows its strength % and expands to its
raw Load/Total-work evidence (`WeekEvidence` rows decorated by the snapshot's
strength lifts), instead of two parallel lists.
**Recovery numbers come from one snapshot; surfaces never re-derive** (see
`lib/data/recoverySnapshot.js`): Home's Recovery panel and this section read the
same frozen object. **Maintenance lives only in
Log** (reason, inclusion, reopen, rebuild baseline, match/tidy names,
movement-group overrides — Log's Manage block, below); Analytics renders no write
control. Every sentence the compact view no longer prints is in an accessibility
label, the `About these numbers` explainer or a named disclosure.

| Element | Property | Value |
|---|---|---|
| Strength headline | style | Same as Weight Trends `weightValueLarge` (#1219): KUA `metric-display-mobile` `32`/`36` `onSurface`; legacy `36`/`800` `accentText` — the average % of baseline strength (#1305), floored so a below-100 value never reads 100; the first in-card content, no title-like caption above it |
| Strength caption | fontSize / weight | `13` / `600`, `textMuted` — ONE caption, `{N} lifts · Week {n}` (N = the headline cohort). Nothing else is printed beside the number: the routine name, coverage (`Average of N lifts scored every week · N of R baseline lifts`, R = full roster), cohort names, excluded weeks and dropped lifts are in the summary's accessibility label and the `About these numbers` explainer. No honest average: one short reason line (never a 0%) |
| Summary group | accessibility | `accessible` + `accessibilityLabel` inside the card's `accessibilityLiveRegion="polite"` region so a week change is announced without scrolling |
| Week rows (sole selector, #1307) | `RecoveryStrengthWeeks.js` | `Week by week` caption above one **pressable row per live week** (stable `week_id`, one row per live week including a single week; the retired `RecoveryWeekPicker` chips are gone, so there is no second selector). Row: `Week N`, the as-of bar + `N%`, or an explicit `No average` / `No data` (missing or unreadable week, still selectable so its notice shows) / `Select to view` (a week later than the selection) / `Not scored` (legacy baseline); `minHeight 44`, `accessibilityRole="button"`, `accessibilityState.selected`, full label (`Week N: 74% of baseline strength`). Selected = `surfaceSection` fill AND bold label (never colour alone). Default is the latest week; the selection persists across evidence updates while the id exists, falls back to the latest when it is removed, and resets when the focused block changes. Selecting re-derives the headline, ladder, group scores and as-of pace together |
| Lifts disclosure header | title | `Lifts` + `{N} scored · {M} in details`, `minHeight 44`, `accessibilityState.expanded`, collapsed by default; body = the roster summary and ONE per-lift list: each exercise row (`recovery-exercise-row`) carries, for a scored lift, its strength half (%, bar, `best / baseline unit`, compact pace) and its raw Load/Total-work evidence on demand behind the row's tap — a lift is listed once, never in a second list. Row statuses, band marks, the roster summary and trained-elsewhere notes are READ from the Recovery snapshot (`bandById`, `detailSummary`, `trainedElsewhere`); no row or summary derives anything |
| Roster summary | `RecoveryRosterSummary` | Inside the Lifts disclosure body (no longer under a separate header): the text-led `7 trained · 20 not yet · 5 added` tokens (unchanged derivation, whole-token wrapping layout, accessible label with every state count) |
| Disclosure chevron | icon | `MaterialIcons` `expand-more`/`expand-less`, `18`, `textMuted` (app-wide convention), every disclosure |
| **Exercise row** | `recoveryVisualStyles.js` `ex*` | name `15` / `700` `text`; `8` dot (graded token, or the shared neutral for not-graded rows) + plain status word `13` / `600` `textMuted`; one thin `6` bar (band token on `surfaceSection` track, fill capped at 100%) with the measure-named uncapped percent `13` / `800` (`Total work 11%`, `Reps 66%`, `Time 45%`); numbers `13` `textMuted` (`Load 135 lb / 135 lb`); full sentences only in `accessibilityLabel` |
| Completed header (collapsed, #1461) | `AnalyticsRecoverySection.js` `recovery-ended-header` | One deliberate summary row, outcome first: primary `{N}% total recovery` (`body-md` `800`; or the unavailable message — never a fabricated %), then qualifiers (`From last saved data`), then `Completed · N weeks`, then ONE quiet ellipsized line `{reason} · {routine}`, and the chevron. No `Ended` prefix and no date range here — dates live only in the expanded block context and history rows, never in two layers. The spoken label keeps the full `…, Week N` wording |
| Block context | `contextBlock` / `contextRow` | ONE quiet labelled list under a single divider (`13`; label `600` `onSurfaceVariant` on a shared `68` minimum-width column so values align at ordinary widths, relaxed to each label's own width when the window is under `300` wide or `fontScale >= 1.6` so a date is never squeezed; value `onSurface`; every row `minHeight 44`, no dead gap): **`Started {date}`** (active) or **`Dates {start} – {end}`** (completed; a narrow card wraps between the two whole dates) with the shared `InfoButton` (#1245; `About these numbers`, real `44x44`, glyph `18`) directly AFTER the `Started`/`Dates` label, before the date, by an ordinary `8` row gap — beside the label it explains, never margin-pushed to the card edge, with NO negative margins (its whole 44x44 box is reserved, so it cannot overlap the date or start outside the row); when label + date + button cannot share a line the whole button wraps to the next line, left-aligned at the row edge — and the non-medical note (`Training numbers only. Not a medical judgment — only you end a Recovery block.`) revealed right under it in the same always-mounted polite live region; a quiet read-only **`Reason {value}`** row (first, when a reason exists) (up to two ellipsized lines, no control; editing lives only in Log's Manage block, #1307/#1315); since #1461 the block reads **Reason (when present) → `Baseline {routine}` (one line, ellipsized) → `Started`/`Dates`**, the date last as quiet provenance and the only link is a quiet `Manage in Log` row (`>=44dp`, `onNavigate('Log', { kind: 'recovery-manage', blockId })`). Each row is announced ONCE: the visible label (`Started`/`Dates`/`Baseline`) is hidden from assistive tech (`accessibilityElementsHidden`, `importantForAccessibility="no"`) and the adjacent value's accessible label carries both (`Started 08-08-2026`, `Baseline: {routine}`); a read-only Reason row is one grouped element (`Reason: {value}`). Dates are never ellipsized or squeezed mid-number: the date row wraps (the info button wraps whole to the next line if label + date + button cannot share a line) and each date stays whole. Shared `Card` chrome, no local gap |
| Completed-block history | default | collapsed, summary header states the count and the latest block |

**Exercise row** (#1219) replaced the counted state-group headers and the metric
legend: each row carries its own mark and plain status word. Three are graded
(`At or above`, `Rebuilding`, `Early`); three are not graded and keep their
plain words (`Not trained yet`, `Can't compare`, `Added during recovery`). The
status comes from the existing return-band derivation for that one row, with the
derived `close` bucket folded into `Rebuilding` (below).

**Three visible bands and a quiet bucket** (#1219): Analytics shows graded states
`At or above`, `Rebuilding`, `Early`. This is a PRESENTATION-ONLY grouping:
`deriveRecoveryWeekBands`, its six buckets (`at_or_above`, `close`, `rebuilding`,
`early`, `cannot_compare`, `not_trained_yet`), `RETURN_BANDS`, `_bandForRow` and
the 90% / 50% thresholds are unchanged and still sum to the roster; Home,
Overview and history read them as before. At render time `close + rebuilding`
becomes the single `Rebuilding` count (`gradedCounts` / `displayBandId`,
`RecoveryVisuals.js`), so a trained-but-not-met row at 50% or more of its
limiting measure reads `Rebuilding`, `Close` is never named or colored, and two
adjacent counts are never shown. `Not trained yet`, `Can't compare` and `Added
during recovery` are not judgments: they keep their words, share ONE quiet
neutral mark/count (the existing `onSurfaceVariant`; no new token), and never
enter a colored segment. Only Analytics Recovery shows these names and colors,
on two surfaces that share the same names, merged counts, tokens and quiet
wording: the `RecoveryRosterSummary` text tokens (collapsed and expanded, no bar)
and the exercise rows. Its accessible label names every state count, zeros
included (`At or above 1, Rebuilding 2, Early 0, Not trained yet 0, Can't
compare 0, Added during recovery 0`), and never announces a separate Close count.
Home renders none of this (see [Home Recovery Status Card](ui-home.md#recovery-status-card-757)).

**Strength view** (#1305, compacted #1315): the Analytics Recovery card leads
with strength relative to the frozen best set. `RecoveryStrengthSummary` is the
one primary selected-week summary: the KUA metric hero tier (32/36) average % and
one `{N} lifts · Week n` caption. `RecoveryStrengthWeeks` (label + bar/gap +
value per week, no caption) and `StrengthLiftSummary` (the strength half of each per-lift row) share ONE percent scale
(`strengthScaleMax`: 100, or the next 10 above the largest value) with an
on-surface ink 100% reference mark and the court primary fill on the section
track; the `Bars run 0-N%` legend is in the explainer. Each scored lift row is
name, %, bar, ONE `best / baseline unit` line (`155×8 / 250×6 lb`) and a compact
pace (`90% ~2 wk · 100% ~4 wk`, `need 3 wks`, `no gain`, `reached`, `pace
hidden`); the full best-case pace text (rate, week window, insufficient / no-gain
/ suppressed) is in the row label and the explainer. Lifts with no score this
week or ever live in the `N not scored for strength` disclosure (identities
de-duplicated), lifts with no entry this week in `N not retested`. An unreadable
week is a dashed `No data` gap. No warning/amber ink. Styles:
`recoveryStrengthStyles.js` (`disc*` for the shared disclosure).

**Movement groups** (#1306): `RecoveryMovementGroups`
(`components/recovery/RecoveryMovementGroups.js`, styles
`recoveryMovementGroupStyles.js`) is one collapsed-by-default header under the
strength ladder, not a second hero (the shared `RecoveryDisclosure`; an unavailable
saved-choice read adds a concise `saved choices unavailable` to its caption, with
the full notice on demand). Expanded, each group is a flat row (name, compact
`{scored}/{cohort} scored · {baseline} baseline` — the full `N of M lifts in the
average scored · B lifts in the baseline` wording is its label — and the
mean % or `No score`, never 0%) that discloses its exercises; no nested cards.
The read-only numbers are separate from the controls: the per-exercise editor
(`MovementGroupEditor.js`) lives only in Log's Manage block (#1307, #1315), under a collapsed
`Movement groups` header (`Choose which group each lift counts in.`) listing
every baseline lift plus lifts added during recovery as `{group} · Automatic|Your
choice`. Its `Change group` button, eight single-choice radio options (selected = radio glyph
plus bold text) and `Reset to automatic` are all >=44dp with role/name/state;
a failed save keeps the choice as an unsaved draft with `Not saved: <reason>`.
Notices (failed read, missing routine, unreadable map, paused) use 13sp caption
ink. Court tokens only.

**Manage block** (#1307, moved to Log by #1315): `LogRecoveryLifecycle`
(`components/recovery/LogRecoveryLifecycle.js`, rows in `LogRecoveryManageBlock.js`,
chrome `logRecoveryStyles.js` / `logRecoveryManageStyles.js`) is the ONE
maintenance surface for a block, active or completed, in the Log tab's Recovery
view: a sibling `Card` (never nested), collapsed by default, with a >=48dp
trigger (`Manage block`, chevron, `accessibilityLabel` `Manage recovery block:
{routine}`, `expanded` state) that is never disabled. With writes locked (no
verified state, a pending write or an inline note edit) the opened card says
changes are paused; with only a stale read it says that matching or tidying names
and movement groups are paused until Recovery data is current. Flat rows divided
by hairlines, in this order: Reason (row + inline editor), `Counting in normal
analytics` (the row is the switch, with its help sibling), Rebuild baseline,
Match exercise names, Tidy names, Movement groups editor, Reopen (newest
completed block only, no active block; the existing confirm and domain recheck),
then — active block only — `Unlink Week {N}'s note` and `End recovery block`.
Each action owns its own row, so an ineligible action leaves no empty row. A card
exists per focused block and stays mounted while another block is focused (the
unfocused card is `display: none`, `accessibilityElementsHidden`,
`importantForAccessibility="no-hide-descendants"`); within a card the body mounts
on first open and stays mounted while collapsed, so an in-flight write keeps its
busy state, draft and error across collapse AND block switching, and nothing
reaches another block. Opening, closing or switching writes nothing.
**Recovery Blocks** (`LogRecoveryHistory.js`, renamed from Recovery History in
#1331 because it includes the active block): a collapsed `>=48dp` header
(`Recovery Blocks`, captioned `1 active · N completed` or, with no active block,
`N completed blocks`) lists the active block (when present)
and every live completed block, newest completed first, as `>=48dp` rows with
`selected` state. It renders ABOVE the focused Manage card (#1329), so a pick
reads top-down: choose the block, then manage it directly below. Choosing one
focuses its single Manage card, opens it and scrolls it into view via the same
reveal a navigation intent uses (#1321) — a pick never changes an off-screen card
silently. The Recovery tab is
reachable in a completed-only verified state (not the default view). A
`recovery-manage` navigation intent from Analytics selects and expands that exact
block id (repeats work via the shell nonce, scrolls the card into view) and shows
an explicit unavailable notice for an unknown or deleted id; it waits for the
verified read. Analytics history week rows stay focus targets
(`Show evidence for {routine}, Recovery Week N, {state}`) as one compact
>=44dp `Week N · state` row; Analytics history has no `View note in Log` link
(#1442). Not-retested / not-scored disclosures group lifts that share a reason
onto one line instead of repeating the reason per lift.

**Tidy names** (#1309): `TidyRecoveryNamesAction` (`components/recovery/TidyRecoveryNames.js`,
styles `recoveryTidyStyles.js`) is the single name-cleanup action in Log's Manage block, placed after `Rebuild baseline` and `Match exercise names`
(the same reason-editor button/caption tokens; every control is a >=44dp button
whose accessible name is its visible label). The preview (`recovery-tidy-preview`)
is the plan captured when it opened and lists every week header as `Week N: old →
new` with the scheme it keeps and the note the descriptor moves to (only a compact
leading scheme such as `3x6-8` is promoted to the header and cut out of the moved
note, never repeated in it; any other scheme-like text stays in the note
untouched, #1314), each baseline
`old → new`, every already-clean occurrence, warmups (never changed), skipped
lifts with reasons, and an explicit no-change line; one Confirm applies the whole
plan, and Cancel/Close write nothing. A partial failure shows its error in the
card and the action is simply run again. The card mounts keyed by block id, so
draft and error state never cross blocks; it is locked by the same
verified-state/pending gates as the other Recovery writes (hosted in Analytics'
Manage block from #1307 and in Log's Manage block since #1315).

**Detail order** (#1219): rows follow the routine, not a state ranking. Baseline
exercises the week logged come first, then baseline exercises not yet trained
this week, each group in the baseline's own row order, then added-during-recovery
rows in the order they first appear in the selected week's note
(`compareWeekWorkToBaseline` keeps the parsed note's `Map` insertion order; it no
longer sorts `added` by normalized key; `orderDetailRows`, `RecoveryStateGroups.js`,
adds no sort of its own). Nothing is alphabetized. A v2 baseline stores rows in
the routine's original order (`routine_order` equals the array index), which the
comparison preserves; a retained v1 baseline is alphabetical and has no routine
order, so it is shown exactly as stored. A not-comparable row counts as logged
only when the week did log that exercise.

**Exercise bar** (#1219): only compared rows draw a bar, and it is the weighted
work measure, never the limiting (lowest-ratio) dimension: `Total work`
(`volume`) for weighted exercises, `Reps` for reps-only, `Time` for time-based.
The visible percent and the first evidence sentence of the accessible label name
that same measure (`Total work 11% of baseline, 670 lb of 5850 lb`); the fill is
capped at 100% while the text is not. This is presentation only: the band and
`baseline_met` (weighted needs BOTH load and volume) are derived upstream and
unchanged, so a deadlift above baseline load but at 11% Total work reads `Early`
with an 11% bar. Because the band is graded on the limiting measure while the bar
shows Total work, the two can differ (load 66% but Total work 133% reads
`Rebuilding` with a full bar); the visible `Total work 133%` and the spoken label
name the measure the bar shows. The bar line WRAPS: the track grows to fill it
with a `96` floor, and the measure label (never truncated, `maxWidth: 100%`)
drops under the bar when it cannot sit beside it, so a 4-digit percent at large
text or a ~250dp card cannot overflow or clip. A not-trained row shows baseline numbers and no bar, so missing
is never drawn as zero.

**Recovery band tokens** (#1219): every graded mark (row dot, bar fill, hero and
summary segments, legend dots) resolves through three KUA tokens in
`mobile/theme/colors.js`, defined independently per court and mode (no shared
graded colors; legacy palette fallback only when no court palette is resolved).
Every not-graded mark/count (`Not trained yet`, `Can't compare`, `Added during
recovery`) uses the EXISTING `onSurfaceVariant` neutral; `recoveryBandClose` and
`recoveryBandUnavailable` do not exist. Tokens are marks, never text ink: the
plain status word beside every mark uses `onSurface` / `onSurfaceVariant`, so
color is never the sole carrier of status.

| Token | State |
|---|---|
| `recoveryBandAtOrAbove` | At or above |
| `recoveryBandRebuilding` | Rebuilding (derived close + rebuilding) |
| `recoveryBandEarly` | Early |
| `onSurfaceVariant` (existing) | Not trained yet, Can't compare, Added during recovery |

| Palette | At or above | Rebuilding | Early |
|---|---|---|---|
| Hard Court light | `#00704C` | `#A66300` | `#B3261E` |
| Hard Court dark | `#34D399` | `#FBBF24` | `#F2705C` |
| Clay Court light | `#1E6B43` | `#9A5F00` | `#A8311C` |
| Clay Court dark | `#4FBF7F` | `#E5A93C` | `#F0805F` |
| Grass Court light | `#17692F` | `#8F6A00` | `#B52A2A` |
| Grass Court dark | `#4ADE80` | `#E5B83C` | `#F26E6E` |

Contrast and distinguishability contract, computed (not asserted in prose) in
`tests/theme-rendering.test.js` for all six palettes: each of the three graded
marks AND the shared neutral is at least **3:1** (WCAG non-text) against both
`surfaceCard` and the `surfaceSection` bar track (shipped minimums: 4.77:1 card /
4.27:1 track light, 5.77:1 / 6.12:1 dark); the status label ink (`onSurface`,
`onSurfaceVariant`) stays at least **4.5:1** on `surfaceCard`; the three graded
marks of a palette differ pairwise by at least CIE76 **delta-E 30** (shipped
minimum 33.3, Clay Court light) with no equal values; and no court shares a
graded value with another court in the same mode.

Wording is part of the contract, not decoration:

- The headline is strength relative to the frozen best set (#1305), an
  average over one stated, consistent set of lifts. It is separate from the
  per-exercise `Baseline met` criterion and never completes a block.
- `Total work` replaces `Volume` (load × reps across completed working sets) and
  `Load` is the heaviest completed working set that week. The visible rows no
  longer print definition sentences; they use only these short labels.
- No-week, note-missing, and note-unreadable copy matches Home's R3a wording
  exactly: `Baseline captured. No week logged yet.`; `Week N — This week's
  note is no longer available.`; `Week N — This week's note couldn't be
  read.`
- A week whose linked note is missing or unreadable states that **above** the
  disclosure, which is not rendered at all — a collapsed panel is never the
  reason evidence is absent. Loading, stale, retry, and unverified copy is
  unchanged and still comes from the recovery state contract.
