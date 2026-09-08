-- Production security-event log, retention, and monitor accessor (issue #975).
--
-- WHY THIS EXISTS
--
-- Kilo could already prevent a large class of security failures (RLS, the
-- consent gate, durable rate limiting, the audit gate, the security-review
-- gate) and could respond to one it had been told about
-- (docs/security-incident-response.md). What it could not do was *notice*.
-- Every security-relevant server decision — a rejected token, a throttled
-- caller, a fail-closed limiter, a failed account deletion — existed only as a
-- `console.error` line inside a Supabase Edge Function log, which:
--
--   * is retained for days, not months, so an incident discovered a week later
--     has no evidence left to investigate;
--   * cannot be queried as events (only grepped as text);
--   * has no threshold, so nothing ever alerts; and
--   * is the same channel ordinary operational noise uses, so a real signal is
--     indistinguishable from a transient 500.
--
-- This migration adds the durable half: an append-only, redacted, bounded
-- security-event log, a fixed retention sweep, and a machine-read monitor
-- accessor whose output can safely reach an alert surface. The Edge Functions
-- write to it through `supabase/functions/_shared/security-event.ts`; the
-- monitor reads it through `scripts/check-security-events.mjs`.
--
-- WHAT THIS DELIBERATELY DOES NOT STORE
--
-- No raw user id. No raw IP address. No token, key, JWT, email address, header,
-- URL, request body, health value, or free-text error message. Those are the
-- things a security log is most often breached *for*, and a log that holds them
-- converts a read-only incident into a data-exposure incident.
--
-- Correlation is preserved without them by a salted digest (see
-- kilo.security_event_subject_digest below): two events from the same caller
-- share a digest, so an investigator can count distinct actors, follow one
-- actor across endpoints, and tell a single wedged client apart from a
-- distributed attempt — while the log itself names nobody.
--
-- Retaining a raw user id would also break an erasure guarantee Kilo already
-- makes: kilo.record_security_event rows survive account deletion (that is the
-- point of an audit trail), and account-delete otherwise leaves nothing behind
-- but the pseudonymized consent-evidence archive. The digest keeps this log on
-- the same side of that line.
--
-- SHAPE OF THE CONTRACT (all four layers are load-bearing)
--
--   1. event_name, source, outcome, and subject_type are fixed allow-lists,
--      enforced by CHECK constraints AND re-validated by the recording
--      function. An unknown value RAISES: a caller emitting an event the
--      catalog does not know is a bug that must be loud, not a row that
--      silently never alerts.
--   2. severity is derived server-side from event_name. A caller cannot
--      downgrade its own event.
--   3. context is re-sanitized against a key allow-list with bounded scalar
--      values. Unknown keys and out-of-range values are DROPPED silently, so a
--      partially-valid context still records its valid fields (same rule as
--      kilo.sanitize_product_measurement_properties).
--   4. Ingest is capped per event name per minute, so a caller that can trigger
--      an event can raise the alarm but cannot fill the table.

-- pg_cron is already installed by 20260711120000_rate_limit_global_prune.sql;
-- repeated here so this migration is self-contained if applied in isolation.
create extension if not exists pg_cron with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. The correlation salt
-- ---------------------------------------------------------------------------
--
-- A single row, generated at migration time and never committed to this
-- repository. It exists so a subject digest is not a bare sha256 of a value
-- from a small, enumerable space: an IPv4 address is only 2^32 candidates, so
-- an unsalted digest of one is reversible by brute force in seconds. A user id
-- is a v4 UUID and is not, but salting both keeps one rule instead of two.
--
-- HONEST BOUNDARY: the salt lives in the same database as the digests, so it
-- defends against digest exposure through an alert surface, a query result, a
-- support screenshot, or a partial export — not against an actor who already
-- holds a full database dump. That is the same boundary
-- kilo.consent_evidence_archive draws by holding its HMAC key OUTSIDE the
-- database; this log's threat model is lower (no health data, no identity, 90
-- day retention), so a database-held salt is the proportionate control. If the
-- salt is rotated, correlation simply does not span the rotation.
--
-- 256 bits of entropy from two gen_random_uuid() values (built-in since PG 13),
-- so no extension is required to produce it.
create table if not exists kilo.security_event_salt (
  id boolean primary key default true check (id),
  salt text not null check (length(salt) >= 32),
  created_at timestamptz not null default now()
);

alter table kilo.security_event_salt enable row level security;

insert into kilo.security_event_salt (id, salt)
values (
  true,
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
on conflict (id) do nothing;

comment on table kilo.security_event_salt is
  'Single-row correlation salt for kilo.security_event_subject_digest. RLS deny-all; read only by the security-definer digest function. Never returned to any caller.';

-- The only thing that turns a raw subject into a stored value. Security
-- definer so the salt table needs no grant at all, and `stable` because the
-- salt does not change within a statement.
create or replace function kilo.security_event_subject_digest(p_value text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(s.salt || ':' || p_value, 'UTF8')
    ),
    'hex'
  )
  from kilo.security_event_salt s
  where s.id
$$;

-- Nobody calls this directly. It exists to be called by
-- kilo.record_security_event, which runs as the same owner; leaving it
-- ungranted means no role can use it as a hashing oracle to confirm a guess.
revoke all on function kilo.security_event_subject_digest(text) from public, anon, authenticated, service_role;

comment on function kilo.security_event_subject_digest(text) is
  'Salted SHA-256 digest of a security-event subject (user id or IP). Intentionally granted to no role: only kilo.record_security_event, which shares its owner, uses it.';

-- ---------------------------------------------------------------------------
-- 2. The event log
-- ---------------------------------------------------------------------------
--
-- Append-only by convention and by grant: the only write path is
-- kilo.record_security_event, and the only delete path is
-- kilo.purge_security_events. No update path exists at all, because an audit
-- trail that can be edited is not one.
create table if not exists kilo.security_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),

  -- The catalog. Adding an event name requires a migration, which is the
  -- point: the monitor's thresholds and the investigation runbook are written
  -- against this list, and an event nobody declared is an event nobody alerts
  -- on. See docs/security-monitoring.md for what each one means.
  event_name text not null check (event_name in (
    'auth.token_missing',
    'auth.token_rejected',
    'authz.denied',
    'ratelimit.ip_blocked',
    'ratelimit.user_blocked',
    'ratelimit.unavailable',
    'account.export_succeeded',
    'account.delete_succeeded',
    'account.delete_failed',
    'health.purge_succeeded',
    'health.purge_failed',
    'server.error'
  )),

  -- Which server component observed it. Deployed Edge Functions only; a name
  -- not in this list means an unreviewed writer.
  source text not null check (source in (
    'account-export',
    'account-delete',
    'health-data-delete'
  )),

  -- Derived from event_name by kilo.security_event_severity, never accepted
  -- from the caller.
  severity text not null check (severity in ('info', 'warning', 'critical')),

  outcome text not null check (outcome in ('allowed', 'denied', 'succeeded', 'failed')),

  -- What the digest identifies, so an investigator knows whether they are
  -- counting accounts or network origins. 'none' is used for server-side work
  -- with no requester (the cron-driven purge worker).
  subject_type text not null check (subject_type in ('user', 'ip', 'none')),

  -- Salted digest, or null when subject_type = 'none'. Never a raw identifier.
  subject_digest text check (subject_digest ~ '^[0-9a-f]{64}$'),

  -- Bounded, allow-listed, scalar-only. See
  -- kilo.sanitize_security_event_context.
  context jsonb not null default '{}'::jsonb,

  constraint security_events_subject_digest_presence check (
    (subject_type = 'none' and subject_digest is null)
    or (subject_type <> 'none' and subject_digest is not null)
  )
);

-- The monitor aggregates by (event_name, occurred_at); the ingest cap counts
-- the same way, so one index serves both.
create index if not exists security_events_event_occurred_idx
  on kilo.security_events (event_name, occurred_at desc);

-- Retention sweep and severity rollups scan by time alone.
create index if not exists security_events_occurred_idx
  on kilo.security_events (occurred_at);

-- Following one actor across endpoints during an investigation.
create index if not exists security_events_subject_occurred_idx
  on kilo.security_events (subject_digest, occurred_at desc)
  where subject_digest is not null;

-- Locked down exactly like kilo.rate_limit_hits and
-- kilo.product_measurement_events: RLS enabled with NO policies, so neither
-- anon nor authenticated can read or write it. Only service_role and the
-- security-definer functions below ever touch these rows.
alter table kilo.security_events enable row level security;

-- SELECT for service_role, and nothing else.
--
-- This is the investigation path docs/security-monitoring.md documents: an
-- incident responder correlates by subject_digest and context.request_id by
-- querying this table directly. Without the grant those queries fail with
-- permission denied -- BYPASSRLS bypasses row policies, not table privileges,
-- and the custom `kilo` schema has no default-privilege grant for new tables
-- (see 20260615120000_note_first_schema.sql), so nothing confers it implicitly.
--
-- Deliberately SELECT only. INSERT stays behind kilo.record_security_event so
-- every row is catalogued, classified, digested, and sanitized; UPDATE is
-- withheld because an audit trail that can be edited is not one; and DELETE is
-- withheld so the retention sweep is the only thing that removes a row. The
-- security-definer functions below are unaffected -- they run as their owner.
grant select on kilo.security_events to service_role;

comment on table kilo.security_events is
  'Append-only production security-event log. Stores no raw user id, IP, token, error text, or health value; subjects are salted digests. 90-day retention, swept by kilo.purge_security_events().';

-- ---------------------------------------------------------------------------
-- 3. Server-derived severity
-- ---------------------------------------------------------------------------
--
-- Kept as a function rather than a column default so the mapping is one
-- reviewable list, and so a future event added to the catalog fails loudly
-- (null severity violates NOT NULL) instead of defaulting to 'info' and never
-- reaching an alert.
--
--   critical  a control that is supposed to hold has stopped holding
--   warning   a control fired, or an operation the user asked for failed
--   info      a sensitive operation completed as intended (the audit trail)
create or replace function kilo.security_event_severity(p_event_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_event_name
    -- The durable limiter is unreachable, so every throttled endpoint is now
    -- failing closed on its outage policy rather than on a real quota. Abuse
    -- control and availability are both degraded.
    when 'ratelimit.unavailable' then 'critical'
    -- A request reached data that did not belong to its verified subject. RLS
    -- and the explicit user_id filters make this unreachable by construction,
    -- so observing it means one of those broke.
    when 'authz.denied' then 'critical'

    when 'auth.token_rejected' then 'warning'
    when 'ratelimit.ip_blocked' then 'warning'
    when 'ratelimit.user_blocked' then 'warning'
    when 'account.delete_failed' then 'warning'
    when 'health.purge_failed' then 'warning'
    when 'server.error' then 'warning'

    -- A request with no Authorization header at all is usually a probe or a
    -- misconfigured client, not an attack. It is recorded because a *rate* of
    -- them is interesting even though one is not.
    when 'auth.token_missing' then 'info'
    when 'account.export_succeeded' then 'info'
    when 'account.delete_succeeded' then 'info'
    when 'health.purge_succeeded' then 'info'
    else null
  end
$$;

revoke all on function kilo.security_event_severity(text) from public;

-- ---------------------------------------------------------------------------
-- 4. Context sanitizer — THE redaction boundary
-- ---------------------------------------------------------------------------
--
-- An allow-list, not a denylist: a key a future caller invents is dropped by
-- default rather than persisted by default. Every admitted value is a bounded
-- scalar, so no free text, no message, no header, and no nested structure can
-- ever be stored. This is what makes it safe for the monitor to render context
-- straight onto an alert surface.
--
--   status      HTTP status the caller was given (100..599)
--   reason      one of a fixed set of short machine codes
--   code        bounded upstream error CODE (PostgREST/Postgres), never a message
--   request_id  platform request correlation id, bounded charset
--   count       a bounded integer quantity (e.g. rows that failed to delete)
create or replace function kilo.sanitize_security_event_context(p_context jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_status numeric;
  v_count numeric;
  v_text text;
begin
  if p_context is null or jsonb_typeof(p_context) <> 'object' then
    return v_out;
  end if;

  if jsonb_typeof(p_context -> 'status') = 'number' then
    v_status := (p_context -> 'status')::numeric;
    if v_status >= 100 and v_status <= 599 and v_status = trunc(v_status) then
      v_out := v_out || jsonb_build_object('status', v_status::int);
    end if;
  end if;

  -- Short machine codes only. A free-text reason is exactly the field that
  -- would eventually carry an email address or a token, so it is not one.
  v_text := p_context ->> 'reason';
  if v_text in (
    'missing_token',
    'invalid_token',
    'ip_throttle',
    'user_throttle',
    'limiter_unavailable',
    'evidence_key_missing',
    'db_error',
    'incomplete',
    'subject_mismatch',
    'unknown'
  ) then
    v_out := v_out || jsonb_build_object('reason', v_text);
  end if;

  -- PostgREST/Postgres error codes are short and bounded ('PGRST301', '42501').
  -- The pattern rejects whitespace and '@', so a message pasted here is
  -- dropped rather than truncated into the log.
  v_text := p_context ->> 'code';
  if v_text is not null and v_text ~ '^[A-Za-z0-9_.:-]{1,40}$' then
    v_out := v_out || jsonb_build_object('code', v_text);
  end if;

  -- Correlates a row here with the platform Edge Function log line for the
  -- same request, which is how an investigator gets from "an event happened"
  -- to "here is the request that caused it" without this log holding the
  -- request itself.
  v_text := p_context ->> 'request_id';
  if v_text is not null and v_text ~ '^[A-Za-z0-9_-]{1,64}$' then
    v_out := v_out || jsonb_build_object('request_id', v_text);
  end if;

  if jsonb_typeof(p_context -> 'count') = 'number' then
    v_count := (p_context -> 'count')::numeric;
    if v_count >= 0 and v_count <= 1000000 and v_count = trunc(v_count) then
      v_out := v_out || jsonb_build_object('count', v_count::bigint);
    end if;
  end if;

  return v_out;
end;
$$;

revoke all on function kilo.sanitize_security_event_context(jsonb) from public;

-- ---------------------------------------------------------------------------
-- 5. The only write path
-- ---------------------------------------------------------------------------
--
-- Granted to service_role only: the Edge Functions already hold a service-role
-- client for the durable rate-limit RPCs and reuse it here. anon and
-- authenticated must never reach this — a client that can write its own
-- security events can drown the real ones.
--
-- Returns true when a row was written and false when the per-event ingest cap
-- rejected it. It raises only for a caller bug (an unknown event name, source,
-- outcome, or subject_type, or a missing subject for a subject-bearing event),
-- so those surface in tests instead of silently never alerting.
create or replace function kilo.record_security_event(
  p_event_name text,
  p_source text,
  p_outcome text,
  p_subject_type text,
  p_subject text,
  p_context jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_severity text;
  v_digest text;
  v_recent integer;
begin
  v_severity := kilo.security_event_severity(p_event_name);
  if v_severity is null then
    raise exception 'unknown security event name';
  end if;

  if p_source is null or p_source not in ('account-export', 'account-delete', 'health-data-delete') then
    raise exception 'unknown security event source';
  end if;

  if p_outcome is null or p_outcome not in ('allowed', 'denied', 'succeeded', 'failed') then
    raise exception 'unknown security event outcome';
  end if;

  if p_subject_type is null or p_subject_type not in ('user', 'ip', 'none') then
    raise exception 'unknown security event subject type';
  end if;

  if p_subject_type = 'none' then
    v_digest := null;
  else
    if p_subject is null or length(trim(p_subject)) = 0 then
      raise exception 'security event subject is required for subject type %', p_subject_type;
    end if;
    -- The raw subject reaches this function and stops here. Only the digest is
    -- ever assigned to a column.
    v_digest := kilo.security_event_subject_digest(trim(p_subject));
  end if;

  -- INGEST CAP.
  --
  -- Several of these events are produced on requests the server is REJECTING
  -- (pre-auth IP throttle, missing token). Those are unbounded by definition:
  -- an attacker chooses how many to send, and rotating source IPs defeats a
  -- per-subject cap because every request is a new subject. A per-event-name
  -- ceiling is the bound that actually holds, and it costs nothing that
  -- matters: the monitor alerts on a *rate*, and any rate that trips this cap
  -- is already far above every alert threshold. The alarm still rings; the
  -- table just stops growing while it does.
  --
  -- 60/minute/event-name over a 90-day retention bounds the worst sustained
  -- case at roughly 7.8M rows per event name, and the realistic case at
  -- approximately zero.
  --
  -- The advisory lock is what makes that bound actually hold. Without it the
  -- count and the insert are not atomic: under READ COMMITTED, N concurrent
  -- transactions can each observe 59 committed rows before any of them commits,
  -- and all N then insert -- so a flood spread across Edge Function isolates
  -- (exactly the shape these events are recorded on) overshoots the cap by the
  -- concurrency, not by one. Same idiom, and the same reason, as
  -- kilo.rate_limit_check in 20260622120001_edge_rate_limit.sql: the lock is
  -- transaction-scoped and keyed by event name, so distinct events never
  -- contend and the serialized section is one indexed count plus one insert.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('security_event:' || p_event_name)
  );

  select count(*) into v_recent
  from kilo.security_events e
  where e.event_name = p_event_name
    and e.occurred_at > now() - interval '1 minute';

  if v_recent >= 60 then
    return false;
  end if;

  insert into kilo.security_events (
    event_name, source, severity, outcome, subject_type, subject_digest, context
  ) values (
    p_event_name,
    p_source,
    v_severity,
    p_outcome,
    p_subject_type,
    v_digest,
    kilo.sanitize_security_event_context(p_context)
  );

  return true;
end;
$$;

revoke all on function kilo.record_security_event(text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function kilo.record_security_event(text, text, text, text, text, jsonb) to service_role;

comment on function kilo.record_security_event(text, text, text, text, text, jsonb) is
  'Sole write path into kilo.security_events. Derives severity server-side, digests the subject, and re-sanitizes context against a key allow-list. Raises on an unknown catalog value; returns false when the per-event ingest cap rejects the row.';

-- ---------------------------------------------------------------------------
-- 6. Retention
-- ---------------------------------------------------------------------------
--
-- 90 days. Long enough that an incident found weeks later still has evidence
-- (Supabase's own Edge Function log retention is measured in days), short
-- enough that the log is not an indefinite behavioural record of Kilo's users.
-- The retention period is a documented contract, not a tuning knob: it is
-- stated in docs/security-monitoring.md and asserted by the monitor, which
-- alerts if the sweep stops running.
create or replace function kilo.purge_security_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from kilo.security_events
  where occurred_at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function kilo.purge_security_events() from public, anon, authenticated;
grant execute on function kilo.purge_security_events() to service_role;

-- Daily at 03:20 UTC, offset from the other scheduled jobs. cron.schedule
-- upserts by name, so re-applying this migration re-points the same entry
-- rather than creating a second one.
select cron.schedule(
  'security-event-purge',
  '20 3 * * *',
  'select kilo.purge_security_events()'
);

-- ---------------------------------------------------------------------------
-- 7. The monitor accessor
-- ---------------------------------------------------------------------------
--
-- REDACTION CONTRACT (load-bearing, do not relax)
--
-- Everything this returns can reach an alert surface, so it returns AGGREGATES
-- ONLY: counts grouped by (event_name, severity, outcome), a distinct-subject
-- count per event name, and retention/schedule health. It never returns a
-- subject digest, a context object, or a single row's identity — not because
-- those are secret (they are already redacted) but because an alert has no use
-- for them and every field that reaches a notification channel is a field that
-- can be leaked by one.
--
-- The distinct-subject count is the field that makes an alert actionable
-- without any identifier at all: 300 rejected tokens from 1 subject is a broken
-- client, and 300 from 280 subjects is a credential-stuffing run. An
-- investigator who needs the digests holds service_role and reads the table
-- directly (see docs/security-monitoring.md).
--
-- `stable`, not `volatile`: it only reads. `set search_path = ''` so an
-- unqualified name can never resolve through a caller-controlled search_path.
create or replace function kilo.security_event_monitor_snapshot(
  p_window interval default interval '1 hour'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    -- Clamp rather than reject: a monitor asking for an absurd window should
    -- get a usable answer, not an error that reads like an outage.
    select greatest(
      interval '1 minute',
      least(coalesce(p_window, interval '1 hour'), interval '24 hours')
    ) as window
  ),
  windowed as (
    select e.event_name, e.severity, e.outcome, e.subject_digest
    from kilo.security_events e, bounds b
    where e.occurred_at > now() - b.window
  )
  select jsonb_build_object(
    'checked_at', now(),
    'window_seconds', (select extract(epoch from b.window) from bounds b),
    'retention_days', 90,

    -- Retention is a control, so its scheduler is monitored like one. Read as
    -- the definer (`postgres`, which scheduled the entry) because cron.job
    -- enforces RLS as `username = CURRENT_USER` and would otherwise be
    -- invisible to a least-privilege monitor role -- the same fact that made
    -- kilo.health_deletion_monitor_snapshot() necessary.
    'purge_cron_active', exists (
      select 1 from cron.job where jobname = 'security-event-purge' and active
    ),
    'purge_cron_present', exists (
      select 1 from cron.job where jobname = 'security-event-purge'
    ),

    -- If the sweep silently stops, this is what shows it: the oldest surviving
    -- row drifts past the retention period even while the cron entry still
    -- looks active.
    'oldest_event_age_seconds', (
      select extract(epoch from now() - min(e.occurred_at)) from kilo.security_events e
    ),
    'newest_event_at', (select max(e.occurred_at) from kilo.security_events e),
    'stored_rows', (select count(*) from kilo.security_events),

    'severity_counts', jsonb_build_object(
      'critical', (select count(*) from windowed w where w.severity = 'critical'),
      'warning', (select count(*) from windowed w where w.severity = 'warning'),
      'info', (select count(*) from windowed w where w.severity = 'info')
    ),

    -- Aggregates only. No subject_digest, no context, no row identity.
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'event_name', g.event_name,
          'severity', g.severity,
          'outcome', g.outcome,
          'count', g.total,
          'distinct_subjects', g.subjects
        )
        order by g.total desc, g.event_name
      )
      from (
        select w.event_name,
               w.severity,
               w.outcome,
               count(*) as total,
               count(distinct w.subject_digest) as subjects
        from windowed w
        group by w.event_name, w.severity, w.outcome
      ) g
    ), '[]'::jsonb)
  )
$$;

-- Deny by default, then grant narrowly. `authenticated` must never reach this:
-- it is operator telemetry about other people's requests.
revoke all on function kilo.security_event_monitor_snapshot(interval) from public, anon, authenticated;
grant execute on function kilo.security_event_monitor_snapshot(interval) to service_role;

comment on function kilo.security_event_monitor_snapshot(interval) is
  'Operator/monitor telemetry for the security-event log: windowed counts by event/severity/outcome, distinct-subject counts, and retention health. Returns no subject digest, no context, and no row identity.';

-- ---------------------------------------------------------------------------
-- 8. The least-privilege monitor role
-- ---------------------------------------------------------------------------
--
-- Created here, not out of band, for the same reason kilo_deletion_monitor is:
-- a role created by an operator AFTER this migration ran would silently hold no
-- grant, and the monitor would fail with a permission error indistinguishable
-- from the outage it exists to detect.
--
-- NO PASSWORD IS SET, HERE OR ANYWHERE IN THIS REPOSITORY. A password written
-- into a migration is a password published to the repository. The role cannot
-- authenticate until an authorized operator runs, out of band and once:
--
--   alter role kilo_security_monitor with password '<generated by the operator>';
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'kilo_security_monitor') then
    create role kilo_security_monitor with login noinherit;
  end if;
end;
$$;

-- The complete privilege set: usage on one schema, execute on one function.
-- Note what is NOT here -- no table grants, no execute on record_security_event
-- (a monitor that can write the log it reads is not a monitor), no reach into
-- the co-tenant canonical/raw/serving/ops/legacy schemas.
grant usage on schema kilo to kilo_security_monitor;
grant execute on function kilo.security_event_monitor_snapshot(interval) to kilo_security_monitor;

comment on role kilo_security_monitor is
  'Read-only monitor identity for the security-event log. Its only privilege is execute on kilo.security_event_monitor_snapshot(interval). Password is set out of band by an operator and never committed.';
