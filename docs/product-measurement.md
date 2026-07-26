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
- a separate **deletion token** that a later erasure follow-up can present to
  delete this install's aggregate events.

Both are random, PII-free, and never derived from any account, device, or
health data. They are distinct from each other, keeping attribution separate
from deletion authority. Neither value is ever logged or included in an event
payload; the sanitizer strips them like any other unknown field. Revoking
consent clears both values along with the buffer, and the next use regenerates
fresh, unlinkable identifiers.

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

The RPC independently re-validates every event before it can persist — it is the
security boundary, not the client sanitizer:

- `install_id` must match the client's 32-hex-character random id format.
- `event_name` must be one of the same allow-listed names as the client
  sanitizer; an unrecognized name is rejected outright (the call raises and
  nothing is inserted).
- `properties` are re-sanitized server-side using the same per-event bounds as
  the client's `EVENT_SCHEMAS` (`kilo.sanitize_product_measurement_properties`);
  unknown keys and out-of-range/wrong-typed values are dropped, not persisted.
- Writes are rate-limited per install id (120 events/minute) via the existing
  `kilo.rate_limit_check` used elsewhere in the schema.

The receiving table (`kilo.product_measurement_events`) has row-level security
enabled with no policies, so neither `anon` nor `authenticated` can read or
write it directly; the validated RPC is the only path in, and only
`service_role` (via `BYPASSRLS`) can otherwise touch the table.

On the client, a successfully persisted event is removed from the local buffer.
A transient failure (network error, server unavailable) is retried up to 5
times with exponential backoff within the same flush call; if every attempt
fails, or the server's per-install rate limit throttles the request, the event
stays buffered for a later flush rather than being dropped. A permanent
rejection (an event that can never succeed, e.g. an unrecognized event name)
is dropped rather than retried forever. No raw health, workout, weight, or
profile data is ever part of the payload sent to the server — only the same
allow-listed shape the client sanitizer already enforces locally.

Deletion: the deletion token described above is reserved for a later erasure
follow-up and is not yet wired to any endpoint.

## Intended questions

The event vocabulary is designed to support aggregate answers such as:

- How long does a workout or weight save take?
- How often does parsing surface warnings?
- Which main surfaces are used after logging?
- Do save attempts succeed?

It cannot reconstruct what a user lifted, weighed, wrote, or viewed within their private data.
