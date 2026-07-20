-- Health-deletion monitor accessor.
--
-- WHY THIS EXISTS
--
-- #541 shipped scripts/check-health-deletion-backlog.mjs, a least-privilege
-- monitor that is supposed to detect a purge queue that has stopped draining.
-- Review of that implementation established that the monitor, as designed,
-- could never work in production. Two independent row-level-security facts
-- blocked it, both verified against a disposable Postgres with every migration
-- applied:
--
--   1. `cron.job` enforces RLS with the policy `username = CURRENT_USER`. The
--      `health-deletion-drain` entry is scheduled by the migration running as
--      `postgres`. A distinct, least-privilege monitor role therefore matches
--      ZERO rows even when it holds `grant select on cron.job`. Both
--      `drain_cron_active` and `drain_cron_present` read as false, so the
--      monitor reported `drain-cron-inactive` and exited 1 on EVERY scheduled
--      run -- a monitor that is permanently red is a monitor nobody reads.
--      The operator cannot repair this from outside a migration either:
--      `create policy ... on cron.job` fails with `must be owner of table job`,
--      because that table belongs to the Supabase superuser, not to `postgres`.
--
--   2. `kilo.health_data_deletion_jobs` has RLS enabled with NO policies, which
--      is deny-all to every role lacking `BYPASSRLS`. A column-level
--      `grant select (id, status, updated_at)` still returns zero rows. So the
--      monitor could not read `updated_at` at all, and
--      `kilo.health_deletion_backlog(interval)` exposes age measured from
--      `created_at` only. Meanwhile `kilo.drain_health_deletion_jobs()`
--      reclaims a stale `running` job on `updated_at` older than 30 minutes.
--      The two clocks disagree: a job queued an hour ago and claimed two
--      seconds ago was reported stale while its worker was perfectly fresh.
--
-- A `security definer` function is the correct fix for both. It runs as its
-- owner (`postgres`), which is the role that scheduled the cron entry and the
-- role that owns the jobs table, so it sees the rows RLS hides from the monitor
-- role -- without granting that role any direct table access, any ability to
-- write, or any reach into the co-tenant schemas.
--
-- WHY A NEW FUNCTION RATHER THAN CHANGING health_deletion_backlog
--
-- Adding `updated_at` to `kilo.health_deletion_backlog(interval)` would change
-- its return type, and Postgres cannot `create or replace` a function through a
-- return-type change: it requires `drop function` first. That function is
-- granted to `service_role` and is the documented operator SQL path referenced
-- from docs/architecture.md, so dropping and recreating it would briefly remove
-- a live erasure-observability tool and silently invalidate any saved operator
-- query that selects its columns positionally. This migration is therefore
-- purely ADDITIVE: `health_deletion_backlog` is left exactly as it is, and the
-- monitor gets a purpose-built accessor beside it.
--
-- REDACTION CONTRACT (load-bearing, do not relax)
--
-- This accessor is read by an automated monitor whose output reaches alert
-- surfaces. It therefore exposes ONLY cron status, Vault secret NAMES, and job
-- timing/state metadata. It must never return `user_id`, any health value, any
-- `decrypted_secret`, or any token. The columns selected below are an explicit
-- allowlist; `to_jsonb(j)` on the jobs table is deliberately NOT used, because
-- that would leak any column added to the table in future by default.
-- `kilo.health_deletion_backlog(interval)` still returns `user_id` (its caller
-- is an operator holding the service role); this function is the machine-read
-- path and does not.

-- ---------------------------------------------------------------------------
-- 1. The accessor
-- ---------------------------------------------------------------------------

-- One monitor round trip: cron status, worker configuration presence, and every
-- open job's metadata, as a single JSON document.
--
-- `stable`, not `volatile`: it only reads. `set search_path = ''` for the usual
-- security-definer reason -- an unqualified name must never resolve through a
-- caller-controlled search_path.
create or replace function kilo.health_deletion_monitor_snapshot()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select jsonb_build_object(
    'checked_at', now(),

    -- Reads cron.job as the definer (`postgres`), which is the role that
    -- scheduled the entry, so the RLS policy `username = CURRENT_USER` matches
    -- instead of hiding the row. This is the whole point of the function.
    'drain_cron_active', exists (
      select 1 from cron.job
      where jobname = 'health-deletion-drain' and active
    ),
    'drain_cron_present', exists (
      select 1 from cron.job
      where jobname = 'health-deletion-drain'
    ),

    -- Secret NAMES only, from the same single source of truth the deploy
    -- verifier and the dispatcher use. vault.decrypted_secrets is never read
    -- here; this function cannot expose secret material even to its own caller.
    'required_secret_names', (
      select jsonb_build_array(n.functions_base_url, n.service_role_key)
      from kilo.worker_secret_names() n
    ),
    'present_secret_names', coalesce((
      select jsonb_agg(s.name)
      from vault.secrets s, kilo.worker_secret_names() n
      where s.name in (n.functions_base_url, n.service_role_key)
    ), '[]'::jsonb),

    -- Every open job. Explicit allowlist of columns -- no user_id.
    --
    -- Two distinct clocks are returned on purpose:
    --   age_seconds      now() - created_at. "How long has this user been
    --                    waiting for the erasure they requested?"
    --   running_seconds  now() - updated_at, and NULL unless status =
    --                    'running'. "How long has this claim been held?" This
    --                    is the exact quantity drain_health_deletion_jobs()
    --                    compares against its 30-minute reclaim ceiling, so a
    --                    monitor using it agrees with the reclaimer instead of
    --                    firing a false page on a freshly claimed old job.
    'jobs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'job_id', j.id,
          'reason', j.reason,
          'status', j.status,
          'attempts', j.attempts,
          'age_seconds', extract(epoch from now() - j.created_at),
          'running_seconds', case
            when j.status = 'running' then extract(epoch from now() - j.updated_at)
            else null
          end,
          'last_error', j.last_error
        )
        order by j.created_at
      )
      from kilo.health_data_deletion_jobs j
      where j.status in ('pending', 'running', 'failed')
    ), '[]'::jsonb)
  );
$$;

-- Deny by default, then grant narrowly. `authenticated` must never reach this:
-- it is operator telemetry about other people's erasure requests.
revoke all on function kilo.health_deletion_monitor_snapshot() from public, anon, authenticated;
grant execute on function kilo.health_deletion_monitor_snapshot() to service_role;

comment on function kilo.health_deletion_monitor_snapshot() is
  'Operator/monitor telemetry for the health-deletion queue: cron status, Vault secret NAMES, and per-job timing metadata. Security definer so it can read cron.job and the RLS-denied jobs table. Never returns user_id, health values, or secret material.';

-- ---------------------------------------------------------------------------
-- 2. The least-privilege monitor role
-- ---------------------------------------------------------------------------

-- Created here rather than out of band so the grant below is deterministic: a
-- role created by an operator AFTER this migration ran would silently hold no
-- grant, and the monitor would fail with a permission error that looks exactly
-- like the outage it is meant to detect.
--
-- NO PASSWORD IS SET, HERE OR ANYWHERE IN THIS REPOSITORY. A password written
-- into a migration is a password published to the repository. The role cannot
-- authenticate until an authorized operator runs, out of band and once:
--
--   alter role kilo_deletion_monitor with password '<generated by the operator>';
--
-- `nologin` would be wrong (the monitor connects as this role) and `noinherit`
-- keeps it from picking up privileges from any role it is later added to.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'kilo_deletion_monitor') then
    create role kilo_deletion_monitor with login noinherit;
  end if;
end;
$$;

-- The complete privilege set. Deliberately minimal: usage on one schema and
-- execute on one function. Note what is NOT here -- no table grants at all, no
-- `grant select on cron.job` (the accessor covers it), no `usage on schema
-- vault` (ditto), no write anywhere, and nothing touching the co-tenant
-- `canonical`/`raw`/`serving`/`ops`/`legacy` schemas.
grant usage on schema kilo to kilo_deletion_monitor;
grant execute on function kilo.health_deletion_monitor_snapshot() to kilo_deletion_monitor;

comment on role kilo_deletion_monitor is
  'Read-only monitor identity for the health-deletion queue. Its only privilege is execute on kilo.health_deletion_monitor_snapshot(). Password is set out of band by an operator and never committed.';
