-- Commit-safe cloud pull feed (issue #620).
--
-- A wall-clock cursor cannot prove that a row is safe to skip. updated_at is
-- stamped with now(), which is the writer transaction's start time: a writer
-- can receive an old timestamp, remain invisible while another session pages a
-- live table, then commit after that session advances past the timestamp. No
-- fixed lag can close that gap because a transaction's lifetime is unbounded.
--
-- Every synced write now records its 64-bit transaction ID. A pull captures
-- pg_snapshot_xmin(pg_current_snapshot()) and returns only rows whose writer is
-- in [the previous boundary, the new boundary). Every xid below snapshot xmin
-- was already completed before the snapshot, so the client may advance to that
-- boundary after it consumes every keyset page. A writer still in progress has
-- xid >= xmin and is therefore recovered by a later pass after it commits.

-- Existing rows predate transaction tracking. Zero makes them part of a first
-- full pull without rewriting the tables or firing their updated_at triggers.
alter table kilo.user_profile add column if not exists sync_xid bigint not null default 0;
alter table kilo.user_health_profile add column if not exists sync_xid bigint not null default 0;
alter table kilo.feature_toggles add column if not exists sync_xid bigint not null default 0;
alter table kilo.weight_entries add column if not exists sync_xid bigint not null default 0;
alter table kilo.weight_goal add column if not exists sync_xid bigint not null default 0;
alter table kilo.workout_notes add column if not exists sync_xid bigint not null default 0;
alter table kilo.deload_history add column if not exists sync_xid bigint not null default 0;
alter table kilo.fatigue_checkins add column if not exists sync_xid bigint not null default 0;
alter table kilo.archived_weight_goals add column if not exists sync_xid bigint not null default 0;

-- Stamp the ordering timestamp and the writer xid in the same BEFORE trigger.
-- xid8 is cast through text because PostgreSQL does not define a direct xid8 to
-- bigint cast. The bigint stays internal; the RPC exposes cursor values as text
-- so JavaScript never loses precision.
create or replace function kilo.set_updated_at()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at := now();
  new.sync_xid := pg_current_xact_id()::text::bigint;
  return new;
end;
$$;

-- Preserve the health-profile mirror's existing timestamp semantics while
-- recording every genuine, mirrored, and privileged repair write. Mirror writes
-- happen in the same transaction as their source and therefore receive the same
-- xid, exactly matching the logical change they replicate.
create or replace function kilo.set_updated_at_compat()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.sync_xid := pg_current_xact_id()::text::bigint;

  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if current_user not in ('authenticated', 'anon')
     and coalesce(current_setting('kilo.suppress_updated_at_stamp', true), 'off') = 'on' then
    return new;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- The seek key follows the client merge order. Collection tables use id;
-- singleton tables use user_id, their actual primary key. These indexes keep
-- owner-scoped ordered scans bounded without changing any uniqueness contract.
create index if not exists user_profile_sync_feed_idx
  on kilo.user_profile (user_id, updated_at, sync_xid);
create index if not exists user_health_profile_sync_feed_idx
  on kilo.user_health_profile (user_id, updated_at, sync_xid);
create index if not exists feature_toggles_sync_feed_idx
  on kilo.feature_toggles (user_id, updated_at, sync_xid);
create index if not exists weight_entries_sync_feed_idx
  on kilo.weight_entries (user_id, updated_at, id, sync_xid);
create index if not exists weight_goal_sync_feed_idx
  on kilo.weight_goal (user_id, updated_at, sync_xid);
create index if not exists workout_notes_sync_feed_idx
  on kilo.workout_notes (user_id, updated_at, id, sync_xid);
create index if not exists deload_history_sync_feed_idx
  on kilo.deload_history (user_id, updated_at, id, sync_xid);
create index if not exists fatigue_checkins_sync_feed_idx
  on kilo.fatigue_checkins (user_id, updated_at, id, sync_xid);
create index if not exists archived_weight_goals_sync_feed_idx
  on kilo.archived_weight_goals (user_id, updated_at, id, sync_xid);

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
    'fatigue_checkins', 'archived_weight_goals'
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
