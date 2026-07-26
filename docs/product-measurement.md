# Product Measurement Privacy Contract

Kilo product measurement exists to test whether the note-first workflow is fast, understandable, and useful. It is not health-data analytics.

## Consent

- Disabled by default.
- Separate from account creation, cloud sync, crash reporting, and health-data consent.
- Revocation clears the local measurement buffer immediately.

## Data that may be recorded

Only allow-listed event names and bounded fields:

- tab name from the five fixed Kilo tabs
- success/failure booleans
- bounded elapsed time
- bounded parser-warning counts
- fixed Analytics section variants

## Data that must never be recorded

- workout or note text
- exercise names
- weights, repetitions, sets, dates, goals, or profile fields
- account IDs, email addresses, device advertising IDs, or contact information
- arbitrary strings or unreviewed metadata

The client sanitizer discards unknown event names, unknown fields, and values outside their documented bounds.

## Installation identifier and deletion token

On first use the client generates two independent random values and persists
them in AsyncStorage:

- an **install id** used to attribute aggregate events to an install, and
- a separate **deletion token** that authorizes deleting this install's
  server-side aggregate events.

Both are random, PII-free, and never derived from any account, device, or
health data. They are distinct from each other, keeping attribution separate
from deletion authority. Neither value is ever logged or included in an event
payload; the sanitizer strips them like any other unknown field. Revoking
consent clears both values along with the buffer, and the next use regenerates
fresh, unlinkable identifiers.

### Server-side binding

The server never sees or stores the raw deletion token. On the first accepted
event for a given install id, `kilo.record_product_measurement_event`
(`supabase/migrations/20260726120000_product_measurement_deletion.sql`) binds
that install id to a one-way SHA-256 digest of the deletion token in the
private, RLS-locked `kilo.product_measurement_installs` table. The binding is
one-to-one in both directions: an install id cannot later be rebound to a
different token, and a token digest cannot be bound to more than one install
id — both ingest calls are rejected outright if attempted. Every subsequent
event from that install must present the same deletion token to be accepted.

`kilo.product_measurement_events` rows that existed before this binding
contract shipped predated any trustworthy token and could not be securely
claimed by any install after the fact, so the migration that introduced
binding purged them outright rather than inferring ownership from install id
alone. The prior tokenless ingest RPC overload was dropped in the same
migration, so no caller can bypass binding.

## Storage and transport

The client stores a maximum of 500 sanitized events locally in AsyncStorage.

When product measurement consent is granted AND the app is configured for Supabase
(`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`), `flushBufferedProductMeasurements`
(`mobile/lib/productMeasurement.js`) sends buffered events, oldest first, to the
`kilo.record_product_measurement_event` RPC
(`supabase/migrations/20260724120000_product_measurement_events.sql`). Signed-out
and local-only use is unaffected: without consent, or without Supabase
configuration, the flush function returns immediately and makes no network call
of any kind, so nothing changes for a user who has not opted in or is not
signed in.

Both this RPC and the deletion RPC below are called through `client.schema('kilo').rpc(...)`:
the shared `getSupabaseClient()` does not set a default schema, so an
unqualified `.rpc()` call would target `public`, where neither function
exists.

The RPC independently re-validates every event before it can persist — it is the
security boundary, not the client sanitizer:

- `install_id` must match the client's 32-hex-character random id format.
- `deletion_token` must match the same 32-hex-character format and must match
  (or establish, on first ingest) this install's bound token digest — see
  Server-side binding above. A format or binding mismatch rejects the call
  outright and nothing is inserted.
- `event_name` must be one of the same allow-listed names as the client
  sanitizer; an unrecognized name is rejected outright (the call raises and
  nothing is inserted).
- `properties` are re-sanitized server-side using the same per-event bounds as
  the client's `EVENT_SCHEMAS` (`kilo.sanitize_product_measurement_properties`);
  unknown keys and out-of-range/wrong-typed values are dropped, not persisted.
- Writes are rate-limited per install id (120 events/minute) via the existing
  `kilo.rate_limit_check` used elsewhere in the schema.

The receiving table (`kilo.product_measurement_events`) and the binding table
(`kilo.product_measurement_installs`) both have row-level security enabled
with no policies, so neither `anon` nor `authenticated` can read or write
either directly; the validated RPCs are the only path in, and only
`service_role` (via `BYPASSRLS`) can otherwise touch either table.

On the client, a successfully persisted event is removed from the local buffer.
A transient failure (network error, server unavailable) is retried up to 5
times with exponential backoff within the same flush call; if every attempt
fails, or the server's per-install rate limit throttles the request, the event
stays buffered for a later flush rather than being dropped. A permanent
rejection (an event that can never succeed, e.g. an unrecognized event name)
is dropped rather than retried forever. No raw health, workout, weight, or
profile data is ever part of the payload sent to the server — only the same
allow-listed shape the client sanitizer already enforces locally.

## Deletion on opt-out

Disabling product measurement (`setProductMeasurementConsent(false)` in
`mobile/lib/productMeasurement.js`) completes locally first and unconditionally:
it reads the already-persisted deletion token, then clears consent, the
buffered events, the install id, and the deletion token from AsyncStorage — a
new token is never generated for deletion, only the one this install has
already carried since opt-in. Local opt-out has fully succeeded at this point
regardless of network state.

Only if a deletion token existed does the client then fire one best-effort,
fire-and-forget request to `kilo.delete_product_measurement_install`
(`supabase/migrations/20260726120000_product_measurement_deletion.sql`),
passing that token as the sole deletion authority — never the install id,
account id, or any other identifier. The request is not awaited by
`setProductMeasurementConsent`, is wrapped in a try/catch, and any rejection is
swallowed: missing Supabase configuration, being offline, a network or server
timeout, a thrown error, and an explicit server rejection all leave the
already-completed local opt-out untouched.

The RPC is `SECURITY DEFINER`, idempotent, and non-enumerating:

- A malformed token (wrong format) is rejected without deleting anything.
- A well-formed token that is unknown or never bound to an install returns
  the exact same success result as a completed deletion, so a caller can
  never learn whether a binding existed.
- A well-formed, currently-bound token deletes exactly that installation's
  `kilo.product_measurement_events` rows, in one transaction — no other
  installation's rows are ever touched.
- Repeating the same deletion request afterward is safe: it is treated the
  same as any already-revoked token and returns success without deleting
  anything further.

**The install/token binding row is tombstoned, not deleted.** A flush can
read the install id and deletion token from storage and start its RPC call
before local opt-out clears them; that in-flight request can then reach the
server *after* the deletion transaction has already committed. If deletion
removed the binding row outright, that late call would find no binding, treat
itself as a first ingest, recreate it, and insert events for an installation
the user just had erased — using a token the client has already discarded and
can never present again. To close this, `kilo.delete_product_measurement_install`
deletes the installation's events but marks its `kilo.product_measurement_installs`
row revoked (`revoked_at`) instead of deleting it. `kilo.record_product_measurement_event`
checks `revoked_at` and rejects any ingest for a revoked installation
outright, and the revoked token's digest stays permanently reserved so it can
never be rebound — by the same installation or a different one.

The tombstone alone only guards a late call that *starts* after deletion has
already committed. Both RPCs also take a row lock (`SELECT ... FOR UPDATE`) on
the same install's binding row before reading or changing it, so an ingest and
a deletion that genuinely *overlap* in time cannot interleave either: whichever
one acquires the lock first runs to completion (commit) before the other
proceeds — either the ingest commits first and the deletion, once unblocked,
still sweeps up the row it just committed, or the deletion commits first and
the ingest, once unblocked, re-reads `revoked_at` as set and rejects. This is
proven with two real concurrent database sessions in
`supabase/tests/product-measurement-deletion-concurrency.test.sql`.

**This is intentionally fail-open, not durable.** Once the token is discarded
from local storage during opt-out, there is no retry: an offline or failed
deletion request is not queued, persisted, or retried later. A durable
deletion job or retry-storage mechanism is out of scope for this contract. A
later opt-in always generates a fresh install id and deletion token that
cannot be linked to, or used to affect, any previously revoked installation.

## Intended questions

The event vocabulary is designed to support aggregate answers such as:

- How long does a workout or weight save take?
- How often does parsing surface warnings?
- Which main surfaces are used after logging?
- Do save attempts succeed?

It cannot reconstruct what a user lifted, weighed, wrote, or viewed within their private data.
