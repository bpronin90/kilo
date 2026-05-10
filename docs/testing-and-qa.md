# Testing And QA

## Running Automated Tests

Install dependencies (first time only):

```sh
npm install
```

Run the full suite once:

```sh
npm test
```

Run in watch mode (re-runs on file change):

```sh
npm run test:watch
```

The suite uses Vitest + jsdom. All tests run in a simulated DOM with the global
runtime contract from `tests/setup.js`. No browser or server is required.

---

## Automated Coverage Inventory

### `tests/parser.test.jsx`

**`parseWeightEntry`**
- accepts plain integer (`180`)
- accepts decimal (`180.4`)
- accepts surrounding whitespace (`  180  `)
- rejects empty string → `missing_required_field`
- rejects null → `missing_required_field`
- rejects whitespace-only string → `missing_required_field`
- rejects unit suffix (`180lbs`) → `invalid_field_value`
- rejects sign prefix (`+180`) → `invalid_field_value`
- rejects negative (`-5`) → `invalid_field_value`
- rejects zero (`0`) → `invalid_field_value`
- rejects prose (`one eighty`) → `invalid_field_value`
- rejects comma-formatted number (`1,80`) → `invalid_field_value`

**`parseWorkoutRow`**
- blank input → `{ ok: true, blank: true }`
- null input → `{ ok: true, blank: true }`
- dash (`-`) → `{ ok: true, skipped: true }`
- standalone rep-group with comma (`8,8,8`) → 3 sets, `weight_value: null`
- single integer (`8`) → rejected as ambiguous
- weight + single-rep group (`135 5`) → 1 set with `weight_value: 135`
- weight + multi-rep group (`135 8,8,8`) → 3 sets, each `weight_value: 135`
- multiple weight/rep pairs (`135 5,5 145 3,3`) → 4 sets with correct values
- decimal load (`67.5 6,6`)
- spaces around commas normalized (`135 8, 8, 8`)
- rejects weight with no following reps (`135`)
- rejects zero weight (`0 8,8`) → `invalid_field_value`
- rejects zero reps (`135 0,8`) → `invalid_field_value`
- `set_index` increments correctly across pairs

**`parseWorkoutEntry`**
- valid items → `ok: true`, correct `workout_date`, expected `items` count
- item has canonical shape (`exercise_name`, `result_kind`, `note_text: null`, `position`)
- set has canonical shape (`rep_count`, `weight_value`, `weight_unit`, `duration_seconds: null`, etc.)
- blank rows skipped; skipped (`-`) rows skipped
- all-blank or all-skipped items → `{ ok: false, category: 'structural_violation' }`
- invalid row → `{ ok: false, rowErrors: [{ exerciseName, error }] }`
- `position` increments across included items only (skipped rows not counted)
- defaults `workout_date` to `KILO_TODAY` when not supplied

### `tests/weight-ui.test.jsx`

**`KiloWeight` — log button state**
- disabled when entry field is empty
- enabled once entry has a value

**`KiloWeight` — success feedback**
- shows "✓ Weight saved successfully" after valid integer
- shows success message after valid decimal
- button changes to "Saved" after success

**`KiloWeight` — failure feedback**
- unit suffix (`180lbs`) → "✕ Enter a number only (e.g. 180 or 180.4)"
- whitespace-only entry → "✕ Weight is required"
- prose input (`heavy`) → "✕ Enter a number only (e.g. 180 or 180.4)"

**`KiloWeight` — persisted entry shape**
- writes `entry_type`, `weight_value: 179`, `weight_unit: 'lb'` to `localStorage`
- `id` has `w_` prefix
- `logged_at` and `saved_at` are strings

**`KiloHome` — quick-log button state**
- disabled when entry field is empty
- enabled once entry has a value

**`KiloHome` — quick-log success feedback**
- shows "✓ Saved successfully" or "✓ Weight saved" in logged-today view

**`KiloHome` — quick-log failure feedback**
- unit suffix → "✕ Enter a number only (e.g. 180 or 180.4)"
- whitespace-only → "✕ Weight is required"

**`KiloHome` — quick-log persistence shape**
- writes canonical fields to `localStorage` (`entry_type`, `weight_value`, `weight_unit`, `id`, `logged_at`, `saved_at`)

**`parseWeightEntry` acceptance cases (in weight-ui.test.jsx)**
- integer, decimal, trailing-zero decimal, whitespace trimmed, `logged_at` is a valid ISO timestamp

**`parseWeightEntry` rejection cases (in weight-ui.test.jsx)**
- empty string, null, whitespace-only, unit suffix with space (`180 lb`), `180lbs`, comma decimal (`180,4`), inline note (`180 / felt light`), date prefix, prose, zero, negative

**`parseWeightEntry` — edit-path cases**
- confirms that previously lenient paths (`180lbs`, `0`, `-5`, `   `) are now blocked by the parser

### `tests/setup.js`

Provides the global runtime contract required by the prototype:
- `global.React` so JSX source files work without imports
- `global.KILO_C` design tokens (all color values)
- `global.KILO_FONT`, `global.KILO_MONO`
- `global.KILO_TODAY = '2026-05-09'`
- `global.KILO_WEIGHTS = []`, `global.KILO_GOALS = []`, `global.KILO_SESSIONS = []`, `global.KILO_EXERCISES = []`
- `global.KILO_SPLIT` with a full week schedule
- `afterEach` cleanup: calls `@testing-library/react` cleanup, resets `KILO_WEIGHTS`, and clears `localStorage`

---

## Coverage Gaps

The following MVP behaviors have no automated test coverage:

**Workout logging UI (`screens/log.jsx`)**
- `KiloLog` render
- `handleSave` success path (valid rows → "Workout saved" screen)
- `handleSave` error path (no valid rows → "✕ Complete at least one exercise before saving")
- Per-row parse error highlighting on save attempt
- `ParsePreview` live preview rendering
- PT checklist toggle behavior
- `persistWorkoutSession` write to `localStorage`

**Correction flows**
- Weight entry delete from `KiloWeight` (calls `deleteWeightEntry`, re-renders list)
- Weight entry edit from `KiloWeight` (calls `updateWeightEntry` via `window.prompt`, re-renders list)
- Workout session delete from `KiloHome` recent history (calls `deleteWorkoutSession`, re-renders list)
- Weight entry delete from `KiloHome` recent history

**Recent history rendering**
- Combined weight + workout sort in `KiloHome` recent history section
- Workout entry card rendering (exercise names, raw values via `formatParsed`)
- Weight entry card rendering in `KiloHome` recent history

**Weight screen**
- `KiloWeight` entry list rendering (12-entry slice, delta calculation)
- `WeightGraph` SVG output
- Range tab switching
- Note field toggle and save

**Other screens**
- `KiloStats`, `KiloMore`, and `KiloApp` tab routing
- Device frame and design-canvas components

**End-to-end**
- No automated browser test covers script load order or `window.*` global wiring
- No automated test covers `localStorage` rehydration on fresh load (`initStoredSessions`, `KILO_WEIGHTS` merge)

---

## Manual Smoke Checklist

Before declaring the MVP launch-ready, a human tester must pass every step below. Each step is a concrete pass/fail action. Steps marked **[BLOCKER]** must pass before launch. Failures on non-blocker steps should be noted but do not block.

### Setup

1. From the repo root, start a local server:
   ```sh
   python3 -m http.server 8000
   ```
2. Open `http://localhost:8000/Kilo.html` in a browser.
3. Open the browser developer console and confirm no script-load errors appear on the initial load.  **[BLOCKER]**
4. Verify that all five tabs are visible and tappable: Home, Log, Weight, Stats, More.  **[BLOCKER]**

---

### Flow 1 — Log a weight entry

#### Via the Weight tab

5. Tap the **Weight** tab.
6. Confirm the entry field and **Log** button are visible.
7. Leave the entry field empty. Confirm the **Log** button is disabled.  **[BLOCKER]**
8. Type `185` in the entry field. Confirm **Log** becomes enabled.  **[BLOCKER]**
9. Tap **Log**.
10. Confirm "✓ Weight saved successfully" appears below the field.  **[BLOCKER]**
11. Confirm the button changes to "Saved" and is disabled.  **[BLOCKER]**
12. Confirm the new entry appears in the Entries list below the graph.  **[BLOCKER]**

#### Error cases on Weight tab

13. Clear the field. Type `185lbs`. Tap **Log**.
14. Confirm "✕ Enter a number only (e.g. 180 or 180.4)" appears.  **[BLOCKER]**
15. Clear the field. Type `   ` (spaces only). Tap **Log**.
16. Confirm "✕ Weight is required" appears.  **[BLOCKER]**

#### Via the Home quick-log

The Home quick-log input is only shown when no weight has been logged for `KILO_TODAY`. If weight was already logged in steps 8-11 above, the input will be hidden and cannot be reached by reloading (the saved entry rehydrates from `localStorage`). Clear the stored state first:

17. Open the browser DevTools console and run:
    ```js
    localStorage.clear(); location.reload();
    ```
18. Tap the **Home** tab. Confirm the quick-log weight input and Log button are visible.  **[BLOCKER]**
19. Type `184.5` in the Home weight field. Confirm the Log button enables.  **[BLOCKER]**
20. Tap the Log button. Confirm a success message appears.  **[BLOCKER]**

---

### Flow 2 — Log a workout entry

21. Tap the **Log** tab.
22. Confirm exercises are listed for today's day-of-week split.
23. Confirm the **Save Session** button is disabled when no exercises have valid input.  **[BLOCKER]**
24. Type `135 5,5,5` in the first exercise's input field.
25. Confirm the parse preview immediately shows the rep groups below the field (e.g., a chip showing `135 × 5,5,5`).  (non-blocker for launch gate, but expected behavior)
26. Leave all remaining exercises empty.
27. Tap **Save Session**.
28. Confirm the "Workout saved" confirmation screen appears with a checkmark.  **[BLOCKER]**
29. Tap **Back to Home**.

#### Skip and error cases

30. Tap the **Log** tab.
31. Type `-` in an exercise field. Confirm "Skipped" appears in the preview.
32. Type `bad input` in a different exercise field.
33. Confirm the parse preview shows a `⚠` error message below that field.
34. Type `135 5` in at least one exercise field to make the submit valid.
35. Tap **Save Session**. Confirm a row with `bad input` shows a red error inline (not the success screen).  **[BLOCKER]**
36. Correct `bad input` to `135 5`. Tap **Save Session**. Confirm the "Workout saved" screen appears.  **[BLOCKER]**
37. Return to the **Log** tab with all exercise fields cleared.
38. Confirm the **Save Session** button is disabled when all fields are empty (no save attempt is possible in this state).  **[BLOCKER]**
39. Type `-` in every exercise field. Confirm the **Save Session** button becomes enabled (skipped rows are parsed as `ok` and count toward the enabled state).
40. Tap **Save Session**. Confirm "✕ Complete at least one exercise before saving" appears — the parser drops all skipped rows and returns a structural violation.  **[BLOCKER]**

---

### Flow 3 — Review saved recent entries

41. Tap the **Home** tab.
42. Scroll to the "Recent history" section.
43. Confirm the workout entry just saved appears in the list with the exercise name(s) and logged values visible.  **[BLOCKER]**
44. Confirm any weight entry logged during this session also appears in the list.  **[BLOCKER]**
45. Confirm the most recently saved entry appears first.  **[BLOCKER]**
46. Reload the page (`Cmd+R` / `F5`).
47. Navigate back to Home → Recent history.
48. Confirm the user-saved entries are still present (they persist via `localStorage`).  **[BLOCKER]**
49. Tap the **Weight** tab and confirm the logged weight entry is still listed in the Entries section.  **[BLOCKER]**

---

### Flow 4 — Correct an obvious recent mistake

#### Delete a weight entry from the Weight tab

50. Tap the **Weight** tab.
51. In the Entries list, find a user-created entry (identified by the edit and delete icons on the right).
52. Tap the **×** (delete) icon on that entry.
53. Confirm a browser confirmation dialog appears ("Delete this entry?").
54. Confirm deletion. Confirm the entry is removed from the Entries list.  **[BLOCKER]**

#### Edit a weight entry from the Weight tab

55. In the Entries list, find a remaining user-created entry.
56. Tap the **edit** (pencil) icon.
57. Confirm a browser prompt appears pre-filled with the current value.
58. Enter `190`. Confirm. Confirm the entry value updates in the list.  **[BLOCKER]**
59. Tap the edit icon again. Enter `bad`. Confirm. Confirm an error alert appears and the entry is unchanged.  **[BLOCKER]**

#### Delete a workout session from Home

60. Tap the **Home** tab.
61. In the Recent history section, find a user-saved workout entry (identified by the **×** delete icon).
62. Tap **×**. Confirm the browser confirmation dialog appears.
63. Confirm deletion. Confirm the workout entry is removed from Recent history.  **[BLOCKER]**

#### Delete a weight entry from Home

64. In the Recent history section, find a user-saved weight entry.
65. Tap **×**. Confirm the browser confirmation dialog appears.
66. Confirm deletion. Confirm the weight entry is removed from Recent history.  **[BLOCKER]**

---

### Post-checklist notes

The following behaviors are expected limitations of the current prototype and are **not launch blockers**:

- PT checklist items in the Log screen are toggle-only and not persisted across reloads.
- The Stats screen shows seed history and user sessions but has no correction or delete flows.
- The design canvas and device frame overlays are prototype chrome and are not part of the MVP logging loop.
- The More screen is visible but not required for the core MVP flows.
- Workout entries in the recent history cannot be edited — only deleted. This is within the MVP correction contract.
- Seeded workout sessions in recent history do not show delete buttons (they are not `isUserEntry`). This is expected.
