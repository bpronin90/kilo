-- Permit the auth.users deletion cascade to erase the consent ledger (issue #519).
--
-- kilo.consent_events.user_id references auth.users(id) ON DELETE CASCADE, but the
-- append-only trigger installed in 20260714120001_consent_schema.sql raised on
-- EVERY delete, including the child-row deletes issued by that cascade. Deleting a
-- consented user's auth.users row therefore failed with SQLSTATE 23514 after other
-- account cleanup had already run, permanently breaking account deletion and
-- leaving a partial-deletion state (independently reproduced in #522).
--
-- This migration relaxes the trigger for exactly one case: a DELETE whose parent
-- auth.users row is already gone. During ON DELETE CASCADE, PostgreSQL removes the
-- parent row first and then fires an AFTER trigger on auth.users that issues the
-- child deletes, so by the time this BEFORE DELETE trigger runs the parent no
-- longer exists. A direct DELETE against kilo.consent_events leaves the parent in
-- place and is still rejected; consent_events.user_id is NOT NULL and FK-cascaded,
-- so a child row can never outlive its parent outside of that cascade. Every UPDATE
-- remains rejected. The append-only guarantee is therefore unchanged for all
-- application paths; only the FK-initiated erasure is allowed through.

create or replace function kilo.consent_events_append_only()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  -- Allow only the child-row deletion caused by an auth.users parent cascade. The
  -- parent is already deleted when the cascade reaches this BEFORE DELETE trigger,
  -- so its absence uniquely identifies the cascade. Direct deletes (parent still
  -- present) and all updates fall through to the append-only violation.
  if tg_op = 'DELETE' and not exists (
    select 1 from auth.users where id = old.user_id
  ) then
    return old;
  end if;

  raise exception 'kilo.consent_events is append-only'
    using errcode = 'check_violation';
end;
$$;

-- The trigger definition itself is unchanged (before update or delete, per row);
-- only the function body above is replaced.
