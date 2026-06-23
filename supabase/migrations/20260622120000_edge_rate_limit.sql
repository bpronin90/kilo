-- Durable, shared rate-limit state for account export/delete Edge Functions (issue #352).
--
-- Why this exists:
--   The account-export and account-delete Edge Functions previously throttled
--   abuse with an in-memory Map kept inside each Deno isolate. Supabase Edge
--   Functions scale horizontally and recycle isolates, so those per-user and
--   per-IP counters were per-isolate and best-effort only: a caller could spread
--   requests across isolates or wait out a cold start to bypass the limit.
--   Auth (JWT + RLS) is still enforced independently, so this is cost/abuse
--   throttling, not a data-exposure hole (audit #347 Finding #4, LOW).
--
-- Design:
--   * kilo.rate_limit_hits records one row per accepted request, keyed by an
--     opaque bucket string (e.g. "export:ip:1.2.3.4" or "export:user:<uuid>").
--     A sliding window is evaluated by counting rows newer than now() - window.
--   * kilo.rate_limit_check(...) performs an atomic check-prune-insert in a
--     single round trip. Running it inside one statement-level function call
--     closes the cross-isolate race the in-memory map could not: two concurrent
--     isolates cannot both read a stale count and both admit a request, because
--     the count and the insert happen in the same transaction against shared
--     rows. It returns true when the request is admitted (and records a hit),
--     false when the limit is already reached (no hit recorded).
--   * The function is SECURITY DEFINER and granted only to service_role. Edge
--     Functions call it through their service-role client; end users never get
--     direct access to the shared throttle table. RLS is enabled with no
--     policies so any accidental authenticated/anon access reads/writes nothing.

create table if not exists kilo.rate_limit_hits (
  bucket text not null,
  occurred_at timestamptz not null default now()
);

-- Lookup index for the windowed count and prune (newest-first within a bucket).
create index if not exists rate_limit_hits_bucket_occurred_idx
  on kilo.rate_limit_hits (bucket, occurred_at desc);

-- Lock the table down: enable RLS with no policies so neither anon nor
-- authenticated can read or write it. Only service_role (via the SECURITY
-- DEFINER function below, and BYPASSRLS) ever touches these rows.
alter table kilo.rate_limit_hits enable row level security;

-- ---------------------------------------------------------------------------
-- Atomic windowed rate-limit check.
--   p_bucket    : opaque key identifying the limited subject (ip or user scope)
--   p_max       : max allowed hits within the window
--   p_window_ms : sliding window length in milliseconds
-- Returns true and records a hit when the request is admitted; returns false
-- and records nothing when the bucket is already at its limit.
-- ---------------------------------------------------------------------------
create or replace function kilo.rate_limit_check(
  p_bucket text,
  p_max integer,
  p_window_ms bigint
)
returns boolean
language plpgsql
security definer
set search_path = kilo, pg_temp
as $$
declare
  v_window interval := make_interval(secs => p_window_ms / 1000.0);
  v_cutoff timestamptz := now() - v_window;
  v_count integer;
begin
  -- Opportunistic prune of this bucket's expired rows keeps the table small
  -- without a separate scheduled job. Scoped to one bucket so it stays cheap.
  delete from kilo.rate_limit_hits
  where bucket = p_bucket
    and occurred_at < v_cutoff;

  select count(*) into v_count
  from kilo.rate_limit_hits
  where bucket = p_bucket
    and occurred_at >= v_cutoff;

  if v_count >= p_max then
    return false;
  end if;

  insert into kilo.rate_limit_hits (bucket) values (p_bucket);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refund the most recent hit for a bucket (used when a post-auth operation
-- fails and should not spend the caller's quota). Removes at most one row so a
-- refund cannot drive the count negative or delete unrelated callers' hits.
-- ---------------------------------------------------------------------------
create or replace function kilo.rate_limit_refund(
  p_bucket text
)
returns void
language plpgsql
security definer
set search_path = kilo, pg_temp
as $$
begin
  delete from kilo.rate_limit_hits
  where ctid in (
    select ctid from kilo.rate_limit_hits
    where bucket = p_bucket
    order by occurred_at desc
    limit 1
  );
end;
$$;

-- Only service_role may invoke these; revoke the default public execute grant.
revoke all on function kilo.rate_limit_check(text, integer, bigint) from public;
revoke all on function kilo.rate_limit_refund(text) from public;
grant execute on function kilo.rate_limit_check(text, integer, bigint) to service_role;
grant execute on function kilo.rate_limit_refund(text) to service_role;
