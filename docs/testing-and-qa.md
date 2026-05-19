# Testing And QA

## Device Preview Workflow

This workflow rebuilds the web app, syncs it into the Android shell, and relaunches on a connected device or emulator. Run it after any change to `Kilo.html` or `src/`.

**Prerequisites (first time only):**

- Android Studio installed and on `$PATH` (`studio`)
- One connected device (USB debugging enabled) or a running Android emulator
- `npm install` run at the repo root

**Full loop (rebuild → sync → run):**

```sh
npm run preview
```

This runs three steps in sequence:

1. `npm run build` — assembles `www/index.html` and `www/src/` from `Kilo.html` and `src/`
2. `npm run cap:sync` — copies `www/` into `android/app/src/main/assets/public/` and updates plugins
3. `npm run cap:run` — builds the APK and launches it on the connected device

**Step-by-step alternative (open Android Studio instead of CLI run):**

```sh
npm run build
npm run cap:sync
npm run cap:open   # opens the android/ project in Android Studio
```

Use `cap:open` when you need to inspect logs, change build variants, or the CLI run fails to detect the device.

**Troubleshooting:**

- If `cap` is not found: run `npx cap <command>` instead, or `npm install` to restore dev dependencies.
- If no device is detected by `cap:run`: confirm `adb devices` shows your device, or start an emulator first.
- Changes to native plugins require `npm run cap:sync` before running; changes to web files only also require `cap:sync` (or the `preview` script).

## Native Expo Workflow

Issue #36 introduced a real native UI path under `mobile/`. That path is
separate from the Capacitor-packaged web preview above.

Start the Expo app:

```sh
npm run mobile:start
```

Open the QR code in Expo Go, or launch Android directly:

```sh
npm run mobile:android
```

For a standalone installable Android APK that does not depend on a running dev
machine, use the EAS build flow documented in `docs/phone-runbook.md`.

For Android release-style update verification after a compatible build is
installed, publish to the configured EAS Update channels from `mobile/`:

```sh
npm --prefix mobile run publish:android -- --message "describe the change"
npm --prefix mobile run publish:android:preview -- --message "describe the change"
```

Use OTA publish only for JavaScript and asset changes. Any native-affecting
change still requires a fresh Android build because `mobile/app.json` uses
`runtimeVersion.policy: "fingerprint"` to block incompatible updates from
reaching existing installs.

Current limitation:

- Native parser and storage modules now have Jest coverage under `mobile/tests/`,
  including tracked-exercise persistence on the canonical workout note and a
  fixture-driven migration contract suite for legacy structured workout
  history, plus weight-goal persistence/derivation coverage and malformed
  backup rejection coverage for the optional `weight_goal` v2 import field.
- No automated native test covers rendered React Native screens, tab routing, or
  an Expo device/emulator pass yet.
- The current native workout form is narrower than the browser prototype UI even
  though the native save/reload loop now persists canonical entries locally.

---

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

Run the native Jest suite:

```sh
npm --prefix mobile test
```

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

### `tests/log-ui.test.jsx`

**Duplicate-session banner**
- shows `↻ {split.label} already logged today` when a session for the current date and split already exists
- does not show the banner when no session exists for today
- does not show the banner when a same-date session exists for a different split day

**Save-success state**
- shows `Workout saved` after a valid save
- shows `View Stats` after save
- shows `Back to Home` after save
- `View Stats` calls `goToTab('stats')`
- `Back to Home` calls `goToTab('home')`

### `tests/setup.js`

Provides the global runtime contract required by the prototype:
- `global.React` so JSX source files work without imports
- `global.KILO_C` design tokens (all color values)
- `global.KILO_FONT`, `global.KILO_MONO`
- `global.KILO_TODAY = '2026-05-09'`
- `global.KILO_WEIGHTS = []`, `global.KILO_GOALS = []`, `global.KILO_SESSIONS = []`, `global.KILO_EXERCISES = []`
- `global.KILO_SPLIT` with a full week schedule
- `afterEach` cleanup: calls `@testing-library/react` cleanup, resets `KILO_WEIGHTS`, and clears `localStorage`

### `mobile/tests/parser.test.js`

- parser parity coverage for `mobile/lib/parser.js`
- validates canonical native `parseWeightEntry`, `parseWorkoutRow`, and
  `parseWorkoutEntry` behavior against the same constrained MVP forms used in
  the browser parser tests
- covers `parseWorkoutNote` for sample-style shorthand workout notes, including
  day and section headings, mixed-weight rows, deload summaries, graceful
  degradation of ambiguous fragments, and the non-weight cardio regression from
  the archived treadmill sample
- covers long-note session alignment, including positional `- ...` grouping,
  bare `-` skip-slot preservation, warmup/day boundary avoidance, non-weight
  alignment, deload coexistence, and uneven-count warning behavior
- covers `countWorkoutSessions` for day-aware current-workout counting,
  including same-day warmup+lifting grouping, highest-day-count semantics,
  non-weight warmup session entries, skip-slot exclusion, zero when no rows
  exist, and a real-format `current_workout`-shape fixture asserting main
  lifts retain history rows and bare `-` skips do not hide that history
- covers `epleyPR` and `deriveWorkoutAnalytics`, including grouped-row
  preservation, multi-occurrence exercise merging, stable
  `set_prs[].occurrence_index` linkage, and propagation of non-weight
  `unparsed_rows` into the derived analytics contract
- covers `deriveTrackedPRs` caller-order behavior and `derive1kTotal`
  aggregation behavior, including missing-lift null totals, mixed-weight rows,
  changing tracked selections, and best-set selection across multiple days

### `mobile/tests/storage.test.js`

- AsyncStorage-backed load/save/delete/update/migrate coverage for
  `mobile/storage/entries.js`
- verifies empty-load behavior, newest-first sorting, update misses, workout
  note save/overwrite/clear behavior, tracked-exercise persistence across note
  edits, and migration of legacy structured sessions into the canonical
  workout-note document
- includes a contract-driven migration suite that verifies weighted entries,
  non-weight entries, mixed weighted-plus-metadata entries, positional skip
  slots, multi-session count preservation, and session-view-visible mixed-entry
  comments after `buildSessionsFromNote()`

---

## Coverage Gaps

The following MVP behaviors have no automated test coverage:

**Workout logging UI (`screens/log.jsx`)**
- `handleSave` error path (no valid rows → "✕ Complete at least one exercise before saving")
- Per-row parse error highlighting on save attempt
- `ParsePreview` live preview rendering
- PT checklist toggle behavior
- `persistWorkoutSession` write to `localStorage`

**Correction flows**
- Native Weight screen delete flow (`WeightScreen`, confirmation prompt,
  `deleteWeightEntry`, re-renders history)
- Native Weight screen edit flow (`WeightScreen`, inline validation via
  `parseWeightEntry`, `updateWeightEntry`, re-renders history)
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
- No automated native test covers `mobile/App.js`, native tab routing, native
  forms, native validation/success UI feedback, or native layout/runtime
  behavior

---

## Dependency Audit Gate

A CI workflow (`.github/workflows/audit.yml`) runs `npm audit --audit-level=high` against both the root and `mobile/` package trees on every push to `main` and on every pull request. The job fails if any high-severity or critical vulnerability is found.

Run the same check locally:

```sh
npm run audit               # root package tree
npm --prefix mobile audit   # or: cd mobile && npm run audit
```

The gate catches advisories in `package-lock.json` and `mobile/package-lock.json`. It does not perform dependency upgrades; remediation is handled separately.

---

## Installable Preview Smoke Checklist

Before declaring the packaged preview ready, a human tester must pass every step below on a physical phone. This is the minimum real-device check for installability, launch, update/relaunch, loading behavior, and basic touch interaction. It is not full product QA.

1. Build, sync, and launch the packaged preview on a connected phone.
   ```sh
   npm run preview
   ```
2. Open the app from the phone launcher and confirm it starts without a crash, blank screen, or script-load error.  **[BLOCKER]**
3. Confirm all five tabs are visible and respond to taps: Home, Log, Weight, Stats, More.  **[BLOCKER]**
4. On **Weight**, confirm the entry field and **Log** button load, the button is disabled when the field is empty, and a valid value such as `185` saves successfully and updates the Entries list.  **[BLOCKER]**
5. Change the visible version text in the packaged app footer from `0.1.0` to `0.1.0-test`, rebuild and redeploy the preview to the same phone, then relaunch it from the launcher. Confirm the app opens normally after the update, the footer now shows `0.1.0-test`, and the saved weight entry is still present.  **[BLOCKER]**
6. On **Log**, enter one simple workout row such as `135 5,5,5`. Confirm the parse preview appears, the header **Save** action becomes enabled, and saving shows the "Workout saved" confirmation screen.  **[BLOCKER]**
7. Return to **Home** and confirm the new workout appears in Recent history with the most recent entry first.  **[BLOCKER]**
8. Do one basic touch pass on the device: scroll Recent history, switch tabs a few times, and confirm taps register cleanly without missed or stuck interactions.  **[BLOCKER]**
