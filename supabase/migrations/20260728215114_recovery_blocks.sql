-- Recovery blocks and week memberships (issue #693).
--
-- Persists the local recovery-block domain added in #692:
--
--   kilo.recovery_blocks       one row per recovery block, carrying the FROZEN
--                              pre-recovery baseline snapshot captured at
--                              creation time
--   kilo.recovery_block_weeks  ordered membership rows linking ordinary workout
--                              notes to a block
--
-- Both are ordinary sync collections in the sense every other Kilo collection
-- is: owner-first `(user_id, id)` primary key with the CLIENT id preserved as
-- text so a record keeps its identity across devices, server-authoritative
-- `updated_at`/`sync_xid` stamped by the shared BEFORE trigger, and a
-- `deleted_at` tombstone that is retained rather than physically removed so a
-- delete converges before any cleanup.
--
-- HEALTH DATA. A baseline snapshot is a frozen record of what the lifter could
-- do before an injury, and a membership says which weeks they trained while
-- recovering from one. That is data concerning health under Art. 9, so both
-- tables carry the same gated RLS predicate as workout_notes: ownership AND an
-- active consent grant. They are deliberately NOT added to
-- kilo.health_gated_tables() / the Edge Function HEALTH_DATA_SCOPE here —
-- export, the withdrawal deletion worker, and the consent material version are
-- explicitly out of scope for #693, and that list must move all three surfaces
-- plus the material version together (see the contract note in
-- supabase/functions/_shared/health-data-scope.ts). Gating the policies now is
-- what keeps this from shipping as a NEW UNGATED health surface in the
-- meantime; the follow-up that brings these tables into the purge/export scope
-- is required before withdrawal can be claimed complete for recovery data, and
-- is recorded in docs/backend-schema.md.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- `baseline` holds the frozen snapshot verbatim: `{ version, exercises: [...] }`
-- as captured by lib/data/recoveryBlocks.captureRecoveryBaselineFromText. It is
-- stored as opaque jsonb on purpose — the server never interprets, recomputes,
-- or normalizes it, because the entire contract of a baseline is that a later
-- edit to the source routine cannot move it.
--
-- `baseline_note_id` intentionally has NO foreign key to kilo.workout_notes.
-- fatigue_checkins.workout_note_id sets the same precedent, and there is a
-- concrete operational reason: the withdrawal purge deletes workout_notes for a
-- user, and a referencing row in a table the purge does not cover would block
-- that delete outright. The client enforces the reference (it refuses to
-- baseline against a missing note), and sync pushes workout notes first so the
-- note is present by the time a block or membership arrives.
create table if not exists kilo.recovery_blocks (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  baseline_note_id text,
  baseline_note_title text,
  baseline jsonb,
  include_in_normal_analytics boolean not null default false,
  started_at timestamptz,
  completed_at timestamptz,
  saved_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sync_xid bigint not null default 0,
  primary key (user_id, id)
);

-- A membership binds one workout note to one block as its ordinal week. The
-- block reference IS enforced, owner-first, because both sides of it live in
-- this migration's own tables and the sync engine pushes blocks before weeks, so
-- the referenced row is always present in dependency order. `on delete cascade`
-- only fires for a PHYSICAL block delete (an auth.users cascade); the ordinary
-- app delete is a tombstone, which the client cascades to the block's live
-- memberships so both sides converge as retained rows.
create table if not exists kilo.recovery_block_weeks (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  block_id text not null,
  note_id text,
  week_number integer,
  completed_at timestamptz,
  saved_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sync_xid bigint not null default 0,
  primary key (user_id, id),
  constraint recovery_block_weeks_block_fk
    foreign key (user_id, block_id)
    references kilo.recovery_blocks (user_id, id)
    on delete cascade,
  constraint recovery_block_weeks_week_number_positive
    check (week_number is null or week_number > 0)
);

-- ---------------------------------------------------------------------------
-- 2. Server-authoritative updated_at + sync_xid
-- ---------------------------------------------------------------------------
--
-- The same trigger every other synced table uses (see 20260622120000 and
-- 20260722151110). A client-supplied updated_at can therefore never manipulate
-- last-write-wins ordering, and every write records its transaction id so the
-- commit-safe pull feed can bound a page.
drop trigger if exists set_updated_at on kilo.recovery_blocks;
create trigger set_updated_at
  before insert or update on kilo.recovery_blocks
  for each row execute function kilo.set_updated_at();

drop trigger if exists set_updated_at on kilo.recovery_block_weeks;
create trigger set_updated_at
  before insert or update on kilo.recovery_block_weeks
  for each row execute function kilo.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Cross-record invariants, enforced on LIVE rows only
-- ---------------------------------------------------------------------------
--
-- The three domain invariants #692 enforces client-side are enforced here too,
-- deterministically and per owner. Each is a PARTIAL unique index over live rows
-- (`deleted_at is null`), which is what lets the history stay intact: any number
-- of tombstoned blocks, memberships, and reused ordinals may coexist, because a
-- tombstone is a retained record of something that ended, not a live claim.
--
-- These indexes are the authority when two devices race. A second device that
-- pushes a duplicate is rejected by the database rather than silently accepted,
-- and the client collapses the duplicate deterministically on its next pass (see
-- storage/cloud/syncAdapter.js). Rejecting is deliberate: accepting both would
-- make "the active block" ambiguous on every device at once.

-- At most one ACTIVE block per user: live and not yet completed.
create unique index if not exists recovery_blocks_one_active_idx
  on kilo.recovery_blocks (user_id)
  where deleted_at is null and completed_at is null;

-- At most one LIVE membership per workout note, across all blocks. A note that
-- was removed from one block (tombstoned) may join another.
create unique index if not exists recovery_block_weeks_one_live_note_idx
  on kilo.recovery_block_weeks (user_id, note_id)
  where deleted_at is null;

-- Week ordinals are unique within a block among live memberships.
create unique index if not exists recovery_block_weeks_live_ordinal_idx
  on kilo.recovery_block_weeks (user_id, block_id, week_number)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 4. Read and sync-feed indexes
-- ---------------------------------------------------------------------------
--
-- Owner-first, matching the convention in docs/backend-schema.md. The two
-- `*_sync_feed_idx` indexes carry the keyset order the commit-safe pull feed
-- pages by (`updated_at`, primary-key component, `sync_xid`).

-- Active-block and block-history reads: newest recovery first.
create index if not exists recovery_blocks_user_started_idx
  on kilo.recovery_blocks (user_id, started_at desc);

-- Ordered week reads for one block. This is the ordering later comparison
-- analytics walk, including the tombstoned rows an audit or export needs.
create index if not exists recovery_block_weeks_block_order_idx
  on kilo.recovery_block_weeks (user_id, block_id, week_number);

-- Membership lookup by note ("is this note part of a recovery block?").
create index if not exists recovery_block_weeks_note_idx
  on kilo.recovery_block_weeks (user_id, note_id);

create index if not exists recovery_blocks_sync_feed_idx
  on kilo.recovery_blocks (user_id, updated_at, id, sync_xid);

create index if not exists recovery_block_weeks_sync_feed_idx
  on kilo.recovery_block_weeks (user_id, updated_at, id, sync_xid);

-- ---------------------------------------------------------------------------
-- 5. RLS: owner-scoped AND consent-gated
-- ---------------------------------------------------------------------------
--
-- Identical shape to the gated policies in 20260714120001: `user_id = auth.uid()`
-- for ownership, `kilo.health_gate_ok()` for the Art. 9 grant, both wrapped in a
-- scalar subquery so the planner evaluates them once per statement (InitPlan)
-- rather than once per row. Update policies pair `using` with `with check` so
-- update visibility is owner-only and a row cannot be reassigned to another
-- owner.
alter table kilo.recovery_blocks enable row level security;
alter table kilo.recovery_block_weeks enable row level security;

do $$
declare
  t text;
  tables text[] := array['recovery_blocks', 'recovery_block_weeks'];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on kilo.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on kilo.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on kilo.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on kilo.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on kilo.%I for select to authenticated
         using (user_id = (select auth.uid()) and (select kilo.health_gate_ok()))',
      t || '_select_own', t);
    execute format(
      'create policy %I on kilo.%I for insert to authenticated
         with check (user_id = (select auth.uid()) and (select kilo.health_gate_ok()))',
      t || '_insert_own', t);
    execute format(
      'create policy %I on kilo.%I for update to authenticated
         using (user_id = (select auth.uid()) and (select kilo.health_gate_ok()))
         with check (user_id = (select auth.uid()) and (select kilo.health_gate_ok()))',
      t || '_update_own', t);
    execute format(
      'create policy %I on kilo.%I for delete to authenticated
         using (user_id = (select auth.uid()) and (select kilo.health_gate_ok()))',
      t || '_delete_own', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
--
-- The `kilo` schema has no default Supabase privileges, so they are issued by
-- hand. `authenticated` gets RLS-scoped DML; `service_role` gets full access for
-- the server-owned export/deletion paths. `anon` is never granted anything, and
-- the explicit revoke states that rather than relying on the absence of a grant.
grant select, insert, update, delete on kilo.recovery_blocks      to authenticated;
grant select, insert, update, delete on kilo.recovery_block_weeks to authenticated;

grant all on kilo.recovery_blocks      to service_role;
grant all on kilo.recovery_block_weeks to service_role;

revoke all on kilo.recovery_blocks      from anon;
revoke all on kilo.recovery_block_weeks from anon;

-- ---------------------------------------------------------------------------
-- 7. Admit both tables to the commit-safe pull feed
-- ---------------------------------------------------------------------------
--
-- kilo.pull_sync_changes (20260722151110) validates p_table against a fixed
-- allowlist, so a new collection is unreachable by the client's pull path until
-- it is named there. The body below is otherwise unchanged from that migration:
-- both new tables key on `id`, so they fall through to the default secondary
-- seek column and need no other change.
create or replace function kilo.pull_sync_changes(
  p_table text,
  p_cursor text default null,
  p_boundary text default null,
  p_after_updated_at timestamptz default null,
  p_after_id text default null,
  p_limit integer default 1000
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_cursor bigint;
  v_boundary bigint;
  v_secondary text;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Cloud sync pull requires an authenticated user.'
      using errcode = '42501';
  end if;

  if p_table is null or p_table <> all (array[
    'user_profile', 'user_health_profile', 'feature_toggles',
    'weight_entries', 'weight_goal', 'workout_notes', 'deload_history',
    'fatigue_checkins', 'archived_weight_goals',
    'recovery_blocks', 'recovery_block_weeks'
  ]) then
    raise exception 'Unsupported cloud sync table: %', coalesce(p_table, '<null>')
      using errcode = '22023';
  end if;

  if p_limit < 1 or p_limit > 1000 then
    raise exception 'Cloud sync page limit must be between 1 and 1000.'
      using errcode = '22023';
  end if;

  if (p_after_updated_at is null) <> (p_after_id is null) then
    raise exception 'Cloud sync continuation requires both seek values.'
      using errcode = '22023';
  end if;

  begin
    v_cursor := case
      when p_cursor is null then 0
      when p_cursor ~ '^xid:[0-9]+$' then substring(p_cursor from 5)::bigint
      else null
    end;
  exception when numeric_value_out_of_range then
    v_cursor := null;
  end;

  -- A legacy timestamp or malformed cursor intentionally requests a full pull.
  -- This one-time replay is safe and upgrades the device onto the xid boundary.
  if v_cursor is null then
    v_cursor := 0;
  end if;

  if p_boundary is null then
    v_boundary := pg_snapshot_xmin(pg_current_snapshot())::text::bigint;
  elsif p_boundary ~ '^xid:[0-9]+$' then
    v_boundary := substring(p_boundary from 5)::bigint;
  else
    raise exception 'Malformed cloud sync boundary.' using errcode = '22023';
  end if;

  if v_boundary < v_cursor then
    raise exception 'Cloud sync boundary precedes the cursor.' using errcode = '22023';
  end if;

  v_secondary := case
    when p_table in ('user_profile', 'user_health_profile', 'feature_toggles', 'weight_goal')
      then 'user_id'
    else 'id'
  end;

  -- p_table and v_secondary are selected exclusively from fixed allowlists.
  -- RLS still applies because this is SECURITY INVOKER, and the explicit owner
  -- predicate is defense in depth against accidental policy broadening.
  execute format($query$
    with page_window as (
      select
        (to_jsonb(t) - 'sync_xid') ||
          jsonb_build_object('__kilo_sync_xid', t.sync_xid::text) as row_data,
        t.updated_at,
        t.%1$I::text as row_id,
        t.sync_xid,
        row_number() over (order by t.updated_at, t.%1$I::text) as page_row
      from kilo.%2$I as t
      where t.user_id = $1
        and t.sync_xid >= $2
        and t.sync_xid < $3
        and (
          $4::timestamptz is null
          or (t.updated_at, t.%1$I::text) > ($4::timestamptz, $5::text)
        )
      order by t.updated_at, t.%1$I::text
      limit $6 + 1
    )
    select jsonb_build_object(
      'rows', coalesce(
        jsonb_agg(row_data order by updated_at, row_id)
          filter (where page_row <= $6),
        '[]'::jsonb
      ),
      'cursor', 'xid:' || $3::text,
      'has_more', count(*) > $6
    )
    from page_window
  $query$, v_secondary, p_table)
  into v_result
  using v_user_id, v_cursor, v_boundary, p_after_updated_at, p_after_id, p_limit;

  return v_result;
end;
$$;

comment on function kilo.pull_sync_changes(text, text, text, timestamptz, text, integer)
is 'Owner-scoped, commit-safe sync feed. Cursor advancement uses snapshot xmin; continuation uses updated_at plus the table primary-key component. A fixed wall-clock lag is intentionally not used because transaction duration is unbounded.';

revoke all on function kilo.pull_sync_changes(text, text, text, timestamptz, text, integer)
  from public, anon;
grant execute on function kilo.pull_sync_changes(text, text, text, timestamptz, text, integer)
  to authenticated;

comment on table kilo.recovery_blocks is
  'Recovery blocks with their frozen pre-recovery baseline snapshot (issue #693). The baseline jsonb is captured once by the client and never recomputed server-side.';
comment on table kilo.recovery_block_weeks is
  'Ordered workout-note memberships of a recovery block (issue #693). Live rows are unique per note and per (block, week ordinal); tombstones are retained.';
