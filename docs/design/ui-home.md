# Home UI Contract

For maintainers changing the Home summary and its handoffs. Analytics owns detailed evidence; calculations belong to [Calculations Reference](../product/calculations-reference.md).

## Home Screen

Source: `mobile/screens/HomeScreen.js`

**Hierarchy (#1339, visual summary #1341).** Home is an abstract of the app:
signals as numbers, bars and a chart, explanation left to Analytics. Normal
training: hero (current training / Exercise Progress / actions) → `1K Progress`
(total, 1K bar, Big 3 values) → body weight (value, goal, trend graph). Active
Recovery (open week or between weeks): ONE Recovery card is the training
surface — `Recovery · Week N`, the total as the hero number, Big 3 bars, and the
action strip — → body weight. No training hero and no 1K card render in Recovery. Home has no
generic Analytics footer — each section header deep-links to its own Analytics
section. Redesign v3 (#1605): the `ScreenShell` subtitle is retired; Home passes
`HomeTopBar` (`home-top-bar`) as the shell `header` — the Kilo wordmark (`header`
role, label `Kilo`) and a Cloud Sync status icon (`home-sync-status`, label
`Cloud Sync: {statusLabel}`, glyph from the shell-owned summary: running /
failed / pending / synced / never synced) that opens Cloud Sync. The icon is not
drawn outside the shell. Cards are R1 `Panel`s on a 16px gap; the hero is the
one `active` panel.

### Cloud Sync Notice (#737)

Rendered above every other tier, only when the shell-published summary carries a
notice. Queued work is informational and reuses the chip tone the shell's update
banner already uses; only a real failure takes the error surface.

| Element | Property | Value |
|---|---|---|
| Notice card (pending) | backgroundColor | `colors.chipBackground` |
| | borderColor | `colors.cardBorder` |
| Notice card (failed) | backgroundColor | `colors.errorSurface` |
| | borderColor | `colors.error` |
| Card wrapper (both) | padding / marginTop / gap | `16` / `12` / `8` |
| Title | fontSize / fontWeight | `14` / `700` |
| | color | `colors.text`, or `colors.error` when failed |
| Body | fontSize / color | `13` / `colors.textMuted` (no fixed `lineHeight`) |
| Action row | flexDirection / flexWrap | `row` / `wrap` |
| | columnGap / rowGap | `16` / `4` |
| Action (`Retry sync`, `Open Cloud Sync`) | minHeight | `44` (no fixed `height`) |
| Action label | fontSize / fontWeight / color | `13` / `700` / `colors.accentText` |

`Retry sync` renders only for the failed notice. Both actions are ≥44dp and the
row wraps, so an enlarged label at 320dp drops to a second line rather than
shrinking the target.

### Loading Placeholders (#737)

Home, Log, and Weight each render a local, **static** placeholder while a first
read is unresolved — no shimmer, no animation. There is no shared primitive;
each screen shapes its bars to the tiers it is about to paint.

| Element | Property | Value |
|---|---|---|
| Placeholder card | padding | `18` (Log, Weight — shared Card value, #1278); Home `16` on a `16` stack gap (Panel inset, #1605) |
| | borderRadius | `16` (matches `Card`) |
| | gap | `12` |
| Bar | backgroundColor | `colors.cardBorder` |
| | borderRadius / opacity | `6` / `0.6` |
| | height | `12`, or `36` for Home's hero bar |
| | width | `'35%'` / `'75%'` / `'100%'` — always relative, never fixed px |

Each placeholder is one `accessibilityRole="progressbar"` node with a screen-
specific label (`Loading your dashboard`, `Loading your workout notes`,
`Loading your weight history`), so a screen reader announces a load in progress
rather than reading a stack of empty containers.

### Recovery Status Card (#757)

Inside the populated-dashboard branch only. In active Recovery it is Home's
lead card (#1341): it uses the hero's `weeklyHero` surface (primary border),
replaces the training hero and the 1K card, and carries the `Log workout` /
`Log weight` strip (`HomeActionStrip`, Recovery-aware targets unchanged), so the
week is named exactly once. Non-active states (loading, unverified, pending
hold, stale with no active block) keep the compact message card below.

Rendering is decided by the AUTHORITATIVE recovery state
(`useRecoveryBlockState`, via `useHomeRecoverySummary`), not by the
ordinary-analytics boundary Home already gates its body on. The two are
different reads and only the first can say whether a block is active:

| Recovery state | Home renders |
|---|---|
| Verified, active block | The return-to-baseline summary (#779/#782, below) and the `Recovery` handoff |
| Verified and current, no active block | **Nothing.** Silence is a claim, and here a verified *current* read supports it |
| Verified but stale | `RECOVERY_STALE_MESSAGE` and `Retry recovery` — over the last-known-good summary when one was cached, and on its own when none was. A stale snapshot that happened to cache no active block is still one whose newest refresh failed |
| First read in flight | `RECOVERY_LOADING_MESSAGE`, and **no** retry — nothing has failed |
| First read failed | `RECOVERY_UNVERIFIED_MESSAGE` and `Retry recovery` — never silence |

Copy for the three non-ready conditions is the recovery state contract's own
(`hooks/entries/recoveryBlockHooks.js`), so Home, Log, and Analytics cannot
describe the same condition differently, and `Retry recovery` is the exact
control name that copy tells the user to tap (ui-design-rules §12).

**Active-block content (#779/#782, #1315; #1333; Big 3 hierarchy #1335).** Home
is the entry point, not a second evidence surface — but Squat, Bench and Deadlift
are what Kilo is built around, so they ARE the card. The active branch reads the
ONE Recovery snapshot (`getRecoverySnapshot`, the same frozen object Analytics'
section reads — **Recovery numbers come from one snapshot;
surfaces never re-derive**) via `useHomeRecoverySummary`'s unchanged `big3` and
`headline`. What stays on Analytics Recovery is the prose around them: the
headline caption (`N of M lifts back · avg …% · Week n`), the roster count line,
the week-scope explainer, and `Latest week:` wording. In order:

- **Header** — the mono label `Recovery · Week N` with an `Evidence ›` link
  opposite, one press target (`home-recovery-link`, a11y label `Recovery`, #1605),
  the identity label and the `Analytics › recovery` handoff
  (ui-design-rules.md §13). `home-recovery-week` is `Week N` from the snapshot's
  selected week (#1341: the note title is no longer shown on Home); with no week
  the header reads `Recovery`. Staleness is carried by the stale message.
- **Total** (`home-recovery-headline`) — the snapshot's `display.percent` as the
  card's hero number (`home-recovery-headline-value`: `{pct}%`, `metric-display`
  44/46 — the screen's one 44px number, #1605 — `completion` at ≥100%) with a
  muted `total recovery` label;
  absent when the snapshot has no total. With no total AND no Big 3 rows, the
  snapshot's reason prints instead (`home-recovery-headline-reason`).
- **Fallback status** — when the block or week cannot be compared, one plain
  line: `Baseline data for this block isn't available.`, `Baseline captured. No
  week logged yet.`, `This week's note is no longer available.`, `This week's
  note couldn't be read.`, or `No baseline exercises were captured for this
  block.` Carried Big 3 statuses still print under a note-status fallback (#1318).
- **Big 3** (`home-recovery-big3`, shared `HomeBig3Bars`) — `home-recovery-lift-{squat,bench,deadlift}`
  rows in the effective 1K selection's names (#1192): name left, value right
  (`home-recovery-lift-{slot}-value`: the snapshot's floored `%`, or `Not in
  baseline` / `Not retested` / `Not scored` / `Unknown`), a muted `Week k` age
  marker (`-age`) only when the score is carried from an earlier week, and a
  progress track filled only by a real score (`completion` at ≥100%).
- **Stale message** — the existing `RECOVERY_STALE_MESSAGE`, only when stale,
  with `Retry recovery`, under the last-known-good Big 3.

The inclusion clause stays off Home (#820). The region carries one composed
`accessibilityLabel`: week, the snapshot's `{pct}% total recovery` headline,
fallback, `Big 3`, then each lift's snapshot `spoken` sentence.

No `on track`, prediction, or medical claim.

| Element | Property | Value |
|---|---|---|
| Active card | surface | R1 `Panel active` (padding `16`, KUA `primary` border) — #1605 |
| Message card (loading / unverified / pending) | surface | R1 `Panel`, padding `16`, mono label `1K recovery` |
| `Recovery` header (`home-recovery-link`) | minHeight | `44` (no fixed `height`) |
| | label | R1 `MonoLabel`, week inline after ` · `; `Evidence` KUA `label-lg` `12` uppercase `primaryOnContainer` + chevron |
| Total value / label | style | `metric-display` `44`/`46` (legacy `HeroMetric.hero`), `onSurface`; label KUA `body-sm` `onSurfaceVariant` |
| Big 3 name / scored value | style | KUA `label-lg`, legacy `body-md` / `700`; `onSurface` / `text` (value `completion` / `success` at ≥100%) |
| Big 3 status value | style | KUA `label-md`, legacy `body-sm`; `onSurfaceVariant` / `textMuted` |
| Big 3 age marker | style | KUA `label-sm`, legacy `label-sm`; `onSurfaceVariant` / `textMuted` |
| Big 3 track / fill | height / radius | `6` / `radius-xs`; track `surfaceBorder`, fill `primary` (`completion` at ≥100%) |
| Fallback status | style | KUA `body-md` `15`/`21`, legacy `16` / `700`; `onSurface` / `text` |
| Status line | fontSize | KUA `12`, legacy `13`; `onSurfaceVariant` / `textMuted` (no fixed `lineHeight`) |
| `Retry recovery` | minHeight | `44` (no fixed `height`) |
| | label | KUA `body-sm` `primary`; legacy `13` / `700` `accentText` |

No element in the card declares a fixed `height`, so every line grows with the
user's text size; the `Recovery` handoff remains the card's only navigation press
target and keeps its `minHeight: 44`.

The header handoff (`home-recovery-link`) is the label plus `Evidence ›` row
(#1605; the same chevron icon the other Home panel headers use), and targets the `recovery` section of the Analytics tab
(`onNavigate('Analytics', 'recovery')`) — the Recovery section itself, not just
the tab that contains it, the same section-id vocabulary `weight` and `strength`
already use and that is owned by `App.js`.

### Weekly Summary Hero Card

**Current structure (Redesign v3 #1605; supersedes #1456's order).** `HomeHeader`
is `Panel active` (`home-hero`). Top to bottom: the mono label `Current routine ·
Week N` (`home-routine-label`, the week in `home-routine-week` — the current
routine's weeks since its own start, omitted without a usable start; `Current
routine` / `No current routine` in the muted states, `home-hero-label`); the
routine title `home-routine-title` (22/28 headline, wraps); the Exercise Progress
row `home-exercise-progress-link` → `Analytics › progressive-overload` — a 96px
decorative ring (`HomeProgressRing`, segments in completion / on-surface-variant /
error tones, the canonical `classified` count in the centre over `EXERCISES`)
beside the `Exercise Progress` title and a three-row legend
(`home-progress-{progressing,steady,regressing}`: count then label) and a chevron.
The ring is hidden from assistive tech; the row's label carries `N progressing, N
steady, N regressing`. A first-session/inherited state replaces the legend with
`home-progress-baseline`. Then the two actions as 48dp buttons: filled `+ Log
workout` (`home-current-routine-link`) and outlined `Log weight`
(`home-weight-action`). With no current routine there is no week and no ring: one
line (`Pick a saved routine or write a new one in Log.`, or `Write a routine in
Log to track your weeks.`) and the primary reads `Choose routine` / `Write
routine`, still `onNavigate('Log')`. An empty current routine reads `Current
routine` with `Add exercises to this routine in Log to track progress.` In
Recovery the Recovery card replaces this hero (#1341) and carries the same two
buttons.

### Weight Goal Card

**Current structure (Redesign v3 #1605).** `screens/home/HomeWeightCard.js`
(`home-weight-card`) is the last card. Header: `Body weight` + chevron
(`home-weight-link`, ≥44dp) → `onNavigate('Weight')`, and the series range
caption (`home-weight-range`, `MM-DD – MM-DD`). Body (`home-weight-analytics-link`)
→ `onNavigate('Analytics', 'weight')`: the latest weigh-in (28px metric), the goal
line `home-goal` — mode (`Cutting`/`Bulking`/`Maintaining`) `· {target} {unit} ·
{N} weeks left` or `Goal ended` in the warning tone — only with a goal, and a
120×44 sparkline (`home-weight-trend`) over the existing
`dashboardData.weightSeries` in `chartSeries1` (neutral teal, not primary), the
latest point marked, and a dashed `completion` goal line
(`home-weight-goal-line`) only while the goal is active. Title and body are
siblings, never nested, so one press is one navigation; the body's label states
latest, goal and range. Fewer than two points: no sparkline. No weigh-in: `No
weigh-in yet` and the body is not a link. An ended goal or an unrealistic /
aggressive pace adds `home-goal-attention`: the Weight goal card's sentence in
`warning` and a ≥44dp `Review goal` action (`onNavigate('Weight')`). The legacy
`See weight trends` link is retired; the body link replaces it.

### 1K Club Card (Home)

**Current structure (Redesign v3 #1605; #1458's no-graph rule kept).** Home renders
its own `screens/home/HomeOneKPanel.js` (the shared `OneKProgressSummary` stays
Analytics'). Header: `1K Progress` + chevron (`home-one-k-link`, ≥44dp) →
`Analytics › strength`, and `N lb to 1,000` / `1,000 lb reached`
(`home-one-k-remaining`). Body: the existing total at 28px (`home-one-k-total`),
then ONE stacked 8px bar (`home-one-k-progress-track`): the Squat / Bench /
Deadlift segments (`home-one-k-bar-{slot}`, `chartSeries1..3`) sized by the
existing per-lift values, then a hatched remainder toward the target
(`home-one-k-progress-rest`); its label lists the three values and the remainder.
Below, a three-cell split (`home-one-k-big3`, `home-one-k-lift-{slot}` with a
series swatch, name and value). No per-lift track (#1444). No total yet: one line
(`home-one-k-setup`: `Log a session of each Big 3 lift to see your 1K total.`),
no bar, and cells only for lifts already logged.

The retired three-column geometry and #763/#771 comparison are retained in
[Compatibility Notes](ui-compatibility-notes.md#earlier-home-1k-layout).
