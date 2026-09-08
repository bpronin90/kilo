# Security Monitoring, Alerting, and Audit Trail

This document owns Kilo's production **detect and investigate** layer: which
security-relevant events are recorded server-side, what they may and may not
contain, how long they are kept, who can read them, what alerts on them, and how
to use them during an investigation.

It is the operational counterpart to two documents that already existed and
remain authoritative for their own topics:
[Security-critical change review](security-review.md) decides what gets extra
scrutiny before it ships, and
[Security Incident Response](security-incident-response.md) decides what happens
once something is found. This document is what makes something findable.

It deliberately does not duplicate Kilo's preventive gates — the dependency
audit, the migration-drift check, RLS and the consent gate, the durable rate
limiter, or the mobile test suite. Those stop failures; this notices them.

## Why this exists

Every security-relevant decision Kilo's server made — a rejected token, a
throttled caller, a fail-closed rate limiter, a failed account deletion — used
to exist only as a `console.error` line inside a Supabase Edge Function log.
That log:

- is retained for days, so an incident discovered a week later has no evidence;
- is text, not events, so it cannot be counted, grouped, or thresholded;
- has no alerting, so nothing ever fired; and
- carries ordinary operational noise on the same channel, so a real signal is
  indistinguishable from a transient 500.

The result was a system that could prevent and respond but could not detect.
`kilo.security_events` and `scripts/check-security-events.mjs` close that gap.

## Log inventory

Kilo produces five distinct log surfaces. Only the first is a security-event
log; the rest are named here so an investigation knows what else exists and what
each one is good for.

| Surface | Holds | Retention | Read by |
|---------|-------|-----------|---------|
| `kilo.security_events` | Classified, redacted security events (this document) | 90 days | `service_role` (operator); aggregates via the monitor role |
| Supabase Edge Function logs | Per-request runtime output, including the console mirror of each security event | Supabase plan default (days) | Supabase dashboard |
| Supabase Postgres / Auth logs | Database statements, connection and auth-provider activity | Supabase plan default | Supabase dashboard |
| `kilo.health_data_deletion_jobs` + `kilo.health_deletion_monitor_snapshot()` | Consent-withdrawal purge queue state | Job lifetime | Health-deletion monitor (see [Architecture](architecture.md)) |
| GitHub Actions logs | Deployment, audit-gate, migration-drift, and monitor runs | GitHub default | Repository maintainers |

Kilo's mobile crash reporting (Sentry) is a diagnostics surface, not a security
log: it excludes default PII capture and user-authored health content, and
nothing in this document depends on it.

## Requirements for a security event

These are the rules a new event must satisfy. They are enforced in code, not
only stated here: `kilo.record_security_event` re-validates every one of them
server-side, and `supabase/tests/security-events.test.sql` asserts them.

1. **Recorded server-side.** A client may never write a security event. The
   recording RPC is granted to `service_role` only.
2. **Catalogued.** The event name must exist in the catalog below. An unknown
   name raises rather than recording something no alert is written against.
3. **Server-classified.** Severity is derived from the event name by
   `kilo.security_event_severity`. A caller cannot downgrade its own event.
4. **Pseudonymous.** The subject is a salted digest, never a raw user id or IP.
5. **Bounded context.** Context is an allow-list of scalar fields. No message,
   header, URL, request body, free text, or health value.
6. **Best-effort at the call site.** Recording must never change the response a
   user receives. A security log that can fail an export is worse than one that
   misses a row.
7. **Bounded volume.** Ingest is capped per event name per minute, and the
   count-and-insert is serialized by a transaction-scoped advisory lock so the
   bound holds under concurrency rather than being overshot by however many
   isolates raced. An actor who can trigger an event can raise the alarm but
   cannot fill the table.

## Event catalog

Written by `supabase/functions/_shared/security-event.ts` from the
`account-export`, `account-delete`, and `health-data-delete` Edge Functions.
Severity is assigned by the server.

| Event | Severity | Recorded when |
|-------|----------|---------------|
| `ratelimit.unavailable` | critical | The durable rate limiter is unreachable, so every throttled endpoint is answering on its outage policy rather than on a real quota |
| `authz.denied` | critical | A verified subject reached a record that was not theirs. Unreachable by construction; observing it means RLS or an explicit `user_id` filter regressed |
| `auth.token_rejected` | warning | A presented token failed verification |
| `ratelimit.ip_blocked` | warning | A pre-auth request was throttled by network origin because its bucket was exhausted |
| `ratelimit.user_blocked` | warning | A post-auth request was throttled by account because its bucket was exhausted |
| `account.delete_failed` | warning | An account deletion aborted — missing evidence key, database failure, or health rows still present |
| `health.purge_failed` | warning | A consent-withdrawal purge job failed or could not complete |
| `server.error` | warning | An unexpected server-side failure on a privileged endpoint |
| `auth.token_missing` | info | A request arrived with no `Authorization` header |
| `account.export_succeeded` | info | A full copy of one account's data was returned |
| `account.delete_succeeded` | info | An account and its data were erased |
| `health.purge_succeeded` | info | A consent-withdrawal purge completed and the database confirmed the gated set is empty |

All three `ratelimit.*` events are recorded by
`supabase/functions/_shared/rate-limit.ts`, never by the endpoints. Only the
limiter can tell an exhausted bucket from an outage — under the `deny` policy
both return the same rejection — so an endpoint classifying that rejection
itself would log a quota throttle during a database outage, blaming the caller
for the server's failure and spiking the throttle-volume alert on the very
incident `ratelimit.unavailable` exists to isolate.

The `info` events are the audit trail: they exist so that "was this account's
data ever exported?" has an answer months later, not because one of them is
alarming on its own.

Adding an event requires a migration, and that is intentional. The monitor's
thresholds and this runbook are written against the catalog, so an event nobody
declared is an event nobody alerts on.

## What an event may contain

Stored columns are `occurred_at`, `event_name`, `source`, `severity`, `outcome`,
`subject_type`, `subject_digest`, and `context`.

**The subject is a digest.** `kilo.security_event_subject_digest` salts the raw
user id or IP with a value generated at migration time and never committed, then
takes a SHA-256. Two events from the same caller share a digest, so an
investigator can count distinct actors and follow one actor across endpoints
while the log itself names nobody. The salt is what makes this non-reversible
for a small subject space: an IPv4 address is only 2^32 candidates, so an
unsalted digest of one is recoverable by brute force in seconds.

The salt lives in the same database as the digests. That defends against digest
exposure through an alert surface, a query result, a screenshot, or a partial
export — not against an actor who already holds a full database dump. The
consent-evidence archive holds its HMAC key *outside* the database because its
threat model is higher; this log carries no health data, no identity, and 90-day
retention, so a database-held salt is the proportionate control.

Storing a raw user id would also break an erasure guarantee Kilo already makes.
These rows survive account deletion — that is what an audit trail is for — and
account deletion otherwise leaves nothing behind but the pseudonymized consent
evidence. The digest keeps this log on the same side of that line.

**Context is an allow-list.** Only these keys are stored, and each is
re-validated server-side:

| Key | Shape |
|-----|-------|
| `status` | integer, 100–599 |
| `reason` | one of a fixed set of short machine codes |
| `code` | bounded upstream error *code* (e.g. `PGRST301`), never a message |
| `request_id` | platform request id, `[A-Za-z0-9_-]{1,64}` |
| `count` | integer, 0–1,000,000 |

Unknown keys and out-of-range values are dropped silently, so a partially valid
context still records its valid fields. Anything else a caller sends — a
message, an email address, a token, a header, a health value — never reaches a
column.

**Never in a security event:** raw user ids, IP addresses, email addresses,
tokens, JWTs, API keys, session identifiers, request bodies, headers, URLs, free
text, error messages, health values, or workout/weight content.

## Retention

**90 days.** `kilo.purge_security_events()` deletes anything older, scheduled
daily as the `security-event-purge` pg_cron entry.

The period is a contract, not a tuning knob: it is stated here, asserted by the
SQL tests, and monitored. It is long enough that an incident found weeks later
still has evidence — Supabase's own Edge Function log retention is measured in
days — and short enough that the log does not become an indefinite behavioural
record of Kilo's users.

Retention failures are monitored two ways, because the two symptoms are
different. An inactive or missing cron entry is one finding; rows surviving past
90 days (plus two days of grace) while the entry still *looks* active is
another, and only the second catches a sweep that is scheduled but failing.

## Access and least privilege

| Identity | Can |
|----------|-----|
| `anon`, `authenticated` | Nothing. RLS is enabled with no policies, no table grants exist, and neither can execute any of the functions |
| `service_role` | Record events through the RPC, and `SELECT` the table directly for an investigation — no `INSERT`, `UPDATE`, or `DELETE` |
| `kilo_security_monitor` | Execute `kilo.security_event_monitor_snapshot(interval)` and nothing else |
| Nobody | `kilo.security_event_subject_digest(text)`. It is granted to no role at all, so it cannot be used as an oracle to confirm a guessed IP |

`service_role`'s read access is an explicit `grant select`, not a consequence of
`BYPASSRLS`: that attribute bypasses row policies, never table privileges, and
the custom `kilo` schema has no default-privilege grant for new tables. The
write verbs are deliberately withheld even from `service_role` — `INSERT` stays
behind `kilo.record_security_event` so every row is catalogued, classified,
digested, and sanitized; there is no `UPDATE` path at all, because an audit trail
that can be edited is not one; and `DELETE` belongs to the retention sweep alone.

The migration creates the `kilo_security_monitor` role and its single grant, so
no manual grant step is required. The production role credential and
session-pooler URL are provisioned out of band and are never committed. The URL
is stored as the `SUPABASE_SECURITY_MONITOR_URL` repository secret, and the
hourly production monitor is active.

## Alerting

`.github/workflows/security-event-monitor.yml` runs
`scripts/check-security-events.mjs` hourly and on manual dispatch. Findings
become GitHub Actions error annotations on a failed run.

It alerts when any of these is true:

- **any** `critical` event occurred in the window — there is no rate at which a
  fail-closed limiter or an authorization breach is acceptable;
- `auth.token_missing` + `auth.token_rejected` exceeds
  `KILO_SECURITY_MAX_AUTH_FAILURES` (default 100);
- `auth.token_rejected` came from more than `KILO_SECURITY_MAX_AUTH_SUBJECTS`
  distinct subjects (default 20) — the shape test rather than the volume test:
  300 rejections from one subject is a broken client, 300 from 280 subjects is
  credential stuffing, and volume alone cannot tell them apart;
- `ratelimit.ip_blocked` + `ratelimit.user_blocked` exceeds
  `KILO_SECURITY_MAX_RATE_LIMIT_BLOCKS` (default 200);
- `server.error` + `account.delete_failed` + `health.purge_failed` exceeds
  `KILO_SECURITY_MAX_SERVER_ERRORS` (default 10) — deliberately low, because
  these are failures of operations a user asked for;
- the `security-event-purge` cron entry is missing or inactive, or rows have
  survived past the retention period.

The window is `KILO_SECURITY_WINDOW_MINUTES`, and its default of **90 minutes is
deliberately wider than the hourly schedule**. Each run examines only the N
minutes before its own start, so a window tiled to the schedule (60 against
hourly) left a permanent hole whenever two consecutive runs started more than an
hour apart — and GitHub delays scheduled runs under load, and can drop one
outright. The 30-minute overlap closes ordinary jitter; consecutive runs then
re-report an event that falls in the overlap, which is the cheap direction to be
wrong in. Scheduled runs are also exempt from the workflow's
`cancel-in-progress`, since cancelling a monitor run is itself a way to create a
gap.

The residual limit, stated plainly: a run skipped by more than 30 minutes still
leaves an unexamined interval. What makes that recoverable rather than lost is
that the events are durable for 90 days — widen the window by hand
(`KILO_SECURITY_WINDOW_MINUTES=1440`) or query the table directly and the
evidence is still there. Alert latency degrades; evidence does not.

**Silence is not a finding.** A window with zero events is the ordinary case for
an application this size. Alerting on quiet would train an operator to ignore
this monitor within a week; the retention sweep is monitored instead, because
that is the control whose silent failure actually matters.

Exit codes are `0` no finding, `1` a real production security finding, and `2`
the check could not run. Missing credentials or an unreachable database are exit
2 and a **failed** monitor, never a green one; the `credentialless run exits 2,
never green` job asserts that property on every change to the monitor.

Render the exact operator-facing alert format, with no database, using:

```sh
node scripts/check-security-events.mjs --dry-run
```

The synthetic snapshot it uses deliberately contains a subject digest, a user
id, an email address, a key, and a JWT, so the redaction can be seen working
before this is wired to a notification channel.

## Investigation runbook

Start here when the monitor fires, or when
[Security Incident Response](security-incident-response.md) needs evidence.

1. **Read the aggregates first.** The failed workflow run carries the window's
   counts. `count` answers *how much*; `distinct_subjects` answers *one caller
   or many*. Those two together classify most findings before any query is run.

2. **Widen the window** without touching the database:

   ```sh
   KILO_SECURITY_WINDOW_MINUTES=1440 node scripts/check-security-events.mjs --json
   ```

3. **Correlate by subject, as `service_role`.** The digest is stable per caller,
   so one actor can be followed across endpoints without the log naming anyone:

   ```sql
   -- 1. The shape of the window: who is doing how much of what.
   select event_name, source, outcome, count(*), count(distinct subject_digest)
   from kilo.security_events
   where occurred_at > now() - interval '24 hours'
   group by 1, 2, 3
   order by 4 desc;

   -- 2. Rank the actors. This is where the digest for step 3 comes from --
   --    the aggregate above deliberately never emits one.
   select subject_digest,
          count(*) as events,
          count(distinct event_name) as distinct_events,
          min(occurred_at) as first_seen,
          max(occurred_at) as last_seen
   from kilo.security_events
   where occurred_at > now() - interval '24 hours'
     and subject_digest is not null
   group by subject_digest
   order by events desc
   limit 20;

   -- 3. Every endpoint that one actor touched, in order.
   select occurred_at, event_name, source, outcome, context
   from kilo.security_events
   where subject_digest = '<a digest from step 2>'
   order by occurred_at;
   ```

4. **Join to the platform log** using `context ->> 'request_id'`. That is the
   handle from "an event happened" to "here is the request that caused it" — the
   Edge Function log holds the request detail this log deliberately does not
   store. Do that promptly: platform log retention is days, this log is 90.

5. **Classify.** A `critical` event is never a threshold miss.
   `ratelimit.unavailable` means the durable limiter is unreachable and abuse
   control is degraded; `authz.denied` means a subject reached data that was not
   theirs. Treat either as a declared incident under
   [Security Incident Response](security-incident-response.md) rather than as a
   monitoring anomaly.

6. **Corroborate before concluding.** This log records decisions, not data
   access. For an erasure question, `kilo.health_data_row_counts(user_id)` and
   the health-deletion monitor are authoritative; for a consent question, the
   consent ledger is. Use this log to find *when* and *how often*, then confirm
   *what* against the system that owns it.

7. **Never delete rows to clear a finding.** The log is append-only by
   construction — no role holds `UPDATE` or `INSERT` on the table, and the only
   delete path is the retention sweep — and it is the evidence the investigation
   runs on. Widen a
   threshold with an env override and record why; do not quiet the source.

## Verification

| What | How |
|------|-----|
| Redaction, thresholds, exit discipline, and the TypeScript/SQL catalog agreement | `npm run test:security-events` |
| The operator-facing alert format | `node scripts/check-security-events.mjs --dry-run` |
| Catalog, severity derivation, context sanitization, access control, ingest cap, and retention in the database | `supabase/tests/security-events.test.sql`, run by the `database-security` CI job |
| The recorder's own redaction behavior | `supabase/functions/_shared/security-event.test.ts` |

The contract tests are the reason the two allow-lists can live in both
TypeScript and SQL: drift between them is silent in production — the database
raises, the Edge Function swallows it as best-effort, and the event simply never
arrives — so the test suite asserts the two lists are identical rather than
trusting review to notice.
