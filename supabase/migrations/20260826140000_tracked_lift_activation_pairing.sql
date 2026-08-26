-- Enforce the tracked-span pairing invariant on the health singleton
-- (issue #893, review feedback on PR #895 finding 2).
--
-- The invariant, from the #892 contract: an activation record exists ONLY for a
-- currently tracked key, and untrack deletes the flag and the record together.
--
-- A watermark-aware client maintains that by construction. An older build
-- cannot: its upsert names `tracked_lifts` and not `tracked_lift_activations`,
-- so Postgres PRESERVES the stored records across its untrack rather than
-- clearing them. The row is then internally inconsistent — a record for a key
-- that is no longer tracked — and if that client later retracks the same
-- exercise, the record's witness still matches its unchanged opening history,
-- reconciliation keeps it, and every session logged during the untracked gap is
-- pulled back into the "new" trend. That is precisely the comparison #893
-- exists to prevent, arriving through a mixed-version account.
--
-- Fixing it at the table is what makes it authoritative: the invalidation
-- happens at the moment the legacy write lands, for every device, rather than
-- depending on which client next happens to read the row. The mobile sync,
-- backup-restore, and bootstrap paths apply the same prune locally; this is the
-- copy no client can bypass.
--
-- Deliberately narrow. It drops exactly the orphaned records and nothing else,
-- so it is a no-op for every write a watermark-aware client makes, and it never
-- touches `tracked_lifts` — an exercise that is out of the routine for a deload,
-- an injury, or a routine switch is still tracked, and auto-untracking would
-- destroy the explicit intent the flag exists to carry.
--
-- Residual, stated rather than papered over: a legacy device that untracks,
-- logs, and retracks entirely OFFLINE pushes only the final state, in which the
-- flag is true again and nothing is orphaned. That coalesced case is invisible
-- in the row and is not caught here. It degrades the same way the contract's
-- documented equal-witness residual does — an anchor that is older than the user
-- intended, always inside that exercise's own history, never a cross-movement
-- comparison — and it clears on that exercise's next toggle from any
-- watermark-aware client.

create or replace function kilo.prune_orphan_tracked_lift_activations()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_pruned jsonb;
begin
  if new.tracked_lift_activations is null
     or jsonb_typeof(new.tracked_lift_activations) <> 'object' then
    return new;
  end if;

  -- Keep only the records whose key is still truthy in tracked_lifts. A null or
  -- non-object flag map keeps nothing: there is no tracked key to belong to.
  select coalesce(jsonb_object_agg(a.key, a.value), '{}'::jsonb)
    into v_pruned
    from jsonb_each(new.tracked_lift_activations) as a
   where jsonb_typeof(coalesce(new.tracked_lifts, '{}'::jsonb)) = 'object'
     and coalesce(new.tracked_lifts -> a.key, 'false'::jsonb) = 'true'::jsonb;

  if v_pruned is distinct from new.tracked_lift_activations then
    new.tracked_lift_activations := v_pruned;
  end if;

  return new;
end;
$$;

revoke all on function kilo.prune_orphan_tracked_lift_activations() from public, anon, authenticated;

drop trigger if exists prune_orphan_tracked_lift_activations on kilo.user_health_profile;
create trigger prune_orphan_tracked_lift_activations
  before insert or update on kilo.user_health_profile
  for each row
  execute function kilo.prune_orphan_tracked_lift_activations();

comment on function kilo.prune_orphan_tracked_lift_activations() is
  'Drops tracked_lift_activations entries whose key is not currently tracked (#893). Makes the untrack-clears-the-record invariant authoritative against older clients whose upsert omits the activations column.';
