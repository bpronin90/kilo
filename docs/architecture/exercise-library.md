# Exercise Library

Offline, deterministic exercise metadata for analytics (#1578). It is read-only
enrichment: no consumer uses it yet, and it never replaces `normalizeExerciseKey()`
history keys, renames exercises, merges history, or forces a selection. Unknown
text stays valid free text.

## Artifact

- Dataset: `mobile/lib/data/exerciseLibrary/v3.json`, the single authoritative copy,
  relocated unchanged from the owner-supplied file (SHA-256
  `094e8ebbe7a4ea7ad947cde44be806f9a8bd778a61f9d2e198993b4482b38920`).
- Contents: schema version 3, 543 exercises, 154 families, 61 ambiguity records,
  220 matching fixtures.
- Schema version (`3`, from the file), dataset version (`DATASET_VERSION`), and source
  provenance (`SOURCE_PROVENANCE`) are tracked separately in
  `mobile/lib/data/exerciseLibrary/index.js`.
- The catalog is deep-frozen at load; results expose shared records read-only.

## Resolver

`resolveExerciseName(input)` builds its indexes once and returns a frozen
`{ input, matchType, exerciseId, familyId, exercise, candidates,
missingDiscriminators, clarificationQuestion }`. Normalization: Unicode NFKC, case
fold, remove apostrophes, other punctuation to spaces, fold dotted/spaced initialisms
(`R.D.L.`, `R D L`, `rdl`), collapse whitespace. Priority: canonical name, exercise
alias, explicit ambiguity, family registry, unknown. There is no fuzzy matching, and
explicit equipment, position, angle, grip, assistance, or laterality is never dropped.
Ambiguous and unknown results carry no `exerciseId`.

`resolveExerciseId(id)` is a separate ID API that follows `deprecated_id_redirects`
for stored IDs only (for example `assisted_pull_up` to `machine_assisted_pull_up`).
Free text "assisted pull-up" stays ambiguous: it never inherits the redirect.

## Unicode profile

Normalization is pinned to Unicode 15 so every runtime (Hermes, Node, Python) gives
the same keys. Code points unassigned in Unicode 15 become separators before NFKC
(for example U+A7F1 splits "Pre\ua7f1s" into "pre s", and U+088F after "Press" is
ignored). Order: separate unassigned, NFKC, casefold, NFKC (casefold can emit base
plus mark), strip apostrophes, punctuation to spaces, join single-letter runs
(including supplementary-plane letters). No NFKC runs after joining, so joined jamo
are never composed.

Both generated blocks live in `index.js`: `UNICODE15_ASSIGNED_RANGES` (from
`validate-exercise-library.py --regen-repertoire`) and the casefold exception table
(code points where upper-then-lower differs from Python `casefold()`). Expected
casefold and full-pipeline outputs are committed in
`mobile/tests/fixtures/exercise-library-negative.json` (`--regen-casefold`), so Jest
needs no live Python for them. Regeneration requires Python with Unicode 15.x data.

## Kilo aliases

`aliases.json` holds Kilo-specific spellings (for example `Romanian deadlifts`) as
`{ alias, target }`, where `target` is an input the library already resolves. They
are consulted only when the library answers `unknown`, so they never shadow a library
record, and the source dataset is untouched. An alias keeps its target's match type
(`family_only` or `ambiguous`); results carry `source: 'kilo_alias'` and `aliasTarget`
so provenance is visible. There is no stemming; add spellings individually and bump
`alias_version`.

## Primary movement taxonomy (#1579)

`primaryGroups.json` is an explicit, curated mapping: every catalog exercise has
exactly one primary group, plus a family entry (the group when all members agree,
otherwise `null`). Movement patterns and muscles stay separate dataset fields; the
group is never "the first listed pattern or muscle". The 26 stable IDs: horizontal
push, vertical push, horizontal pull, vertical pull, squat, lunge/step, hip hinge,
hip extension, knee flexion, knee extension, calf/ankle, shoulder isolation, elbow
flexion, elbow extension, hip abduction/adduction, forearm/grip, trunk movement,
trunk stability, loaded carry, Olympic lift, jump/throw, mixed conditioning, cardio,
mobility, stretching, and `unclassified` (the result for unknown or disagreeing
input; no catalog exercise uses it).

Tie rules for hybrids: (1) group by the movement the exercise exists to load, with a
limiting stabilizer deciding only when no external-load pattern leads (renegade row
and Copenhagen plank follow their stabilizer; dynamic side plank hip lift is trunk
movement, static side plank is trunk stability); (2) single-joint deltoid and scapular
work is shoulder isolation, while chest fly stays horizontal push; (3) lat-dominant
shoulder extension (pullover, straight-arm pulldown) is vertical pull; (4) thruster
is mixed conditioning, jerk is an Olympic lift, push press stays vertical push;
(5) glute-ham raise is knee flexion with hip extension as a secondary pattern;
(6) loaded locomotion without a carried implement (sled) is mixed conditioning.

Helpers (read-only, nothing persisted or memoized):

- `primaryMovementGroups.js`: `resolvePrimaryMovementGroup(input, { overrides })`
  returns `groupId`, `basis` (`exercise`, `family`, `candidates`, or `none`) and the
  untouched legacy `movementGroups.js` result. A user's saved override stays
  authoritative in `legacy`; the library group never narrows or replaces it.
- `exerciseMetadata.js`: `getExerciseMetadata(input)` and
  `enrichParsedExercises(list)` accept the original parsed name (string or `{ name }`)
  and keep it as `input`. An exact or alias match supplies every field; a family or
  ambiguous candidate set supplies a field only when its members agree on it, so
  unknown equipment never suppresses agreed movement data and muscles are never
  unioned. `secondaryMovementPatterns` are the patterns outside the group's primary motion (the
  group's own patterns plus `primary_pattern_exceptions` for tie-rule families such as
  pullover); every exercise keeps at least one primary pattern.
  Results are fresh frozen records carrying dataset, taxonomy, and alias versions.

Warm-up, working, and cooldown are occurrence context, independent of exercise type
and ignored here. Classification implies no equivalent fatigue and no prescription
eligibility. `exercise_classifications` (persisted progression status) is unrelated
and is not read or recomputed.

## Training breakdown in Analytics (#1580)

`mobile/lib/data/trainingBreakdown.js` (`deriveTrainingBreakdown`) turns the library
into an additive `trainingBreakdown` result of `deriveAnalytics()`; no existing signal,
history key, selection, or save-time field reads it. It uses the sections
`deriveParsedSections` already projected through `workoutHistoryPopulation`, so the
Recovery exclusion boundary is applied once, there. The screen holds the section in its
pending state until that boundary is verified; unknown membership is never fed in as an
empty exclusion set.

- **Counting.** Logged session units come from the existing `_occurrenceEntries`
  semantics, so a collapsed row such as `135 5,5,5` is its three parsed sets. Warm-up
  sections, skipped entries and sets, unparsed rows, and empty prescriptions add
  nothing; a deload note counts like any ordinary note. Timed holds and cardio/non-lift
  activity (including a logged cardio entry that did not parse into sets) are tallied
  as activity entries and never become strength sets or enter classification coverage.
- **Identity.** Enrichment reads the original parsed name (`getExerciseMetadata`), so
  `RDL` and `Romanian Deadlift` stay distinct names behind each row even though legacy
  history grouping may merge them. Library IDs describe metadata and do not replace
  `normalizeExerciseKey()`.
- **Movement.** Each completed set sits in exactly one bucket and the buckets plus
  `unclassified` reconcile to the total. A note-scoped authored choice
  (`exercise_movement_groups` on that set's own note) wins and keeps its legacy label;
  an unreadable map falls back to the library group and is reported.
- **Muscles and equipment.** Primary-target and secondary-involvement counts are
  separate and multi-attributed, as are implements; they are not summed into a unique
  set total and do not claim measured stimulus or fatigue. Unknown values stay
  unknown without losing the movement group, and the library's equipment is shown as
  recorded (a generic weighted exercise never implies a vest or belt).
- **Coverage.** Each view reports its own field-specific known-set coverage.

### Ranges, regions and comparisons (#1589)

`deriveTrainingBreakdownForRange(parsedSections, range, { now, populationVerified })`
in `trainingBreakdown.js` returns the `deriveTrainingBreakdown` shape plus
`muscles.regions` and `movement.comparisons`; `deriveTrainingBreakdown` itself is
unchanged, and the All result minus those two fields deep-equals it. Nothing is
persisted or cached; range selection and invalidation belong to the caller (#1588).

- **Ranges** (`trainingBreakdownRange.js`): `30D`, `90D`, `All`. Selection runs over
  the recovery-filtered `normalNotes`/`noteSectionsList` from `deriveParsedSections`,
  keeping each note paired with its sections. The date is `note.date` only;
  `YYYY-MM-DD` is a device-local calendar date. Bounded ranges are today through
  today-(N-1) local calendar days inclusive (no N x 24h), future dates excluded;
  notes with a missing or unparseable date appear only in All. `now` is injectable.
- **Degradation.** `populationVerified: false` (Recovery membership unknown) returns
  `null` for every range. Bounded ranges also return `null` without usable note
  pairing or a valid `now`; they never fall back to `allSections`. All keeps the
  legacy `allSections` fallback.
- **Regions** (`trainingBreakdownMappings.js`, `MUSCLE_REGIONS`: ordered
  `[{ id, label, muscles }]`, ids `chest back shoulders arms legs core`). Each
  `muscles.regions` entry is `{ id, label, sets, exercises: [{ key, name, sets }] }`,
  zero-set regions included. A region's sets are distinct completed sets with at
  least one primary muscle in it: once per region, possibly in several regions;
  secondary involvement never counts. `validateRegionCoverage(ids)` returns ids
  mapping to zero or several regions; tests require every bundled primary id to map
  to exactly one. `regionForMuscle(id)` serves per-muscle strips and region sheets.
- **Comparisons** (`MOVEMENT_COMPARISONS`: `[{ id, label, sides: [{ id, label, groups }] }]`).
  `push_pull`: push = horizontal/vertical push, pull = horizontal/vertical pull;
  `knee_hip`: knee = squat, lunge_step, knee_extension, hip = hip_hinge,
  hip_extension. Output entries are `{ id, label, totalSets, sides: [{ id, label,
  sets, share }] }`; `totalSets` is the two sides' sum and shares are 0 when it is 0.
  Saved override (`legacy:*`) buckets and Unclassified are on neither side. Counts
  are descriptive only: no balance verdict, score, stimulus or fatigue claim.
- **Short names** (`MUSCLE_SHORT_NAMES`, `muscleShortName(id, fallback)`): display
  labels such as Glutes or Side delts. They never change ids, keys or grouping.

## Recovery movement groups (#1581)

`mobile/lib/data/recoveryMovementGroups.js` places each Recovery lift (baseline roster
plus lifts added during recovery) in exactly one display bucket, read by the shared
Recovery snapshot. Strength cohort, percents, per-lift values, denominators, pace and
the frozen baseline are inputs only; regrouping never recomputes them.

- **Order of authority.** A saved choice on the baseline note wins exactly as stored.
  Otherwise the library classifies the frozen baseline record's own `name`, or, for a
  lift added during recovery, every original parsed name in the block's week notes
  that maps to its history key (they must agree) (source `library`).
  When the library cannot (unknown name, disagreeing candidates, or a record with no
  name), the existing keyword rules decide and the source is shown as
  "Automatic (name keywords)", never as library certainty. The normalized key is
  never fed to the library, so a frozen coarse name (for example `RDL`) keeps exactly
  the specificity it recorded.
- **Saved choices.** `{version: 1}` maps keep their eight broad ids and meaning; such
  a lift stays in its broad bucket with the existing label ("Your earlier broad
  choice"). Detailed choices are written as `{version: 2}`; the first detailed edit
  upgrades the map and carries every other value over unchanged, and later edits
  never downgrade it. In cloud mode a version 2 write is first checked against the
  server's validator; if the server does not accept it nothing is stored and the
  editor shows the choice as not saved. Reset removes only that key. Rendering never writes.
- **Editor.** Options are the detailed groups listed under their broad family. A broad
  option is shown only when it is the current group (an earlier choice or keyword
  fallback).
- **Older clients.** A client that knows only version 1 reads a version 2 map as
  unreadable: rules-only grouping, editing unavailable, no write. Its ordinary note
  saves patch other fields and leave the map intact, and its backup restore rejects
  such a backup rather than dropping the map.
- **Known limit.** Analytics' Training breakdown labels a note-scoped choice with
  `movementGroupLabel`, so a detailed choice there appears as its own
  `legacy:<id>` row beside the library row of the same name.

## Validation

- `python3 scripts/validate-exercise-library.py` checks vocabulary and references,
  unique IDs, normalized name/alias and family collisions, ambiguity records,
  redirects, and that every claimed summary count equals actual contents.
- `--mutations mobile/tests/fixtures/exercise-library-negative.json` applies six
  mutations (duplicate ID, unknown equipment, dangling family, alias collision,
  redirect to a missing exercise, ambiguity shadowed by an exercise); each must be
  rejected.
- `mobile/tests/exercise-library.test.js` runs both, then all 220 fixtures against
  the application resolver, plus normalization-equivalence and immutability cases.

The owner's reported 20,063 assertion evaluations and six rejected mutations were
not reproduced as such: the original validator source was not used, so assertion
counts differ. The independent checks above are what this repository runs; all 220
fixtures pass against the JavaScript resolver. Expert biomechanical review remains
unperformed (see `validation_summary.limitations`).
