# Calculations Reference

Human-readable explanations for how Kilo computes workout, weight, and goal numbers.

---

## Workout Analytics

### Weeks In

> Where you see it: Home screen summary card

How many sessions deep you are into the current routine. Looks at every exercise across all days and finds the deepest exercise history. Depth comes from logged session entries, skipped session entries, and legacy plain-row history, with the deepest count winning across the routine. That count is your Weeks In.

- Returns null if no routine is loaded, 0 if no entries are logged.

**Example:** A routine where Squat has 4 session entries (including skips) and Bench has 3 entries → Weeks In = 4.

If an exercise has mixed legacy and current history, plain rows still count. Example: 7 older plain rows plus 6 newer `session_entries` → Weeks In = 13.

### Exercise Classifications

> Where you see it: Home weekly summary chips, Analytics

For each tracked exercise, takes the last 3 session entries (newest last) and compares the two most recent logged (non-skipped) sessions.

| Condition | Classification | Display |
|-----------|---------------|---------|
| Latest session's top weight is higher than prior | Progressing | ↑ Progressing |
| Same top weight but higher total reps at that weight | Progressing | ↑ Progressing |
| Latest session's top weight is lower than prior | Regressing | ↓ Regressing |
| Same top weight but lower total reps at that weight | Regressing | ↓ Regressing |
| Same top weight, same total reps, identical rep distribution | Stalled | ↔ Steady |
| Only 1 logged session in the 3-entry window and a skipped entry is present | Inconsistent | ~ Inconsistent |
| Only 1 logged session, no skipped entries | Initial | Initial |
| No logged sessions | null | (hidden) |

Total reps means the sum of all reps performed at the top weight. For example, 125 lb for sets of 5, 5, 5 = 15 total reps. Next session 125 lb for 6, 6, 4 = 16 total reps → Progressing.

Classifications are derived on save from all workout notes aggregated together, then stored on the note object as `exercise_classifications`.

### Skip Markers

> Where you see it: not directly displayed; used to derive attendance flags

Scans each exercise's session entries for skipped positions (marked with — in the note).

- **Exercise skip:** recorded when an exercise has a skipped entry at a given session position.
- **Day skip:** recorded when ALL exercises in a section have a skipped entry at the same session position — meaning the entire day's workout was skipped at that point in history.

Skip markers are derived on save from the current note only and stored as `skip_markers` on the note object.

### Attendance Flags

> Where you see it: stored on note but not currently consumed by any display surface

Two types of attendance flag are derived alongside skip markers:

1. **Consecutive exercise skips:** walks each exercise's full session history. If an exercise has 2 or more skipped entries in a row at any point, a flag fires with the longest consecutive count (e.g., "Lateral Raise skipped 3 sessions in a row").

2. **Repeated weekday skip:** if the same weekday has 2 or more full-day skips within a recent session-depth window, a flag fires. Detection is session-order based, not calendar-date based.

Attendance flags are derived on save and stored as `attendance_flags` on the note object.

### Session Check-In

> Where you see it: Log screen — check-in prompt after saving a rough session (flagged exercises highlighted); Analytics screen — Fatigue section

The old per-exercise "hit a wall" nudge chip has been removed. In its place, saving the current routine runs `deriveSessionCheckIn` over the latest session column for tracked exercises that have prior history. Four detectors can flag the session as rough:

| Detector | Condition |
|----------|-----------|
| skipped | 2 or more exercises skipped in the latest session, and more than 1 above the historical per-session minimum |
| volume_drop | 2 or more sets lost more than 2 reps vs the most recent prior session at the same weight; reports the tonnage decline percentage |
| collapse | Intra-session rep drop-off: among working sets at the session's heaviest weight, last-set reps fell 2 or more below first-set reps (needs at least 2 sets at that weight) |
| day_skip | The whole latest session day was skipped |

Brand-new exercises with no logged history are never flagged. If any detector fires, the flagged exercises are highlighted and a check-in prompt asks how the session went: **"I'm okay"** (with quick reasons like No time / Short session) records `status: 'ok'`; **"Not great"** opens reason chips plus optional free text and records `status: 'rough'`; dismissing records `status: null`. The response is persisted on the note as `session_checkins[sessionIndex]` with `reasons`, optional `note`, and `responded_at`.

The Analytics screen's Fatigue section renders the check-in history via `deriveCheckInHistory`: date, issues logged, exercises skipped, and volume decline per rough session.

**Example (collapse):** Bench at 185 lb: sets of 8, 7, 5 reps. First set at heaviest weight 8 reps, last set 5, drop = 3 ≥ 2 → collapse detector fires.

### Estimated 1RM / 1k Total

> Where you see it: Home screen — 1k Club Progress card

For each of the three selected compound exercises (bench, squat, deadlift), finds the latest estimated 1-rep max from the note using the Epley formula:

```
Estimated 1RM = weight × (1 + reps / 30)
```

Sums the three values. If any of the three has no data in the note, the total shows as "—".

Derived on read — recomputed from the parsed note every time the Home screen renders.

**Default exercises:** DB Bench Press, Squat, Deadlift. Customizable via `one_k_exercises` stored on the note.

**Example:** Squat best set 225×5 → 1RM ≈ 262. Bench best set 185×8 → ≈ 234. Deadlift best set 315×4 → ≈ 357. Total = 853 lb. Progress bar shows 85.3% of 1000.

### Kilo Max

> Where you see it: Analytics screen — per-exercise stat

For each tracked exercise, collects every working set's Epley 1RM estimate (excluding warmup exercises). Averages all those values, then multiplies by a fatigue multiplier (default 1.07, configurable in Settings).

```
Kilo Max = average(all set Epley values) × fatigue multiplier
```

The result is rounded to the nearest integer. This is a fatigue-adjusted average, not a true max — it accounts for accumulated fatigue across sets to give a more stable estimate.

Derived on read — recomputed on the Analytics screen render.

**Example:** Squat sets: 225×5 (Epley 262), 225×4 (Epley 255), 225×3 (Epley 247). Average = 254.7. × 1.07 = 272.5 → Kilo Max = 273.

### Weekly Summary

> Where you see it: Home screen — weekly assessment panel

Shapes workout data for the Home assessment panel. It mostly reads persisted workout-note fields, but it also checks parsed sections for activity presence.

- **hasActivity:** true if any exercise in the parsed sections has at least one non-skipped entry or set.
- **sessionStatusRows:** filters stored exercise classifications to only Progressing, Steady, and Regressing. Drops Initial, Inconsistent, and null. If no displayable classifications remain, the section hides.
- **classifications:** count of each classification type across all tracked exercises (progressing, stalled, regressing, inconsistent, initial).

---

## Weight Analytics

### Weight Trends

> Where you see it: Home screen weight display, Weight screen, Analytics screen weight card

Computes rolling averages from weight entries (sorted newest-first):

- **7-day average:** mean of all entries within the last 7 calendar days (days 0–6 ago, inclusive).
- **30-day average:** mean of all entries within the last 30 calendar days (days 0–29 ago, inclusive).
- **Pace flag:** compares the two most recent entries by date. Classifies the absolute difference.

**Trend summary** extends this with prior-window comparisons:
- **Prior 7-day average:** mean of entries from days 7–13 ago (for week-over-week comparison).
- **Prior 30-day average:** mean of entries from days 30–59 ago.
- **Current weight:** most recent entry value.
- **Prior day weight:** second most recent entry value.

The current and prior windows are adjacent, inclusive, and non-overlapping: current 7-day (0–6) is followed by prior 7-day (7–13), and current 30-day (0–29) is followed by prior 30-day (30–59).

### Weight Pace

> Where you see it: Weight-change warnings

Classifies the day-to-day weight change between the two most recent entries:

| Absolute change | Level |
|-----------------|-------|
| < 1.5 lb | null (normal) |
| 1.5 – 2.29 lb | notable |
| ≥ 2.3 lb | spike |

Direction is `gain` or `loss` based on sign.

### Rolling Average Series

> Where you see it: Home screen weight chart (sparkline), Analytics screen weight chart

Computes a 7-day rolling average anchored at each of the last 7 distinct weigh-in dates. Each point represents the 7-day average as of that date. Points with no average (no entries in window) are omitted.

---

## Goal Guidance

### Goal Progress

> Where you see it: Home screen goal section, Goal detail view

Given a current weight, target weight, and target date:

1. **Direction:** if the difference between target and current weight is less than 0.5 lb → maintain. Otherwise → gain or loss.
2. **Weeks remaining:** calendar days between today and target date, divided by 7.
3. **Required weekly pace:** total weight change needed divided by weeks remaining (lb/week).
4. **Warnings:**
   - `unhealthy` if required pace exceeds 1 lb/week
   - `unrealistic` if required pace exceeds 2 lb/week
   - Warnings are advisory only — they never block saving a goal.

If the target date is in the past or invalid, returns direction null, 0 weeks remaining, no pace, and an `unrealistic` warning.

**Example:** Current weight 200 lb, target 185 lb, target date 15 weeks away. Delta = −15 lb. Pace = −1 lb/week. Direction = loss. No warnings (pace = 1.0, which is at the threshold but not over).

### Calorie Estimate

> Where you see it: Goal detail view

When a complete user profile is available (height, date of birth, biological sex, activity level), the app uses the **Mifflin-St Jeor BMR formula** to produce a TDEE-anchored absolute daily calorie target. Without a complete profile, it falls back to the legacy 3500 cal/lb deficit/surplus display.

#### Mifflin-St Jeor BMR

```
Male:   10 × weight(kg) + 6.25 × height(cm) − 5 × age + 5
Female: 10 × weight(kg) + 6.25 × height(cm) − 5 × age − 161
```

Weight is converted from lb to kg using the factor 0.453592.

#### Activity Multipliers

| Level | Multiplier |
|-------|-----------|
| Sedentary | 1.2 |
| Lightly active | 1.375 |
| Moderately active | 1.55 |
| Very active | 1.725 |
| Extra active | 1.9 |

**TDEE** = BMR × activity multiplier

#### Daily Calorie Target (TDEE path)

```
Daily adjustment = required_weekly_pace × 3500 / 7
Daily calorie target = TDEE + daily adjustment
```

Displayed as "Est. daily target … (approximate)". The result is an estimate only — it does not account for adaptive thermogenesis, body composition, medical conditions, or non-exercise activity variation.

| Direction | Label |
|-----------|-------|
| Loss (negative pace) | deficit |
| Gain (positive pace) | surplus |
| Maintain | maintain (0 cal/day) |

#### Legacy fallback (no profile)

Without a complete profile, only the 3500 cal/lb adjustment is shown:

```
Daily adjustment = |required_weekly_pace × 3500| / 7
```

Displayed as "Suggested deficit/surplus … (estimate)".

If the daily adjustment is less than 10 cal/day, it rounds to 0 and labels as maintain.

**Example:** Required pace −1 lb/week, moderately active 35-year-old male, 200 lb, 178 cm → TDEE ≈ 2865 kcal, daily adjustment −500 kcal → Est. daily target ≈ 2365 cal/day (approximate).

### Current Weight Resolution

> Where you see it: used internally by goal calculations

Determines what "current weight" means for goal guidance, in priority order:

1. Most recent weigh-in entry (if any entries exist)
2. Saved goal start_weight (if a goal exists and the user is not editing it)
3. User-typed start weight string (during goal editing)
4. null (when no weight can be determined)

---

## User Configuration

### Tracked Lifts

> Where you see it: Log screen — Track toggle per exercise

A toggle map stored in AsyncStorage under `kilo_tracked_lifts`. Controls which exercises the app monitors for classifications, session check-ins, and analytics.

The save path unions default tracked names (exercises in the catalog marked with `po: true`) with any user-toggled names to produce the full tracked names list.

### 1k Exercise Selections

> Where you see it: Home screen — 1k Club Progress card configuration

Maps each of the three 1k slots (bench, squat, deadlift) to a specific exercise name from the user's routine. Stored as `one_k_exercises` on the workout note object. Falls back to DB Bench Press, Squat, Deadlift when not set.

---

## FAQ

| Question | Answer |
|----------|--------|
| What does "Weeks In" mean? | The depth of your deepest exercise history, including skipped sessions and legacy plain-row history. It measures how far into the current routine you are. |
| Why does my classification say Steady when I feel like I'm progressing? | Classifications compare total reps at your top weight between your two most recent logged sessions. If you increased reps on some sets but decreased on others such that the total stayed the same, it reads as Steady. |
| What triggers a session check-in? | Saving a session where tracked exercises show a rough pattern: unusually many skips, a whole skipped day, sets losing 3+ reps vs your last session at the same weight, or an intra-session rep collapse at your heaviest weight. The app highlights the affected exercises and asks how the session went. |
| How is my 1k total calculated? | It sums the estimated 1-rep max (Epley formula) of your three selected compound lifts. If any of the three has no logged data, the total shows as "—". |
| How is estimated 1RM derived? | Using the Epley formula: weight × (1 + reps / 30). It estimates the maximum weight you could lift for a single rep based on a multi-rep set. |
| What does Kilo Max measure? | It averages all your working-set Epley 1RM estimates for an exercise, then multiplies by a fatigue multiplier (default 1.07). It's a fatigue-adjusted strength estimate, not a true max. |
| Why does my current weight differ from my last weigh-in? | If goal calculations show a different "current weight," it may be using a saved goal start weight (when no recent entries exist) or a user-typed value during editing. The priority is: latest entry → saved start weight → typed value. |
| How is my goal pace calculated? | Total weight change needed divided by weeks until your target date. Warnings appear if the pace exceeds 1 lb/week (unhealthy) or 2 lb/week (unrealistic). |
| How are daily calories estimated? | When you have a complete profile (height, date of birth, sex, activity level), the app uses Mifflin-St Jeor BMR × activity multiplier (TDEE), then adds your required daily pace adjustment to produce an absolute daily calorie target. Without a profile it falls back to the 3500 cal/lb convention (weekly pace × 3500 ÷ 7). All values are approximate estimates. |

---

## Data Lifecycle Summary

| Lifecycle | Items |
|-----------|-------|
| **Derived on save** (stored on note) | exercise_classifications, skip_markers, attendance_flags |
| **Derived on read** (recomputed each render) | Weeks In, 1k Total, Kilo Max, Weight Trends, Weight Pace, Weekly Summary shaping, Goal calculations, session check-in detection |
| **Global persisted** (own AsyncStorage key) | tracked lifts map |
| **Persisted on note** (user-set) | one_k_exercises, raw_text, session_checkins (check-in responses) |

---

## Maintenance Notes

- Each section should be updated at closeout time when its calculation is stabilized.
- Keep language non-technical; link to source files only in developer docs.
- Structure is designed to map onto future in-app help or tooltip surfaces.
