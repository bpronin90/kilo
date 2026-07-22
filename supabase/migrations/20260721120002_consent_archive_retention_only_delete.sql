-- Enforce retention-only deletion of consent evidence archives (issue #608,
-- follow-up to #572 claim 24).
--
-- The stated invariant is that consent evidence archive rows "leave only by
-- retention expiry" (see 20260714120001). That invariant was only half enforced:
-- the consent_evidence_archive_immutable trigger fires BEFORE UPDATE, so it
-- blocks mutation but says nothing about DELETE. Any service-role connection
-- (PostgREST admin, an Edge Function, a stray operator query) could therefore
-- run `delete from kilo.consent_evidence_archive` and destroy six-year GDPR
-- Art. 17(3)(e) retention evidence years early. The archive has no foreign key to
-- auth.users, so account deletion never cascades into it -- the only thing that
-- was ever supposed to remove a row is the scheduled retention sweep.
--
-- This migration closes DELETE, fail-closed, without breaking the one authorized
-- path. It layers a non-forgeable privilege gate under the trigger:
--
--   * PRIMARY GATE (privilege): direct DELETE is revoked from service_role, the
--     only application role that held it (via `grant all` in 20260714120001).
--     `authenticated` never had it (RLS with no delete policy). After the revoke,
--     no caller reaching the database over PostgREST or an Edge Function can issue
--     a DELETE at all -- the attempt fails with insufficient_privilege before any
--     trigger runs. kilo.evidence_retention_sweep() is SECURITY DEFINER and runs
--     as its owner, which owns the table and therefore keeps DELETE regardless of
--     the revoke, so the one authorized path is unaffected.
--   * DEFENSE IN DEPTH (trigger): a BEFORE DELETE row trigger rejects every delete
--     unless (a) it originates from the retention sweep, which raises a
--     transaction-local flag around its statement, AND (b) the specific row's own
--     retention has actually expired (expires_at <= now()). Both are required.
--
-- The privilege revoke -- not the flag -- is what defeats a hostile service-role
-- SQL caller. A custom GUC like kilo.evidence_prune is caller-settable, so a flag
-- ALONE could be forged (`BEGIN; SET LOCAL kilo.evidence_prune = on; DELETE ...`);
-- once direct DELETE is gone, that forgery has nothing left to act on. The flag is
-- retained anyway because it still forces the remaining privileged deleters (the
-- table owner and the definer sweep) through kilo.evidence_retention_sweep(),
-- preserving the sweep's key-lifecycle bookkeeping; a stray owner-level
-- `delete ... where expires_at <= now()` outside the sweep is still rejected. The
-- per-row expires_at check means even the sweep cannot remove a row before its
-- retention elapses, so a future bug in the sweep's WHERE clause still cannot leak
-- an unexpired row. The existing BEFORE UPDATE immutability trigger is left
-- untouched, so UPDATE stays rejected as before.

-- ---------------------------------------------------------------------------
-- 1. Delete guard
-- ---------------------------------------------------------------------------

create or replace function kilo.consent_evidence_archive_delete_guard()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  -- Fail closed. This is defense in depth behind the DELETE revoke below, not the
  -- security boundary: the flag is caller-settable, so it cannot by itself stop a
  -- role that holds DELETE. Its job now is to force the remaining privileged
  -- deleters (the table owner and the definer sweep) through the sweep. current_
  -- setting(..., true) returns NULL when the flag was never set, and `is distinct
  -- from` treats that NULL as "not the prune path".
  if current_setting('kilo.evidence_prune', true) is distinct from 'on' then
    raise exception
      'kilo.consent_evidence_archive rows leave only through kilo.evidence_retention_sweep()'
      using errcode = 'check_violation';
  end if;

  -- Defense in depth: even on the designated path, a row may only leave once its
  -- own six-year retention has expired. This bounds the sweep to expired rows
  -- independently of its WHERE clause.
  if old.expires_at > now() then
    raise exception
      'kilo.consent_evidence_archive retention has not expired for row % (expires_at %)',
      old.id, old.expires_at
      using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

drop trigger if exists consent_evidence_archive_no_delete on kilo.consent_evidence_archive;
create trigger consent_evidence_archive_no_delete
  before delete on kilo.consent_evidence_archive
  for each row execute function kilo.consent_evidence_archive_delete_guard();

-- ---------------------------------------------------------------------------
-- 1b. Remove the forgeable path entirely: revoke direct DELETE
-- ---------------------------------------------------------------------------

-- The primary, non-forgeable gate. service_role held `grant all` (see
-- 20260714120001), which includes both DELETE and TRUNCATE; strip both so no
-- application role can remove a row, and a forged prune flag has nothing to act
-- on. TRUNCATE must go with DELETE: a BEFORE DELETE row trigger never fires on
-- TRUNCATE, so leaving it would let a caller wipe the whole archive around the
-- guard. INSERT/SELECT/UPDATE are retained: account-delete still writes evidence
-- rows, and the immutability trigger still rejects UPDATE. `authenticated` and
-- `public` never held these here, but revoke defensively so the privilege cannot
-- reappear through a future blanket grant. kilo.evidence_retention_sweep() below
-- is SECURITY DEFINER and runs as the table owner, which keeps DELETE, so the one
-- authorized path works.
revoke delete, truncate on kilo.consent_evidence_archive from service_role, authenticated, public;

-- ---------------------------------------------------------------------------
-- 2. Designate the prune path
-- ---------------------------------------------------------------------------

-- Same body as 20260714120002, with the transaction-local prune flag raised
-- around the archive delete and lowered immediately afterward. Everything else --
-- the destroyable-key marking and the returned summary -- is unchanged.
create or replace function kilo.evidence_retention_sweep()
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_expired integer;
  v_destroyable text[];
begin
  -- Authorize this and only this delete: raise the flag, prune, lower it again so
  -- no later statement in the same transaction inherits delete authority.
  perform set_config('kilo.evidence_prune', 'on', true);
  delete from kilo.consent_evidence_archive where expires_at <= now();
  get diagnostics v_expired = row_count;
  perform set_config('kilo.evidence_prune', 'off', true);

  -- A retired key version stays recoverable for as long as ANY archive row still
  -- references it; rotation must never invalidate evidence. Only once the last
  -- referencing row has expired does the version become destroyable.
  with destroyed as (
    update kilo.consent_evidence_key k set
      destroyed_at = now()
    where k.destroyed_at is null
      and k.retired_at is not null
      and not exists (
        select 1 from kilo.consent_evidence_archive a
        where a.evidence_key_id = k.evidence_key_id
      )
    returning k.evidence_key_id
  )
  select coalesce(array_agg(evidence_key_id), '{}'::text[]) into v_destroyable from destroyed;

  return jsonb_build_object(
    'archives_expired', v_expired,
    'keys_marked_destroyable', coalesce(array_length(v_destroyable, 1), 0),
    -- Surfaced so the operator knows exactly which key material to destroy
    -- outside the database. Key ids are not secrets; the key material is.
    'destroyable_key_ids', to_jsonb(v_destroyable)
  );
end;
$$;

revoke all on function kilo.evidence_retention_sweep() from public, anon, authenticated;
grant execute on function kilo.evidence_retention_sweep() to service_role;
