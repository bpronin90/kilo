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
-- path:
--
--   * kilo.evidence_retention_sweep() is the ONLY designated prune path. It marks
--     the current transaction with a local flag before its delete and clears it
--     immediately after, so nothing outside that narrow window is trusted.
--   * A BEFORE DELETE row trigger rejects every delete unless (a) that flag is
--     set AND (b) the specific row's own retention has actually expired
--     (expires_at <= now()). Both conditions are required; either one missing
--     rejects the row.
--
-- The two conditions are deliberately redundant. The flag proves the delete came
-- from the retention sweep and nowhere else; the per-row expires_at check means
-- that even the sweep cannot remove a row before its retention elapses, so a
-- future bug in the sweep's WHERE clause still cannot leak an unexpired row. The
-- existing BEFORE UPDATE immutability trigger is left untouched, so UPDATE stays
-- rejected as before.

-- ---------------------------------------------------------------------------
-- 1. Delete guard
-- ---------------------------------------------------------------------------

create or replace function kilo.consent_evidence_archive_delete_guard()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  -- Fail closed. A delete is authorized only from the designated retention-prune
  -- path, which sets this transaction-local flag around its statement. current_
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
