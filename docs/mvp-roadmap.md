# MVP Roadmap For Kilo

## MVP Definition
Kilo MVP is a single-user logging product for workouts and bodyweight with a reliable path from input to saved record to visible history. The MVP should let a user enter a workout or weight entry, have the system parse and validate it well enough to prevent obvious bad data, persist it in Supabase, and show the saved results back in a simple UI with basic correction flows.

MVP non-goals:
- Coaching
- Recommendations
- Advanced analytics
- Social features
- Multi-user collaboration
- Wearables or import integrations
- Automation beyond core parsing
- Broad settings or customization
- Prototype-only work that does not directly support the logging loop

## Current Migration Status

The repo now has a real native app scaffold under `mobile/`.

- Issue #35 defined `mobile/` as the active native-app path and split the
  migration into UI work and parser/storage work.
- Issue #36 completed the native UI shell for Home, Log, Weight, and Stats.
- Issue #37 completed the native parser port, local data model, AsyncStorage
  persistence layer, and native save/reload loop for weight and workout
  entries.

The browser prototype still remains the broader behavior reference for
prototype-only screens and analytics, but `mobile/` now covers the first native
MVP create/store/retrieve milestone locally.

## Ordered MVP Roadmap

### Native Migration Contract
- Phase goal: move from prototype-wrapper ambiguity to an explicit native-app
  implementation path without changing the locked MVP product scope.
- Allowed scope: migration boundary, first-slice ownership, milestone
  definition, and acceptance criteria for the first native-app checkpoint.
- Explicit out of scope: backend wiring, broad redesign, parser expansion, or
  deleting the legacy prototype path.
- Dependency: current prototype behavior remains the reference source until the
  native path has matching MVP loop coverage.
- Completion condition: implementation agents can proceed in `mobile/` without
  guessing whether the prototype-wrapper or native path is the real app.

Ordered tasks:

#### Task 1: Define the active app path
- Session goal: remove ambiguity about which runtime is the future app.
- Intended agent: `codex`
- Allowed scope: document the role of `mobile/` versus the legacy prototype
  path.
- Explicit out of scope: implementation.
- Dependency: none.
- Verification target: one clear statement that `mobile/` is the active app
  path and the repo root remains temporary reference/runtime only.
- Stop condition: later issues do not need to guess where app work belongs.

#### Task 2: Split first implementation ownership
- Session goal: isolate UI work from parser/storage work for the first native
  migration slices.
- Intended agent: `codex`
- Allowed scope: issue boundaries, ownership, acceptance criteria.
- Explicit out of scope: coding.
- Dependency: Define the active app path.
- Verification target: one UI implementation slice and one data implementation
  slice with non-overlapping responsibilities.
- Stop condition: implementation can proceed without cross-agent ownership
  confusion.

#### Task 3: Define the first native MVP milestone
- Session goal: create a concrete checkpoint for native MVP progress before any
  broader launch claim.
- Intended agent: `codex`
- Allowed scope: milestone acceptance criteria tied to the locked MVP loop.
- Explicit out of scope: backend or post-MVP capability.
- Dependency: Split first implementation ownership.
- Verification target: milestone covers native Home, Log, Weight, Stats, local
  save/retrieve loop, and explicit UI/data module boundaries.
- Stop condition: the first native checkpoint can be reviewed as pass/fail.

### Phase 1: Lock The MVP Contract
- Phase goal: turn the current spec into a strict implementation contract for MVP only.
- Allowed scope: product spec cleanup, acceptance criteria, terminology, and explicit MVP boundaries.
- Explicit out of scope: implementation, schema work, UI building, parser tuning, prototype expansion.
- Dependency: none.
- Completion condition: the team has one stable MVP definition with accepted entities, user flows, and non-goals.

Ordered tasks:

#### Task 1: Finalize MVP user flows
- Session goal: lock the minimum end-to-end flows required for launch.
- Intended agent: `codex`
- Allowed scope: define the exact MVP flows for logging weight, logging workouts, reviewing saved entries, and correcting mistakes.
- Explicit out of scope: field-level implementation details, future features, admin workflows.
- Dependency: none.
- Verification target: written flow list with acceptance criteria for each flow.
- Stop condition: every MVP flow is either included now or explicitly deferred.

MVP flows included for launch:

1. Log a weight entry
   - Flow: the user enters one weight entry, submits it, receives a clear save result, and can later see that saved weight entry in recent history.
   - Acceptance criteria:
     - A valid weight entry can move from input to saved record without requiring any manual database or admin step.
     - An invalid weight entry is blocked before save with a clear failure result.
     - A successful weight save is visible in the product as a recent saved entry.

2. Log a workout entry
   - Flow: the user enters one workout entry, submits it, receives a clear save result, and can later see that saved workout entry in recent history.
   - Acceptance criteria:
     - A valid workout entry can move from input to saved record without requiring any manual database or admin step.
     - An invalid workout entry is blocked before save with a clear failure result.
     - A successful workout save is visible in the product as a recent saved entry.

3. Review saved recent entries
   - Flow: after saving weight or workout data, the user can open the product and verify the most recent saved entries in a simple history view.
   - Acceptance criteria:
     - Recent history shows newly saved entries in a predictable order.
     - Each recent entry exposes enough detail for the user to confirm what was saved.
     - Review of saved entries does not depend on prototype-only tools or direct database access.

4. Correct an obvious recent mistake
   - Flow: if the user notices a clearly wrong recent weight or workout entry, the user can correct or remove that recent entry without leaving the product.
   - Acceptance criteria:
     - The user can fix or remove at least one obviously wrong recent entry through a product flow.
     - The corrected result is reflected in recent history after the action completes.
     - Correction does not require revision history, bulk editing, or direct database access.

Flows explicitly deferred from MVP:

- Field-level authoring conveniences such as advanced helpers, smart defaults, or guided entry composition.
- Flexible free-form parsing beyond the constrained MVP input formats.
- Admin or support workflows for managing user data.
- Bulk entry, imports, exports, or wearable sync.
- Analytics, trends, coaching, or recommendations.
- Multi-user collaboration, sharing, or social flows.
- Settings, customization, or other non-core account management flows.

#### Task 2: Freeze MVP entities and terminology
- Session goal: define the minimum domain objects and names the rest of the work depends on.
- Intended agent: `codex`
- Allowed scope: user-facing terms and the minimum record shapes implied by the product spec.
- Explicit out of scope: database migration design, API contracts, parser internals.
- Dependency: Finalize MVP user flows.
- Verification target: one approved list of core entities and terms.
- Stop condition: no unresolved naming or entity ambiguity remains for MVP sequencing.

Approved MVP entities and terms:

1. Entry
   - Definition: the top-level saved record shown in recent history and targeted by correction flows.
   - MVP rule: every saved item in MVP is an `entry`, and every entry is exactly one of two entry types: `weight entry` or `workout entry`.

2. Weight entry
   - Definition: one saved bodyweight log created from one successful weight submission.
   - Minimum record shape:
     - Entry identifier
     - Entry type = weight
     - Weight value
     - Effective date or timestamp for when the weight was logged
     - Saved timestamp for ordering and confirmation

3. Workout entry
   - Definition: one saved workout log created from one successful workout submission.
   - MVP rule: a workout entry is the full unit the user saves, reviews, edits, or deletes. It is not a single set and not a cross-workout program record.
   - Minimum record shape:
     - Entry identifier
     - Entry type = workout
     - Workout date or timestamp
     - One or more workout items
     - Saved timestamp for ordering and confirmation

4. Workout item
   - Definition: one exercise line within a workout entry.
   - MVP rule: workout items exist only inside a workout entry and are not shown as standalone entries in recent history.
   - Minimum record shape:
     - Exercise name
     - Logged result details needed to show what was saved for that exercise line

5. Recent history
   - Definition: the simple user-visible list of recently saved entries.
   - MVP rule: recent history is a combined view of weight entries and workout entries ordered by recency, with enough visible detail for the user to confirm what was saved.

6. Correction
   - Definition: the MVP action that lets the user fix or remove an obviously wrong recent entry.
   - MVP rule: correction applies to an existing saved entry and results in either an updated entry or a removed entry that is no longer shown as active history.

Terms explicitly not used as separate MVP entities:

- `log` is a user action or a generic verb, not a persisted entity name.
- `record` and `saved record` are generic descriptions; the canonical product term is `entry`.
- `workout` by itself is ambiguous. Use `workout entry` for the saved top-level object and `workout item` for an exercise line inside it.
- `history` means recent saved entries only. It does not imply analytics, trends, or audit history.

#### Task 3: Define MVP acceptance gates
- Session goal: turn the spec into release gates that later phases can satisfy.
- Intended agent: `codex`
- Allowed scope: launch checklist, must-pass behaviors, explicit non-goals.
- Explicit out of scope: test implementation, QA execution, performance tuning beyond core expectations.
- Dependency: Freeze MVP entities and terminology.
- Verification target: short acceptance checklist covering logging, storage, retrieval, and correction.
- Stop condition: later implementation work can be judged against a fixed MVP bar.

MVP acceptance checklist:

1. Logging gates
   - A user can submit one valid weight entry and one valid workout entry through the product without manual database intervention.
   - Invalid weight and workout submissions are blocked before save with a clear product-visible failure result.
   - Successful saves return a clear product-visible confirmation that the entry was accepted.

2. Storage gates
   - Every successful save creates exactly one top-level `entry` persisted as either a `weight entry` or a `workout entry`.
   - Every saved `weight entry` includes an entry identifier, entry type, weight value, effective logged date or timestamp, and saved timestamp.
   - Every saved `workout entry` includes an entry identifier, entry type, workout date or timestamp, at least one workout item, and saved timestamp.
   - Workout items are stored only as part of their parent workout entry and are not treated as standalone entries.

3. Retrieval gates
   - Recent history shows both weight entries and workout entries in one predictable recency-ordered view.
   - A newly saved weight or workout entry becomes visible in recent history without direct database access or prototype-only tooling.
   - Each visible recent entry exposes enough saved detail for the user to confirm what was logged.

4. Correction gates
   - The user can correct or remove at least one obvious recent mistake for either entry type through a product flow.
   - A correction updates the existing entry result or removes that entry from active recent history.
   - Correction does not depend on revision history, bulk editing, admin tooling, or direct database access.

5. MVP non-goal gates
   - MVP launch does not require coaching, recommendations, analytics, social features, collaboration, wearables, imports, exports, or broad settings.
   - MVP launch does not require flexible free-form parsing beyond the constrained accepted input formats.
   - MVP launch does not require account-management breadth, admin/support workflows, or prototype-only behavior outside the core logging loop.

### Phase 2: Data Foundation
- Phase goal: establish the minimum persisted model and app plumbing needed for logging.
- Allowed scope: Supabase schema, write/read path design, validation boundaries, environment setup needed for MVP.
- Explicit out of scope: parser sophistication, broad UI polish, analytics, reporting.
- Dependency: Phase 1 complete.
- Completion condition: the app has a stable minimal data model and a verified save/read foundation for MVP records.

Ordered tasks:

#### Task 1: Define persisted record model
- Session goal: translate MVP entities into the minimum durable storage model.
- Intended agent: `claude`
- Allowed scope: tables, required fields, relationships, and deletion or update expectations for MVP.
- Explicit out of scope: speculative extensibility, non-MVP metrics, reporting tables.
- Dependency: Phase 1 complete.
- Verification target: schema proposal matches every Phase 1 MVP flow.
- Stop condition: no MVP flow requires an undefined persisted record.

Persisted record model:

**weight_entries**

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key, entry identifier |
| entry_type | TEXT | Constant value `'weight'` |
| weight_value | NUMERIC | Numeric weight as submitted |
| weight_unit | TEXT | `'kg'` or `'lb'` |
| logged_at | TIMESTAMPTZ | Effective date the weight was recorded |
| saved_at | TIMESTAMPTZ | When the record was persisted |

**workout_entries**

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key, entry identifier |
| entry_type | TEXT | Constant value `'workout'` |
| workout_date | DATE | Effective date of the workout |
| saved_at | TIMESTAMPTZ | When the record was persisted |

**workout_items**

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| workout_entry_id | UUID | Foreign key to `workout_entries.id` |
| exercise_name | TEXT | Name of the exercise |
| result_kind | TEXT | `'sets'` for per-set logged results or `'note'` for note-only lines |
| note_text | TEXT | Required when `result_kind = 'note'`; null for per-set lines |
| position | INTEGER | Ordering within the parent workout entry |

**workout_item_sets**

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| workout_item_id | UUID | Foreign key to `workout_items.id` |
| set_index | INTEGER | 1-based ordering within the workout item |
| weight_value | NUMERIC | Logged load for the set; null for bodyweight-only sets |
| weight_unit | TEXT | `'kg'` or `'lb'`; null for bodyweight-only sets |
| rep_count | INTEGER | Logged reps for the set; null when the set is time-based only |
| duration_seconds | INTEGER | Logged duration for the set; null for rep-based sets |
| assistance_value | NUMERIC | Logged assistance amount when applicable; null otherwise |
| assistance_unit | TEXT | Unit for assistance when applicable; null otherwise |
| note_text | TEXT | Optional short note for unusual set results |

Relationships:
- Each `workout_entry` has one or more `workout_items`.
- `workout_items` do not exist without a parent `workout_entry`.
- Each `workout_item` is either a note-only line or has one or more `workout_item_sets`.
- `workout_item_sets` do not exist without a parent `workout_item`.
- Deleting a `workout_entry` cascades to all its `workout_items`.
- Deleting a `workout_item` cascades to all its `workout_item_sets`.

Update and delete semantics (MVP correction flows):
- A `weight_entry` can be updated in-place (`weight_value`, `weight_unit`, `logged_at`) or hard-deleted.
- A `workout_entry` can be hard-deleted (cascades to all child rows) or updated in-place (`workout_date`, item list replacement).
- No revision or audit history is required for MVP.
- No soft-delete is required for MVP; a deleted entry is removed from active recent history immediately.

Phase 1 flow coverage:
- Log a weight entry: `weight_entries` captures all required fields; `saved_at` provides confirmation ordering.
- Log a workout entry: `workout_entries` + `workout_items` + `workout_item_sets` captures the full save, including mixed weights, uneven sets, bodyweight cases, and note-only lines; `saved_at` provides confirmation ordering.
- Review saved recent entries: ordering by `saved_at` desc across both entry tables provides a recency-ordered history; the child rows preserve enough detail to show exactly what was saved.
- Correct an obvious recent mistake: in-place update and hard delete are defined for both entry types with no dependency on revision history or admin access.

#### Task 2: Establish validation and write boundaries
- Session goal: define where invalid or partial data is rejected before persistence.
- Intended agent: `claude`
- Allowed scope: input validation boundaries, canonical save shape, minimal error categories.
- Explicit out of scope: parser heuristics, UI copy polish, future import rules.
- Dependency: Define persisted record model.
- Verification target: clear pass or fail cases for each record type.
- Stop condition: save behavior is predictable enough for parser and UI work to proceed.

Validation and write-boundary contract:

**Validation boundary**

Validation runs after parsing and before any write to the database. A submission that fails validation is rejected entirely. No partial writes occur.

For weight entries, a single-row write is atomic by default. For workout entries, the full write spans `workout_entries`, `workout_items`, and `workout_item_sets`. All rows for a single submission must be written in one atomic operation. If any part of the write fails, the entire submission is rolled back and no rows from that submission are persisted. The same atomicity requirement applies to workout entry updates (including item list replacement) and deletes (including cascade to child rows).

**Weight entry — required fields at the boundary**

| Field | Rule |
|---|---|
| `weight_value` | Required. Must be a positive number greater than zero. |
| `weight_unit` | Required. Must be exactly `'kg'` or `'lb'`. No other values accepted. |
| `logged_at` | Required. Must be a valid timestamp. If the submission omits it, the parser must supply the current time before reaching the boundary. The boundary does not default it. |

Pass: `{ weight_value: 72.5, weight_unit: 'kg', logged_at: <valid timestamp> }` → write proceeds.

Fail examples:
- `weight_value` is zero, negative, or non-numeric → rejected.
- `weight_unit` is missing, `'lbs'`, `'kilos'`, or any non-canonical string → rejected.
- `logged_at` is missing or not a valid timestamp → rejected.

**Workout entry — required fields at the boundary**

Top-level:

| Field | Rule |
|---|---|
| `workout_date` | Required. Must be a valid date. If the submission omits it, the parser must supply the current date before reaching the boundary. |
| `items` | Required. Must contain at least one workout item. An entry with an empty item list is rejected. |

Per workout item:

| Field | Rule |
|---|---|
| `exercise_name` | Required. Must be a non-empty string after trimming whitespace. |
| `result_kind` | Required. Must be exactly `'sets'` or `'note'`. |
| `note_text` | Required when `result_kind = 'note'`. Must be a non-empty string. Must be null when `result_kind = 'sets'`. |
| `sets` | Required when `result_kind = 'sets'`. Must contain at least one set. Must be absent or null when `result_kind = 'note'`. |
| `position` | Required. Must be a positive integer unique within the parent entry. |

Per workout item set (applies when `result_kind = 'sets'`):

| Field | Rule |
|---|---|
| `set_index` | Required. Must be a positive integer unique within the parent item. |
| `rep_count` or `duration_seconds` | Exactly one must be present and greater than zero. A set where both are present is rejected. A set where neither is present is rejected. A rep-based set has `rep_count` set and `duration_seconds` null. A time-based set has `duration_seconds` set and `rep_count` null. |
| `weight_value` | Optional. If present, must be a positive number greater than zero. |
| `weight_unit` | Required when `weight_value` is present. Must be `'kg'` or `'lb'`. Must be null when `weight_value` is absent. |
| `assistance_value` | Optional. If present, must be a positive number greater than zero. |
| `assistance_unit` | Required when `assistance_value` is present. Must be `'kg'` or `'lb'`. Must be null when `assistance_value` is absent. |
| `note_text` | Optional. May be null or a non-empty string. Empty string is not accepted. |

Pass: a workout entry with `workout_date`, at least one item with a non-empty `exercise_name`, `result_kind = 'sets'`, and at least one set with a valid `rep_count` → write proceeds.

Fail examples:
- `workout_date` is missing or not a valid date → rejected.
- No items present → rejected.
- Any item has an empty or whitespace-only `exercise_name` → rejected.
- Any item has `result_kind = 'sets'` with no sets → rejected.
- Any item has `result_kind = 'note'` with a null or empty `note_text` → rejected.
- Any set has neither `rep_count` nor `duration_seconds` → rejected.
- Any set has both `rep_count` and `duration_seconds` present → rejected.
- Any set has `weight_value` without a valid `weight_unit` → rejected.

**Canonical save shape**

When validation passes, the following shape is written to the database. Server-generated values (`id`, `saved_at`) are assigned at write time and not accepted from input.

Weight entry canonical shape:

```
id            → server-generated UUID
entry_type    → 'weight'
weight_value  → validated numeric value from input
weight_unit   → validated 'kg' or 'lb' from input
logged_at     → validated timestamp from input (parser-supplied if omitted by user)
saved_at      → server-generated write timestamp
```

Workout entry canonical shape:

```
id            → server-generated UUID
entry_type    → 'workout'
workout_date  → validated date from input (parser-supplied if omitted by user)
saved_at      → server-generated write timestamp
items:
  id                → server-generated UUID
  workout_entry_id  → parent entry id
  exercise_name     → validated non-empty string
  result_kind       → 'sets' or 'note'
  note_text         → non-null string when result_kind = 'note'; null otherwise
  position          → validated positive integer
  sets (when result_kind = 'sets'):
    id               → server-generated UUID
    workout_item_id  → parent item id
    set_index        → validated positive integer
    rep_count        → validated positive integer or null
    duration_seconds → validated positive integer or null
    weight_value     → validated positive numeric or null
    weight_unit      → 'kg', 'lb', or null
    assistance_value → validated positive numeric or null
    assistance_unit  → 'kg', 'lb', or null
    note_text        → non-empty string or null
```

**Error categories**

| Category | Condition |
|---|---|
| `missing_required_field` | A required field is absent or null when a value is expected. |
| `invalid_field_value` | A field is present but fails its type or range rule (e.g., non-positive number, non-canonical unit string, invalid date). |
| `structural_violation` | The overall shape is invalid regardless of individual field values (e.g., workout with no items, `result_kind = 'sets'` with no sets, `result_kind = 'note'` with sets present). |
| `correction_target_not_found` | An update or delete references an entry id that does not exist. |

No other error categories are required for MVP. These four cover every pass or fail case in the MVP save and correction paths.

**Correction request validation**

Before an update or delete is applied, the following rules are checked in order:

1. The target entry `id` must exist in the relevant table. If it does not, the request fails with `correction_target_not_found`.
2. For an update, the replacement field values must pass the same validation rules as a new submission. The same required fields, value rules, and structural constraints apply.
3. For a delete, no field validation is required beyond confirming the target exists.

No revision history is created. A deleted entry is removed immediately. An updated entry replaces its previous values in place.

**Pass and fail summary**

| Case | Result |
|---|---|
| Valid weight entry with all required fields | Pass — write proceeds |
| Weight entry with zero or negative `weight_value` | Fail — `invalid_field_value` |
| Weight entry with missing or non-canonical `weight_unit` | Fail — `missing_required_field` or `invalid_field_value` |
| Weight entry with missing `logged_at` | Fail — `missing_required_field` |
| Valid workout entry with at least one item and one set | Pass — write proceeds |
| Workout entry with no items | Fail — `structural_violation` |
| Workout item with empty `exercise_name` | Fail — `invalid_field_value` |
| Workout item with `result_kind = 'sets'` and no sets | Fail — `structural_violation` |
| Workout item set with neither `rep_count` nor `duration_seconds` | Fail — `structural_violation` |
| Workout item set with both `rep_count` and `duration_seconds` present | Fail — `structural_violation` |
| Workout item set with `weight_value` but no `weight_unit` | Fail — `missing_required_field` |
| Delete targeting an existing entry id | Pass — delete proceeds |
| Delete targeting a nonexistent entry id | Fail — `correction_target_not_found` |
| Update with valid replacement fields | Pass — update proceeds |
| Update with invalid replacement fields | Fail — same category as initial save failure |

#### Task 3: Verify read path for recent history
- Session goal: confirm the minimum query or view model needed for MVP history screens.
- Intended agent: `claude`
- Allowed scope: recent entries retrieval, ordering, basic grouping if required by MVP.
- Explicit out of scope: dashboards, trends, aggregations, performance work beyond obvious blockers.
- Dependency: Establish validation and write boundaries.
- Verification target: each MVP history or review flow can be served from the proposed read path.
- Stop condition: UI work does not need to invent data access behavior later.

Recent history read-path contract:

**Ordering guarantee**

Recent history is ordered by `saved_at` DESC. `saved_at` is the server-generated write timestamp set at persist time and is the sole ordering field. No secondary sort is required for MVP. No client-supplied ordering is accepted.

**Combined view**

Recent history is a single list that mixes weight entries and workout entries. Both types are fetched together and sorted by `saved_at` DESC. The UI does not issue separate per-type queries for the list view. Each row in the list exposes `entry_type` so the UI can dispatch rendering without additional lookups.

**List query scope**

The list query returns the N most recently saved entries across both entry types, where N is a UI-defined limit. The minimum required limit for MVP is 20. No offset-based pagination or cursor-based pagination is required for MVP. The list query does not filter by entry type, date range, or any other field.

**Minimum fields returned per entry type**

Weight entry row:

| Field | Purpose |
|---|---|
| `id` | Required for correction target. |
| `entry_type` | Always `'weight'`. Used for UI dispatch. |
| `weight_value` | Show what was logged. |
| `weight_unit` | Show what was logged. |
| `logged_at` | Show the effective logged date. |
| `saved_at` | Ordering field. |

Workout entry row:

| Field | Purpose |
|---|---|
| `id` | Required for correction target. |
| `entry_type` | Always `'workout'`. Used for UI dispatch. |
| `workout_date` | Show the effective workout date. |
| `saved_at` | Ordering field. |

**Workout items and sets**

Workout items and sets are not included in the list query. After the list query returns, the UI issues one child query for workout items keyed on `workout_entry_id IN (<ids of workout entries in the list>)`. That query returns all `workout_items` rows for those entries ordered by `position` ASC. For items with `result_kind = 'sets'`, a second child query fetches `workout_item_sets` keyed on `workout_item_id IN (<ids of set-based items>)`, ordered by `set_index` ASC. The UI assembles the nested structure in memory before rendering.

Minimum fields from `workout_items`:

| Field | Purpose |
|---|---|
| `id` | Join key for set fetch. |
| `workout_entry_id` | Join key for parent assembly. |
| `exercise_name` | Show what exercise was logged. |
| `result_kind` | Dispatch: `'sets'` or `'note'`. |
| `note_text` | Show note when `result_kind = 'note'`. |
| `position` | Ordering within the entry. |

Minimum fields from `workout_item_sets`:

| Field | Purpose |
|---|---|
| `workout_item_id` | Join key for parent assembly. |
| `set_index` | Ordering within the item. |
| `rep_count` | Show logged reps (null for time-based sets). |
| `duration_seconds` | Show logged duration (null for rep-based sets). |
| `weight_value` | Show load if present. |
| `weight_unit` | Show load unit if present. |
| `assistance_value` | Show assistance if present. |
| `assistance_unit` | Show assistance unit if present. |
| `note_text` | Show set note if present. |

**Correction flow read requirements**

Before applying a correction, the UI must have the target entry `id` in hand. The `id` is always present in the list query result. No additional read is required to initiate a correction. The correction request sends the `id` directly to the write path, which validates existence before applying the change.

**Read-path constraints the UI must respect**

1. The UI must not invent a secondary sort or reorder entries beyond `saved_at` DESC.
2. The UI must not filter entries by type in the combined list view.
3. The UI must not assume workout items or sets are available without issuing the child queries described above.
4. The UI must use the `id` field from the read result as the correction target. It must not construct or derive entry ids from other fields.
5. The UI must not issue per-row item queries inside a render loop. Item and set fetches are batched across all workout entries returned by the list query.
6. The UI must not read directly from `workout_items` or `workout_item_sets` for the combined list ordering. Ordering always derives from the parent entry's `saved_at`.

**Flow coverage**

| MVP flow | Served by |
|---|---|
| Review saved recent entries | List query (both entry types, `saved_at` DESC) + child queries for workout items and sets. |
| Confirm what was saved (weight) | `weight_value`, `weight_unit`, `logged_at` from list query row. |
| Confirm what was saved (workout) | `workout_date` from list query row; exercise names, sets, reps, durations, loads from child queries. |
| Correct an obvious recent mistake | `id` from list query row passed directly to write path. |

### Phase 3: Input And Parsing
- Phase goal: make workout and weight entry creation usable enough for MVP.
- Allowed scope: minimum parser behavior, fallback input constraints, parse error handling.
- Explicit out of scope: natural-language ambition beyond MVP, bulk import, parser optimization for edge formats.
- Dependency: Phase 2 complete.
- Completion condition: a user can create valid workout and weight records through a constrained, reliable input path.

Ordered tasks:

#### Task 1: Define accepted MVP input formats
- Session goal: narrow the input surface so parser work stays disciplined.
- Intended agent: `codex`
- Allowed scope: accepted syntax or examples for workout entries and weight entries.
- Explicit out of scope: flexible free-form language support, legacy or prototype compatibility unless explicitly required.
- Dependency: Phase 2 complete.
- Verification target: finite list of accepted examples and explicit rejected examples.
- Stop condition: parser scope is small enough to implement in one pass without guessing.

Accepted MVP input contract:

**Weight entry input**

- Accepted syntax:
  - `<weight-value>`
- `weight-value` rules:
  - ASCII digits with an optional single decimal point.
  - No sign, commas, unit suffix, date, or note text.
  - Surrounding whitespace is allowed and ignored.
- Accepted examples:
  - `180`
  - `180.4`
  - ` 167.0 `
- Rejected examples:
  - `180 lb`
  - `180lbs`
  - `180,4`
  - `180 / felt light`
  - `2026-05-08 180.4`
  - `one eighty`
  - empty input
- Normalization expectations:
  - Trim leading and trailing whitespace before validation.
  - Parse the value as a numeric `weight_value`.
  - Default `weight_unit` to `lb` for MVP; do not infer `kg` from text.
  - `logged_at` comes from the submission context, not from text typed into the field.

**Workout entry input**

- A workout entry is built from per-exercise row inputs on the log screen.
- Each non-empty row must match exactly one accepted row form.
- Accepted row forms:
  - `-`
  - `<rep-group>`
  - `<load> <rep-group>`
  - `<load> <rep-group> <load> <rep-group>`
  - additional `<load> <rep-group>` pairs may repeat in the same row
- Token rules:
  - `load` is ASCII digits with an optional single decimal point.
  - `rep-group` is one or more positive integers separated by commas, with no trailing comma.
  - Spaces may appear around tokens and after commas; repeated internal spaces are allowed.
- Accepted semantics:
  - `-` means skip this exercise for this workout entry.
  - `<rep-group>` is for rep-only rows with no external load.
  - Each `<load> <rep-group>` pair represents one ordered block of sets at that load.
  - Multiple pairs in one row are allowed for drop or backoff work and are preserved in order.
- Accepted examples:
  - `-`
  - `8,8,8`
  - `80 8,8,8`
  - `85 8 80 8,8`
  - `17.5 12,12`
  - ` 90   8,8,7   85  8 `
- Rejected examples:
  - `5 min`
  - `7.1 for 5`
  - `1x12-15 each arm 12.5 lbs`
  - `80 x 8 x 8 x 8`
  - `80lb 8,8`
  - `80 8/8/8`
  - `80`
  - `8,`
  - `? 12,12`
  - `as55 8,8,8`
  - `80 8,8 note`
  - `book`
- Normalization expectations:
  - Trim leading and trailing whitespace and collapse repeated internal whitespace between tokens.
  - Ignore spaces immediately after commas inside a `rep-group`.
  - Parse `load` tokens as numeric values and rep values as positive integers.
  - Expand each row into ordered set results while preserving the original pair order.
  - For rep-only rows, store `weight_value = null` and `weight_unit = null` for each set.
  - A row containing only `-` does not create a persisted workout item.
  - Blank rows are ignored.
  - A workout entry is invalid if, after ignoring blanks and skipped rows, no valid workout items remain.

Explicit MVP parser boundary decisions:

- Accept only numeric loads plus rep groups for workout logging.
- Reject timed entries, free-form notes, inline units, mixed prose, slash notation, and sample-sheet instruction text.
- Reject legacy or prototype shorthand from the sample files unless it already matches the accepted forms above.
- Do not infer exercise meaning from exercise name text in order to reinterpret the row grammar.

#### Task 2: Build weight-entry parse path
- Session goal: support the simplest valid weight logging path first.
- Intended agent: `claude`
- Allowed scope: parse, validate, normalize, and save weight entries.
- Explicit out of scope: workout parsing, edit history, UI polish.
- Dependency: Define accepted MVP input formats.
- Verification target: accepted weight examples persist correctly; invalid examples fail clearly.
- Stop condition: weight logging is independently functional end to end.

#### Task 3: Build workout-entry parse path
- Session goal: support the minimum valid workout logging path for MVP.
- Intended agent: `claude`
- Allowed scope: parse, validate, normalize, and save workout entries.
- Explicit out of scope: advanced exercise grammar, recommendations, summary analytics.
- Dependency: Build weight-entry parse path.
- Verification target: accepted workout examples persist correctly; invalid examples fail clearly.
- Stop condition: the MVP workout logging loop works without manual database intervention.

### Phase 4: Core UI For Logging
- Phase goal: expose the MVP logging loop in the product UI.
- Allowed scope: primary entry surfaces, success or failure feedback, recent-history visibility.
- Explicit out of scope: advanced navigation, visual polish beyond usability, settings, onboarding expansion.
- Dependency: Phase 3 complete.
- Completion condition: a user can log, confirm, and review entries through the UI without relying on prototype-only tools.

Ordered tasks:

#### Task 1: Add weight logging UI [DONE]
- Session goal: ship the minimum UI path for entering and saving weight.
- Intended agent: `gemini`
- Allowed scope: weight input form or surface, validation feedback, success confirmation.
- Explicit out of scope: workout UI, charts, profile or settings surfaces.
- Dependency: Phase 3 complete.
- Verification target: user can submit a valid weight entry and see confirmation in UI.
- Stop condition: weight logging is usable without hidden or manual steps.

#### Task 2: Add workout logging UI
- Session goal: ship the minimum UI path for entering and saving workouts.
- Intended agent: `gemini`
- Allowed scope: workout input surface, validation feedback, success confirmation.
- Explicit out of scope: history editing, analytics, advanced formatting helpers.
- Dependency: Add weight logging UI.
- Verification target: user can submit a valid workout entry and see confirmation in UI.
- Stop condition: workout logging is usable without prototype-only flows.

#### Task 3: Add recent history view
- Session goal: let the user confirm what was saved.
- Intended agent: `gemini`
- Allowed scope: basic recent entries list and enough detail to verify saved data.
- Explicit out of scope: trends, filtering, exports, deep drilldowns.
- Dependency: Add workout logging UI.
- Verification target: newly saved entries appear in the expected order with core fields visible.
- Stop condition: the MVP loop includes visible feedback after save.

### Phase 5: Correction And Launch Readiness
- Phase goal: remove the last blockers to a usable MVP.
- Allowed scope: basic correction flow, error-state coverage, final acceptance verification, prototype retirement where needed.
- Explicit out of scope: post-MVP enhancements, broad refactors, optimization work without a concrete blocker.
- Dependency: Phase 4 complete.
- Completion condition: the MVP acceptance gates from Phase 1 are satisfied and no core logging flow depends on prototype-only behavior.

Ordered tasks:

#### Task 1: Add minimum correction flow
- Session goal: let users fix or remove an obviously wrong recent entry.
- Intended agent: `gemini`
- Allowed scope: simple edit or delete path for the most recent or recent records, depending on the Phase 1 contract.
- Explicit out of scope: full revision history, bulk editing, audit tooling.
- Dependency: Phase 4 complete.
- Verification target: a bad entry can be corrected without direct database access.
- Stop condition: obvious user mistakes no longer block MVP usability.

#### Task 2: Close parser and validation gaps
- Session goal: fix only the concrete failure cases found against the MVP acceptance gates.
- Intended agent: `claude`
- Allowed scope: targeted parser or validation fixes tied to blocked MVP scenarios.
- Explicit out of scope: parser expansion for non-MVP formats, generalized cleanup.
- Dependency: Add minimum correction flow.
- Verification target: every Phase 1 acceptance case passes on the intended input set.
- Stop condition: remaining parser work is enhancement, not MVP-critical.

#### Task 3: Run MVP acceptance review
- Session goal: verify that the product meets the locked MVP contract and identify only launch-blocking gaps.
- Intended agent: `codex`
- Allowed scope: acceptance review, gap list, release recommendation for MVP readiness.
- Explicit out of scope: implementing fixes, drafting future roadmap beyond blocked items.
- Dependency: Close parser and validation gaps.
- Verification target: explicit pass or fail against every Phase 1 acceptance gate.
- Stop condition: MVP is either ready or reduced to a short blocker list.

### Pre-Launch Repo Readiness Sequence
- Sequence goal: gate manual launch validation behind the minimum repo-readiness artifacts needed for a fast final review.
- Scope: sequencing only. This section defines the required order, dependencies, and exit criteria. It does not replace the follow-up issues that create or update the listed docs.
- Hold statement: issue `#17` remains on hold for launch signoff after code-and-test acceptance until this sequence is complete. Manual launch validation must not begin early.

Ordered readiness sequence:

1. Establish launch review entry points
   - Target artifacts: `README.md` and `docs/current-state.md`
   - Why first: launch review needs one obvious repo entry point and one current snapshot before deeper technical review is efficient.
   - Completion criteria:
     - `README.md` tells a reviewer where the MVP app lives, how to start it, and which deeper docs matter for launch review.
     - `docs/current-state.md` summarizes the actual MVP surface, known constraints, and any important review caveats in current repo terms.
   - Dependency: none.

2. Freeze the minimum architecture note
   - Target artifact: `docs/architecture.md`
   - Why second: launch validation should happen against a stable explanation of the MVP request path, persistence path, and correction path.
   - Completion criteria:
     - The doc explains the minimum end-to-end path for workout logging, weight logging, save behavior, recent history, and correction.
     - Any dependency on Supabase or other required services is explicit enough that a manual reviewer knows what must be running.
   - Dependency: step 1 complete.

3. Freeze the manual validation checklist
   - Target artifact: `docs/testing-and-qa.md`
   - Why third: the launch smoke test must be driven by a short checklist tied to the accepted MVP gates rather than ad hoc clicking.
   - Completion criteria:
     - The doc defines the exact manual launch validation flow for logging, save confirmation, recent-history verification, and obvious-mistake correction.
     - The doc states what counts as a blocker versus a non-blocking follow-up during manual validation.
   - Dependency: steps 1 and 2 complete.

4. Freeze repo-structure orientation
   - Target artifact: `docs/repo-structure.md`
   - Why fourth: this is the last readiness artifact because it supports reviewer speed, but it depends on the launch entry points and architecture notes already being stable.
   - Completion criteria:
     - The doc maps the MVP-relevant repo areas a reviewer may need during launch validation.
     - The doc points to the product entry points, data-touching code, and any test or QA surfaces that the manual reviewer may cross-check.
   - Dependency: steps 1 through 3 complete.

5. Return to issue `#17` for manual launch validation
   - Trigger: use issue `#17` again only after the four readiness artifacts above exist and their scope is complete enough to support reviewer orientation and manual execution.
   - Manual-validation exit criterion:
     - `README.md`, `docs/current-state.md`, `docs/architecture.md`, `docs/testing-and-qa.md`, and `docs/repo-structure.md` all exist.
     - The docs are internally consistent about the MVP logging loop, correction flow, and required runtime dependencies.
     - No open readiness issue still blocks a reviewer from locating the app, understanding the architecture, or following the manual smoke-test steps.
     - At that point, issue `#17` can move from hold status back into the final manual launch smoke test and launch signoff pass.

Dependency summary:
- `README.md` and `docs/current-state.md` are the foundation.
- `docs/architecture.md` depends on the foundation docs being current.
- `docs/testing-and-qa.md` depends on the architecture note so the smoke test matches the real MVP flow.
- `docs/repo-structure.md` comes last because it should describe the repo after the review entry points and review workflow are already fixed.
- If the repo tracks these as separate readiness issues, they should close in this same order before issue `#17` resumes.

## Open Questions / Blockers
None for this prompt-only roadmap.

Assumptions used:
- The MVP centers on workout logging, weight logging, storage, and recent-history review.
- Supabase is the persistence layer for MVP.
- Parser capability is part of the product's core value, but it should be constrained rather than ambitious in MVP.
- Prototype work should only be carried forward when it directly shortens the path to the MVP logging loop.
