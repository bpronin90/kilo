-- Use the health-deletion rate-limit window in the global pruner (issue #609).
--
-- Production bucket families:
--   export:ip:<ip>           — 10-minute window
--   export:user:<uuid>       — 10-minute window
--   delete:ip:<ip>           — 1-hour window
--   delete:user:<uuid>       — 1-hour window
--   healthdelete:ip:<ip>     — 1-hour window
--   healthdelete:user:<uuid> — 1-hour window
-- Any unrecognised prefix retains the explicit 2-hour safety fallback.

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
    when bucket like 'healthdelete:%' then now() - interval '1 hour'
    else                             now() - interval '2 hours'
  end;
$$;

revoke all on function kilo.rate_limit_global_prune() from public;
grant execute on function kilo.rate_limit_global_prune() to service_role;
