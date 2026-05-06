# Kilo — Fitness Tracker App Spec
*Personalized for Ben. To be extended with weight tracking preferences in a separate session.*

---

## Overview

Kilo is a personal fitness tracking app built for one user. It replaces an ongoing Claude conversation that tracked lifting sessions, progressive overload, 1RM estimates, deload generation, shoulder PT, and daily weigh-ins. The app must feel fast, mobile-first, and never get in the way of logging.

**Core philosophy: freeform input first, structure second.** The app interprets how Ben naturally logs — it does not force Ben to adapt to the app.

---

## Stack

- **Frontend**: React Native + Expo (iOS, Android, web via Expo Web)
- **Backend**: Supabase (Postgres + Auth + Realtime)
- **Parsing**: Deterministic rule-based parser (no AI, no external API)
- **State**: Zustand or React Context
- **Navigation**: Expo Router (file-based)

---

## User

Single user. No multi-user support needed. Auth via Supabase (email/password or magic link). Session persists.

---

## Freeform Input Parser

This is the most critical component of the app. The parser must handle Ben's natural logging syntax reliably.

### Syntax Rules

**Straight sets:**
```
weight reps,reps,reps
95 8,8,8
```

**Drop sets (weight change mid-exercise):**
```
weight reps,reps weight reps,reps
95 4,4 90 8,8
```

**Mixed within same exercise log:**
```
95 6,6,6 90 8
```

**Skipped session:**
```
-
```

**Asterisked exercise (no progressive overload):**
```
* (flag on exercise definition, not in log input)
```

**Warmup sets:** Logged same way as working sets but tagged as warmup. Optional — if user doesn't log warmup, no penalty.

**PT exercises:** Freeform text or structured checkoff. Optional. No PO tracking.

### Parser Behavior

- Input is a single text field per exercise per session
- Parser tokenizes by spaces, identifies alternating weight/rep-group patterns
- Rep groups are comma-separated integers
- Multiple weight/rep-group pairs = drop set
- Dash alone = skipped
- Unknown tokens = flag for review, do not crash
- Parser outputs structured JSON:
```json
{
  "sets": [
    { "weight": 95, "reps": [6, 6, 6] },
    { "weight": 90, "reps": [8] }
  ],
  "skipped": false,
  "raw": "95 6,6,6 90 8"
}
```

Always store raw input alongside parsed output. If parse fails, store raw only and flag.

---

## Data Models

### Exercise Definition
```
id
name
category: primary_compound | secondary_compound | accessory | pt
split_day: monday | tuesday | wednesday | thursday | friday
progressive_overload: boolean
rep_range_min: int
rep_range_max: int
sets_target: int
notes: text
is_asterisked: boolean (alias for progressive_overload: false)
active: boolean
```

### Session
```
id
date
split_day
duration_minutes (optional)
notes (freeform)
```

### SessionExercise
```
id
session_id
exercise_id
raw_input: text
parsed_sets: jsonb
warmup_sets: jsonb (optional)
skipped: boolean
```

### WeightLog
*(to be expanded in weight tracking session)*
```
id
date
weight_lbs
notes
```

### Goal
```
id
type: total_lb | body_weight | other
label: text (e.g. "1000 lb club", "Cut to 185")
target_value: float
current_value: float (computed or manual)
active: boolean
start_date
target_date (optional)
```

---

## Weight Tracking — Detailed Spec

### Measurement Protocol

Ben's weigh-in method is fixed. UX copy and defaults should reflect it without suggesting alternatives:

- **Timing**: Every morning, post-urination
- **Location**: Same scale position each day
- **Frequency**: Daily — a missing day is an exception, not the norm
- **Unit**: lbs, one decimal place (e.g. 193.4)

---

### Data Entry

**Home screen shortcut:**
- Single numeric input visible directly on the dashboard
- Tap to focus, enter number, confirm — no extra navigation required
- Date defaults to today

**Full weight log screen:**
- Same entry field at the top of the screen
- Backdating supported via date picker
- Notes field hidden behind a toggle (e.g. "Add note +") — not shown by default
- If a weigh-in already exists for the selected date, prompt to overwrite
- No confirmation dialog on save — log and dismiss immediately

---

### Known Variability Patterns

These are empirical observations from Ben's tracking history, not assumptions. They should inform how the app interprets and presents data:

- **Daily swing range**: 2–4 lbs is normal. Single-day moves within this range carry no signal and should never be flagged.
- **Weekend effect**: Weight reliably rises Friday–Sunday and pulls back Monday–Tuesday due to food volume and sodium. This is a known recurring pattern, not a trend.
- **Spike behavior**: Occasional 2+ lb overnight jumps occur and typically resolve within 2–4 days. These are not trend signals on their own.
- **Trend evaluation window**: Ben's weight moves in sustained bands over 2–3 week periods. Any trend signal must be based on rolling averages, not day-to-day deltas.

---

### Weight Log Screen

**Graph:**
- Default view: 7 days, user-selectable to 30, 90, or all-time
- Raw daily entries plotted as dots
- 7-day rolling average as a smooth line
- 30-day rolling average as a secondary smooth line (visually distinct, e.g. dimmer or dashed)
- Y-axis auto-scales with ~5 lb padding above and below the visible data — never anchored to zero

**Stats panel below graph:**
- 7-day rolling average (primary, large)
- 30-day rolling average
- Week-over-week delta (current 7-day avg vs prior 7-day avg, with direction indicator)
- Days logged in the current view window

**Entry list:**
- Scrollable log of all entries below stats (date, weight, note if present)
- Tap an entry to edit or delete

---

### Home Screen Dashboard

- Displays the **7-day rolling average** as the primary weight figure
- Label should make clear it's an average, not today's reading (e.g. "7-day avg · 192.4")
- Tap opens the full weight log screen
- If no weigh-in today, show a subtle indicator (e.g. dot or badge) prompting entry — not a push notification

---

### Goal Integration

Weight goals are optional. When active, a target weight is set on the Goals screen with:
- Goal type: bulk (target above current) or cut (target below current)
- Target weight in lbs
- Target date (optional)

**When a weight goal is active:**
- Progress bar shown on Goals screen: current 7-day avg vs target
- Dashboard can optionally feature it (user selects which goal is featured, same as other goal types)

**Trend alerting:**
- The app evaluates whether the 7-day rolling average is moving toward or away from the active weight goal
- Alert condition: 7-day average has moved in the wrong direction for 10+ consecutive days
- Alert style: inline indicator on the weight log screen and dashboard widget — no push notifications, no modal interruptions
- No alerts when no weight goal is active — app is purely observational in that state

---

### Data Model

```sql
weight_logs (
  id uuid primary key,
  date date not null unique,
  weight_lbs numeric(5,1) not null,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
)
```

Store one entry per date. If backdating is used, `created_at` and `date` will differ — preserve both.

Rolling averages are computed at query time, not stored.

---

### Out of Scope (v1)

- Apple Health / Google Fit sync
- Body fat percentage or other body composition metrics
- Photo logging
- Calorie or macro tracking

---

## Screens

### 1. Home / Dashboard
- Today's split day label (e.g. "Tuesday — Squat")
- Active goal progress bar (user selects which goal is featured)
- Quick-log button → opens today's session
- Weight log streak / last entry
- Recent 1RM estimates for the three main lifts (squat, bench, deadlift)
- 1000 lb total tracker if that goal is active (shows current estimated total vs target)

### 2. Log Session
- Auto-detects today's split day, can be overridden
- Lists exercises for that day in order
- Each exercise has:
  - Name + rep range target + sets target
  - Freeform text input field (keyboard stays up)
  - PO badge if progressive overload is on
  - Last session's logged weight shown as reference
  - Optional warmup input (collapsible)
- PT section at bottom (optional checkoff or freeform)
- Save session button
- Duration auto-tracked from first input to save

### 3. Exercise History
- Per-exercise view
- Table of all logged sets over time (date, sets, weights, reps)
- 1RM trend graph over time (for PO compounds)
- Best set ever highlighted
- Raw input visible (expandable)

### 4. 1RM Calculator
- Manual entry or pull from last session
- Uses multi-set adjusted formula:
  - Take heaviest weight logged across all sets
  - Adjust rep count upward based on how many sets were completed at that weight (fatigue correction)
  - Apply Epley to adjusted reps
  - Display estimated true fresh 1RM
- Shows all three main lifts
- Shows estimated total
- Shows delta from goal

### 5. Deload Generator
- Button: "Generate Deload Week"
- Pulls last full week of working weights
- Applies 60-70% across all PO exercises
- Reduces sets by 1 across the board
- Keeps asterisked/non-PO exercises at same weight
- Outputs day-by-day deload plan
- Can be exported as text or viewed in-app

### 6. Goals
- List of goals (active and archived)
- Add goal: type, label, target value, target date (optional)
- Mark one as "featured" for dashboard
- Goals can be: strength total, individual lift, body weight, other (custom)
- Progress tracked automatically where computable, manually otherwise

### 7. Weight Log
*(to be expanded in weight tracking session)*
- Daily weigh-in entry
- Trend graph
- 7-day and 30-day averages
- Notes field

### 8. Settings / Exercise Management
- Add/edit/deactivate exercises
- Set PO flag per exercise
- Set rep range and sets target
- Reorder exercises within a day
- Manage split days
- PT exercises managed separately

---

## Progressive Overload Logic

- Only runs on exercises where `progressive_overload: true`
- After each session, compares last two logged sessions for that exercise
- If top set weight increased OR reps increased at same weight → green indicator
- If flat for 2+ sessions → yellow nudge ("Consider adding weight or reps")
- If dropped → no alarm, just logged
- Never nudges on asterisked exercises

---

## 1RM Calculation (Multi-Set Adjusted)

Standard Epley underestimates when the logged set is deep in a workout. Kilo adjusts:

1. Find heaviest weight used in session for that exercise
2. Count total sets completed at or near that weight (within 5 lbs)
3. Apply fatigue correction: add 1 estimated rep per 2 sets completed before the heaviest set
4. Run Epley on adjusted rep count: `weight × (1 + adjustedReps / 30)`
5. Store both raw Epley and adjusted estimate

Display adjusted estimate as primary. Raw available on tap.

---

## Split Structure

**Monday** — Push (Chest/Shoulders/Tris)
**Tuesday** — Squat (Legs)
**Wednesday** — Pull (Back/Bis)
**Thursday** — Push Upper (Incline/Accessories)
**Friday** — Deadlift (Posterior/Legs)

Split days are configurable in settings. Default is the above.

---

## Shoulder PT Protocol

Daily checklist (separate from lifting sessions):
- Serratus punches
- Floor wall slides
- Sleeper stretch
- Cross-body stretch
- Band pull-aparts

Each item is a checkoff. Optional to complete. Streak tracked. No PO, no logging of weight/reps — just done/not done per day.

---

## Key UX Constraints

- **Freeform input must be the primary logging method.** Structured fields are secondary/optional.
- App must work offline and sync when back online (Supabase offline support or local-first with sync).
- Keyboard behavior must be smooth on mobile — no layout jumping.
- Last session reference must always be visible when logging.
- No gamification gimmicks. Clean, utilitarian, fast.
- Dark mode default.

---

## Out of Scope (v1)

- Social features
- Multi-user
- AI/LLM integration
- Apple Health / Google Fit sync
- Video form check
- Barcode food logging

---

## Notes for Agent Handoff

- Parser is the highest-risk component. Unit test extensively with real logged data from Ben's sessions before integrating into UI.
- Supabase schema should be migrated via SQL files, not auto-generated.
- Expo Router for navigation. No React Navigation.
- Weight tracking section of spec to be added before build begins — do not scaffold WeightLog screen until that spec is merged.
- Exercise seed data should be pre-populated based on Ben's current split (see exercise list in conversation history).
