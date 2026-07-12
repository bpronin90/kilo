-- Bound kilo.rate_limit_hits growth independently of bucket cardinality (issue #451).
--
-- Problem: rate_limit_check prunes only the bucket currently being checked.
-- A caller who forges or rotates X-Forwarded-For values creates a new bucket
-- with each request; those orphan buckets are never revisited and so never
-- pruned. Combined with the XFF spoofing fix (also in #451), unauthenticated
-- flooding could accumulate permanent rows even if each request is throttled.
--
-- Fix: schedule a global prune via pg_cron that removes all rows older than the
-- longest rate-limit window in use (currently 1 hour for the delete bucket).
-- The 2-hour horizon gives a comfortable safety margin over that maximum.

create extension if not exists pg_cron with schema extensions;

-- Separate index on occurred_at alone lets the global DELETE do an efficient
-- index scan rather than a full table scan. The existing composite index on
-- (bucket, occurred_at desc) continues to serve the per-bucket window count.
create index if not exists rate_limit_hits_occurred_idx
  on kilo.rate_limit_hits (occurred_at);

-- Global prune: remove each row after its own bucket type's window has elapsed.
-- Bucket naming convention (see account-export and account-delete index.ts):
--   export:ip:<ip>      — 10-minute window
--   export:user:<uuid>  — 10-minute window
--   delete:ip:<ip>      — 1-hour window
--   delete:user:<uuid>  — 1-hour window
-- Any unrecognised prefix falls back to a 2-hour safety cutoff.
create or replace function kilo.rate_limit_global_prune()
returns void
language sql
security definer
set search_path = kilo, pg_temp
as $$
  delete from kilo.rate_limit_hits
  where occurred_at < case
    when bucket like 'export:%' then now() - interval '10 minutes'
    when bucket like 'delete:%' then now() - interval '1 hour'
    else                             now() - interval '2 hours'
  end;
$$;

revoke all on function kilo.rate_limit_global_prune() from public;
grant execute on function kilo.rate_limit_global_prune() to service_role;

-- Run every 30 minutes so no orphan bucket survives longer than 2.5 hours.
select cron.schedule(
  'rate-limit-global-prune',
  '*/30 * * * *',
  'select kilo.rate_limit_global_prune()'
);
