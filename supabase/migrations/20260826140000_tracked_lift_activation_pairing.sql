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
-- Residual, owner-accepted as a normative amendment to #893 (decision comment
-- 5427060885, proposal 5426951126). A legacy device that untracks, logs, and
-- retracks the same exercise with no intervening sync does not merely arrive
-- late — it emits NOTHING. user_health_profile is a diff-tracked singleton and
-- diffAgainstBaseline compares each field by stableStringify against the last
-- server-confirmed baseline (mobile/storage/syncQueue.js:1125-1131,1205), so an
-- untrack followed by a retrack of the same key returns tracked_lifts byte-
-- identical to that baseline and the row is never dirty. No write reaches this
-- table, so this trigger never fires, updated_at never advances, and nothing
-- stored beside the records can disagree with anything. The interruption is not
-- late evidence; it is no evidence.
--
-- Accepted because it is bounded exactly as the #892 equal-witness residual is:
-- it cannot create a cross-movement comparison, the boundary always lands inside
-- that exercise's own history, capability metrics are unaffected, and it clears
-- on that exercise's next toggle from any watermark-aware client. What must stay
-- true is the line above it: every path in which the untracked state DOES reach
-- the account — any push whose tracked_lifts omits the exercise, which is what
-- an ordinary sync between the untrack and the retrack produces — is closed
-- here.

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
