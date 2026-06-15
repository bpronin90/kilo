# Backend Schema And Source-Of-Truth Policy

This doc is the canonical reference for how Kilo's cloud data is structured in Supabase, why it is structured that way, and the naming, ownership, and isolation rules every future schema change must follow. It describes the schema shipped by the note-first migration (`supabase/migrations/20260615120000_note_first_schema.sql`, issue #316) and the policy that governs additions to it.

This is a policy and structure doc, not an ingestion/ETL design. Kilo stores a small, single-user, note-first dataset; it does not run a `raw/canonical/serving` pipeline, and that layering model must not be imported here.

## Tenancy

Kilo's cloud tables live in one dedicated `kilo` schema inside a Supabase project that is **shared with another app (anime-streaming-tracker)**. The shared project is the reason isolation is explicit rather than inherited.

Rules:

- All Kilo app tables live in the `kilo` schema. Nothing Kilo-owned lives anywhere else.
- Kilo must **never** use `public` or any of the anime-tracker schemas: `raw`, `canonical`, `serving`, `serving_stage`, `legacy`, `ops`. Those belong to the other app and Kilo does not read or write them.
- The only cross-schema reference Kilo makes is **read-only to the Supabase-managed `auth` schema** — every table's `user_id` references `auth.users(id) on delete cascade`. Kilo does not own or mutate `auth`.

Because a custom schema does not inherit the default privileges Supabase applies to `public`, isolation here is established by explicit grants and RLS rather than by convention (see Grants And Isolation Posture).

## Why One Schema, Not ETL Layers

Kilo is not an ingestion or ETL pipeline. There is no upstream feed to land raw, normalize into a canonical model, and project into a serving model. The data is a single user's own notes and entries written directly by the app.

Consequences:

- The seven app tables share **one ownership boundary**. There is no reason to split them across `raw/canonical/serving` layers, and doing so would only add coordination cost with no benefit at this scale.
- Canonical-vs-derived is expressed at **column granularity** (see Source-Of-Truth Rule), not at schema-layer granularity. One table can hold both the canonical text and its derived projections.
- A future `kilo_ops` schema is reserved **only** for Phase 4 sync bookkeeping — cursors, dirty queues, tombstone retention — and only if that bookkeeping actually materializes as server-owned state. It is not created speculatively, and it is the one allowed exception to the single-schema rule.

Do not introduce the anime-tracker's `raw/canonical/serving/ops` layer model into Kilo.

## Source-Of-Truth Rule

`workout_notes.raw_text` is **canonical**. Everything else derived from a note is a **projection** of that canonical text and can be regenerated from it.

- The derived `jsonb` snapshot columns on `workout_notes` (`tracked_exercises`, `one_k_exercises`, `skip_markers`, `attendance_flags`, `exercise_classifications`, `session_checkins`) are parser output cached for rendering, sync, and export. They are not an independent source of truth; on conflict, recompute from `raw_text` rather than treating derived drift as a user edit.
- `fatigue_checkins` rows are **projections** of `workout_notes.session_checkins`, which is itself derived from `raw_text`. They exist to make fatigue history queryable; the source note stays canonical.

Because Kilo's dataset is small and single-user, canonical-vs-derived is tracked at column (and projection-table) granularity. There is no separate canonical schema layer to point at — the rule lives in the column semantics documented here and in the migration's contract notes.

## Naming Conventions

- **`*_history`** suffix for append/history tables (for example `deload_history`). The current/draft record stays on its owning singleton; completed historical records go to the `*_history` table.
- **Explicit domain nouns** for table names (`weight_entries`, `workout_notes`, `weight_goal`, `feature_toggles`, `user_profile`, `fatigue_checkins`). No generic or abbreviated table names.
- **Singleton tables key on `user_id`** — one row per user, primary key is the user id (`user_profile`, `feature_toggles`, `weight_goal`).
- **Multi-row tables key on `(user_id, id)`** — the local `id` is preserved as `text` so client ids survive sync (`weight_entries`, `workout_notes`, `deload_history`, `fatigue_checkins`).
- Conflict/sync columns are consistent across tables: `updated_at` is the conflict cursor and `deleted_at` is the tombstone. History/lookup indexes are owner-first, for example `(user_id, logged_at desc)` or `(user_id, updated_at desc)`.

## Grants And Isolation Posture

Isolation is enforced by RLS on top of explicit grants. A custom schema has no default Supabase grants, so privileges are issued by hand in the migration.

- **RLS is enabled on every table.** Every operation is owner-scoped to rows where `user_id = auth.uid()`. Update policies pair `using` with `with check` so update visibility is owner-only and a row cannot be reassigned to another owner. Insert policies use `with check (user_id = auth.uid())`.
- **`authenticated`** gets `usage` on the `kilo` schema and RLS-scoped `select/insert/update/delete` on each table. RLS narrows that DML to the signed-in owner's rows.
- **`service_role`** gets `usage` plus full (`all`) access on each table, reserved for future server-owned code (for example account export and deletion). No public client ever receives the `service_role` key.
- **`anon` is never granted.** Signed-out users stay local-only (AsyncStorage) and never reach these tables.

This grant/RLS posture is what proves Kilo's rows are isolated inside the shared project, since the schema cannot rely on `public`'s default privileges.

## Operational Notes

- **Migrations** live in `supabase/migrations/**`. Schema changes are made there and nowhere else; the shipped baseline is `20260615120000_note_first_schema.sql`.
- **Exposed schemas:** `kilo` must be added to the project's exposed schemas (API settings, or `config.toml` `[api] schemas`) before the client can reach these tables over the auto-generated API. This is a project-config step, not part of a migration.
- Client queries must always be user-scoped and index-backed; fetch changed records by table and `updated_at` cursor rather than scanning.

## Relationship To `docs/backend-roadmap.md`

These two docs have distinct, non-overlapping authority:

- **`docs/backend-roadmap.md`** owns sequencing and contract intent: the phased issue series, the auth/RLS/isolation contract, the sync and self-serve obligations, and the AsyncStorage-to-cloud mapping. It describes what the backend build is delivering and in what order.
- **`docs/backend-schema.md`** (this doc) owns the current schema structure and the naming, source-of-truth, ownership, and isolation policy that schema changes must follow.

When the two appear to disagree on the shipped schema's structure or naming/ownership rules, this doc is authoritative for those rules and the roadmap is authoritative for sequencing and broader contract intent. New schema work should be consistent with both.
