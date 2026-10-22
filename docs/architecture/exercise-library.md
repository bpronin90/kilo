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
