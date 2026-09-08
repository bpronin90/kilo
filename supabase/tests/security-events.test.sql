-- Security-event log SQL contract tests (issue #975).
--
-- Covers the four properties that make kilo.security_events safe to keep, safe
-- to read, and useful to alert on:
--
--   1. The catalog is closed and severity is server-derived, so a caller cannot
--      invent an event nothing thresholds on or downgrade its own.
--   2. Redaction holds at the write path: the raw subject never lands in a
--      column, and context is an allow-list of bounded scalars, so no message,
--      email address, token, or health value can be stored even by a caller
--      that tries.
--   3. The log is reachable only by service_role and the security-definer
--      functions -- never by anon or authenticated.
--   4. Retention and the monitor accessor behave: old rows are swept, and the
--      snapshot returns aggregates without a digest or a context.
--
-- Run: psql "$DATABASE_URL" -f supabase/tests/security-events.test.sql
-- or:  supabase test db

begin;

select plan(55);

-- ---------------------------------------------------------------------------
-- Catalog: an unknown value RAISES rather than recording something silent
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select kilo.record_security_event('auth.not_a_real_event', 'account-export', 'denied', 'ip', '203.0.113.9', '{}'::jsonb)$$,
  'unknown security event name',
  'an event name outside the catalog is rejected'
);

select throws_ok(
  $$select kilo.record_security_event('server.error', 'not-a-function', 'failed', 'none', null, '{}'::jsonb)$$,
  'unknown security event source',
  'a source outside the allow-list is rejected'
);

select throws_ok(
  $$select kilo.record_security_event('server.error', 'account-export', 'exploded', 'none', null, '{}'::jsonb)$$,
  'unknown security event outcome',
  'an outcome outside the allow-list is rejected'
);

select throws_ok(
  $$select kilo.record_security_event('server.error', 'account-export', 'failed', 'device', 'x', '{}'::jsonb)$$,
  'unknown security event subject type',
  'a subject type outside the allow-list is rejected'
);

select throws_ok(
  $$select kilo.record_security_event('auth.token_missing', 'account-export', 'denied', 'ip', '   ', '{}'::jsonb)$$,
  'security event subject is required for subject type ip',
  'a blank subject is rejected rather than digested'
);

-- ---------------------------------------------------------------------------
-- Severity is derived server-side, from one reviewable map
-- ---------------------------------------------------------------------------
select is(
  kilo.security_event_severity('ratelimit.unavailable'),
  'critical',
  'a fail-closed limiter is critical'
);
select is(
  kilo.security_event_severity('authz.denied'),
  'critical',
  'a subject reaching data that is not theirs is critical'
);
select is(
  kilo.security_event_severity('auth.token_rejected'),
  'warning',
  'a rejected token is a warning'
);
select is(
  kilo.security_event_severity('account.export_succeeded'),
  'info',
  'a completed sensitive operation is the info-level audit trail'
);
select is(
  kilo.security_event_severity('not.a.real.event'),
  null,
  'an uncatalogued name has no severity, so its insert cannot succeed'
);

-- ---------------------------------------------------------------------------
-- The write path: the raw subject stops at the function boundary
-- ---------------------------------------------------------------------------
select ok(
  kilo.record_security_event(
    'auth.token_rejected', 'account-export', 'denied', 'ip', '203.0.113.9',
    jsonb_build_object('status', 401, 'reason', 'invalid_token', 'request_id', 'req_abc-123')
  ),
  'a well-formed event is recorded'
);

select is(
  (select count(*)::int from kilo.security_events where subject_digest = '203.0.113.9'),
  0,
  'the raw IP is never stored as the digest'
);

select is(
  (select count(*)::int from kilo.security_events
   where subject_digest is not null and subject_digest !~ '^[0-9a-f]{64}$'),
  0,
  'every stored subject is a 64-hex-character digest'
);

select is(
  (select severity from kilo.security_events where event_name = 'auth.token_rejected' limit 1),
  'warning',
  'severity was assigned by the server, not supplied by the caller'
);

-- Correlation is the whole reason a digest exists rather than nothing at all.
select ok(
  kilo.record_security_event(
    'ratelimit.ip_blocked', 'account-delete', 'denied', 'ip', '203.0.113.9',
    jsonb_build_object('status', 429, 'reason', 'ip_throttle')
  ),
  'a second event for the same subject is recorded'
);

select is(
  (select count(distinct subject_digest)::int from kilo.security_events
   where event_name in ('auth.token_rejected', 'ratelimit.ip_blocked')),
  1,
  'the same subject digests identically across endpoints, so one actor is followable'
);

select ok(
  kilo.record_security_event(
    'auth.token_rejected', 'account-export', 'denied', 'ip', '198.51.100.4',
    jsonb_build_object('status', 401, 'reason', 'invalid_token')
  ),
  'a different subject is recorded'
);

select is(
  (select count(distinct subject_digest)::int from kilo.security_events
   where event_name = 'auth.token_rejected'),
  2,
  'a different subject digests differently, so distinct-subject counts are meaningful'
);

-- ---------------------------------------------------------------------------
-- Context sanitization: the allow-list is THE redaction boundary
-- ---------------------------------------------------------------------------
select ok(
  kilo.record_security_event(
    'server.error', 'account-delete', 'failed', 'user',
    '99999999-9999-4999-8999-999999999999',
    jsonb_build_object(
      'status', 500,
      'reason', 'db_error',
      'code', 'PGRST301',
      'request_id', 'req_XYZ-9',
      'count', 17,
      -- Everything below is what a future call site would plausibly add, and
      -- every one of them is what this log must never hold.
      'message', 'delete failed for person@example.com',
      'email', 'person@example.com',
      'user_id', '99999999-9999-4999-8999-999999999999',
      'ip', '203.0.113.9',
      'authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
      'weight_kg', 82.4
    )
  ),
  'an event with a hostile context is still recorded'
);

select is(
  (select context from kilo.security_events where event_name = 'server.error' limit 1),
  jsonb_build_object(
    'status', 500,
    'reason', 'db_error',
    'code', 'PGRST301',
    'request_id', 'req_XYZ-9',
    'count', 17
  ),
  'only allow-listed context keys survive; message, email, user id, IP, token, and health value are all dropped'
);

select is(
  (select count(*)::int from kilo.security_events where context::text like '%example.com%'),
  0,
  'no email address reached any stored context'
);

select is(
  (select count(*)::int from kilo.security_events where context::text like '%eyJ%'),
  0,
  'no token reached any stored context'
);

select is(
  kilo.sanitize_security_event_context(
    jsonb_build_object('status', 99, 'reason', 'made_up', 'code', 'a message with spaces', 'request_id', 'has spaces', 'count', -1)
  ),
  '{}'::jsonb,
  'out-of-range and wrong-shaped values are dropped rather than clamped'
);

select is(
  kilo.sanitize_security_event_context('"not an object"'::jsonb),
  '{}'::jsonb,
  'a non-object context sanitizes to empty'
);

select is(
  kilo.sanitize_security_event_context(null),
  '{}'::jsonb,
  'a null context sanitizes to empty'
);

-- ---------------------------------------------------------------------------
-- Subject-type pairing is enforced by the table, not only by the function
-- ---------------------------------------------------------------------------
select ok(
  kilo.record_security_event('ratelimit.unavailable', 'health-data-delete', 'denied', 'none', null, '{}'::jsonb),
  'a subjectless server condition is recorded'
);

select is(
  (select subject_digest from kilo.security_events where event_name = 'ratelimit.unavailable' limit 1),
  null,
  'subject type none stores no digest'
);

select throws_ok(
  $$insert into kilo.security_events (event_name, source, severity, outcome, subject_type, subject_digest)
    values ('server.error', 'account-export', 'warning', 'failed', 'user', null)$$,
  '23514'::char(5),
  null,
  'a subject-bearing event with no digest violates the table constraint'
);

select throws_ok(
  $$insert into kilo.security_events (event_name, source, severity, outcome, subject_type, subject_digest)
    values ('server.error', 'account-export', 'warning', 'failed', 'none', repeat('a', 64))$$,
  '23514'::char(5),
  null,
  'a subjectless event carrying a digest violates the table constraint'
);

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------
select is(
  (select relrowsecurity from pg_class where oid = 'kilo.security_events'::regclass),
  true,
  'row level security is enabled on the security log'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'kilo' and tablename = 'security_events'),
  0,
  'no RLS policies exist, so the table is deny-all without BYPASSRLS'
);
select ok(
  not has_table_privilege('anon', 'kilo.security_events', 'select'),
  'anon cannot read the security log'
);
-- The documented investigation path in docs/security-monitoring.md queries this
-- table directly as service_role. BYPASSRLS bypasses row policies, not table
-- privileges, and the custom kilo schema has no default-privilege grant, so
-- without an explicit grant those runbook queries fail with permission denied.
select ok(
  has_table_privilege('service_role', 'kilo.security_events', 'select'),
  'service_role can read the log, so the investigation runbook actually works'
);
-- Read only. Writes stay behind the RPC so every row is catalogued and
-- sanitized; there is no update path at all; and the retention sweep is the
-- only thing that removes a row.
select ok(
  not has_table_privilege('service_role', 'kilo.security_events', 'insert'),
  'service_role cannot bypass the recording RPC to insert a raw row'
);
select ok(
  not has_table_privilege('service_role', 'kilo.security_events', 'update'),
  'nothing can edit a recorded event — an audit trail that can be edited is not one'
);
select ok(
  not has_table_privilege('service_role', 'kilo.security_events', 'delete'),
  'only the retention sweep removes rows'
);
select ok(
  not has_table_privilege('authenticated', 'kilo.security_events', 'select'),
  'authenticated cannot read the security log'
);
select ok(
  not has_table_privilege('authenticated', 'kilo.security_events', 'insert'),
  'authenticated cannot write the security log'
);
select ok(
  not has_function_privilege('authenticated', 'kilo.record_security_event(text, text, text, text, text, jsonb)', 'execute'),
  'authenticated cannot record its own security events'
);
select ok(
  has_function_privilege('service_role', 'kilo.record_security_event(text, text, text, text, text, jsonb)', 'execute'),
  'service_role, which the Edge Functions hold, can record events'
);
select ok(
  not has_function_privilege('authenticated', 'kilo.security_event_monitor_snapshot(interval)', 'execute'),
  'authenticated cannot read operator telemetry about other people''s requests'
);
-- The salt is what makes a digest non-reversible for a small subject space, and
-- the digest function is deliberately granted to nobody so it cannot be used as
-- an oracle to confirm a guessed IP.
select ok(
  not has_function_privilege('service_role', 'kilo.security_event_subject_digest(text)', 'execute'),
  'not even service_role can use the digest function as a hashing oracle'
);
select ok(
  not has_table_privilege('authenticated', 'kilo.security_event_salt', 'select'),
  'authenticated cannot read the correlation salt'
);

-- ---------------------------------------------------------------------------
-- The monitor accessor: aggregates only
-- ---------------------------------------------------------------------------
select is(
  (kilo.security_event_monitor_snapshot(interval '1 hour') -> 'retention_days')::int,
  90,
  'the accessor reports the declared retention period'
);

select ok(
  (kilo.security_event_monitor_snapshot(interval '1 hour') ->> 'events') not like '%subject_digest%',
  'the snapshot carries no subject digest'
);

select ok(
  (kilo.security_event_monitor_snapshot(interval '1 hour') ->> 'events') not like '%request_id%',
  'the snapshot carries no context'
);

select is(
  (kilo.security_event_monitor_snapshot(interval '1 hour') -> 'severity_counts' -> 'critical')::int,
  1,
  'the one critical event recorded above is counted as critical'
);

-- The clamp keeps an absurd window usable rather than turning it into an error
-- that reads like an outage; the events aggregate stays a well-formed array
-- either way, including when it is empty.
select is(
  jsonb_typeof(kilo.security_event_monitor_snapshot(interval '400 days') -> 'events'),
  'array',
  'an over-long window is clamped and still returns an events array'
);

-- ---------------------------------------------------------------------------
-- Ingest cap
-- ---------------------------------------------------------------------------
--
-- Several catalogued events fire on requests the server is REJECTING, so their
-- volume is chosen by the caller, not by Kilo. The per-event-name ceiling is
-- what keeps an attacker from filling this table by attacking; the alarm still
-- rings, because any rate that trips the cap is far above every alert
-- threshold.
insert into kilo.security_events (event_name, source, severity, outcome, subject_type, subject_digest)
select 'auth.token_missing', 'account-export', 'info', 'denied', 'ip', repeat('c', 64)
from generate_series(1, 60);

select is(
  kilo.record_security_event('auth.token_missing', 'account-export', 'denied', 'ip', '203.0.113.9', '{}'::jsonb),
  false,
  'the 61st event of one name in a minute is refused rather than stored'
);

select is(
  (select count(*)::int from kilo.security_events where event_name = 'auth.token_missing'),
  60,
  'the refused event added no row'
);

-- Without serialization the cap does not hold: under READ COMMITTED, N
-- concurrent transactions can each read 59 committed rows and all insert, so a
-- flood spread across Edge Function isolates overshoots by the concurrency
-- rather than by one. A single-session pgTAP file cannot reproduce that
-- interleaving, so this asserts the mechanism instead -- that the function
-- takes a transaction-scoped advisory lock keyed by event name before counting.
select ok(
  pg_get_functiondef(
    'kilo.record_security_event(text, text, text, text, text, jsonb)'::regprocedure
  ) like '%pg_advisory_xact_lock%security_event:%',
  'the ingest cap is serialized per event name, so the bound actually holds'
);

-- The cap is per event name, so a flood of one event cannot suppress a
-- different, possibly more serious one.
select ok(
  kilo.record_security_event('authz.denied', 'health-data-delete', 'denied', 'user', '11111111-1111-4111-8111-111111111111', '{}'::jsonb),
  'a different event name is unaffected by another name''s cap'
);

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------
insert into kilo.security_events (event_name, source, severity, outcome, subject_type, subject_digest, occurred_at)
values ('auth.token_missing', 'account-export', 'info', 'denied', 'ip', repeat('b', 64), now() - interval '91 days');

select is(
  kilo.purge_security_events(),
  1,
  'the retention sweep deletes exactly the row past the 90-day period'
);

select is(
  (select count(*)::int from kilo.security_events where occurred_at < now() - interval '90 days'),
  0,
  'nothing older than the retention period survives the sweep'
);

select ok(
  exists (select 1 from cron.job where jobname = 'security-event-purge' and active),
  'the retention sweep is scheduled and active'
);

select * from finish();
rollback;
