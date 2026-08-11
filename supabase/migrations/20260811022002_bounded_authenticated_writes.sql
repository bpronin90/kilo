-- Bound direct authenticated writes to Kilo's sync collections (issue #796).
--
-- Payload limits are enforced by a BEFORE trigger over the complete logical row,
-- so newly added columns cannot silently become an unbounded write surface. The
-- trigger is installed only after the usage ledger is initialized: existing rows
-- are preserved byte-for-byte, including any legacy row above a new limit, while
-- every subsequent INSERT/UPDATE must satisfy the bounds.
--
-- Quotas are maintained in private, RLS-enabled ledger tables. A single atomic
-- update to account_storage_usage serializes every size-increasing write for one
-- account; collection_storage_usage then enforces the per-collection row/byte
-- limits in the same transaction. A rejected trigger raises and rolls both the
-- row write and ledger reservation back, closing concurrent check-then-insert
-- races without exposing a quota RPC to clients.

create table if not exists kilo.account_storage_usage (
  user_id uuid primary key references auth.users (id) on delete cascade,
  total_bytes bigint not null,
  constraint account_storage_usage_nonnegative check (total_bytes >= 0)
);

create table if not exists kilo.collection_storage_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  collection text not null,
  row_count bigint not null,
  total_bytes bigint not null,
  primary key (user_id, collection),
  constraint collection_storage_usage_nonnegative
    check (row_count >= 0 and total_bytes >= 0),
  constraint collection_storage_usage_known_collection check (
    collection = any (array[
      'user_profile',
      'feature_toggles',
      'weight_entries',
      'weight_goal',
      'workout_notes',
      'deload_history',
      'fatigue_checkins',
      'archived_weight_goals',
      'user_health_profile',
      'recovery_blocks',
      'recovery_block_weeks'
    ])
  )
);

alter table kilo.account_storage_usage enable row level security;
alter table kilo.collection_storage_usage enable row level security;

revoke all on kilo.account_storage_usage from public, anon, authenticated;
revoke all on kilo.collection_storage_usage from public, anon, authenticated;
grant select on kilo.account_storage_usage to service_role;
grant select on kilo.collection_storage_usage to service_role;

-- Seed exact usage without rewriting application rows. All source tables are
-- owner-indexed, and this is a one-time migration scan.
with usage_by_collection as (
  select user_id, 'user_profile'::text as collection,
         count(*)::bigint as row_count,
         coalesce(sum(pg_column_size(to_jsonb(t))), 0)::bigint as total_bytes
    from kilo.user_profile t group by user_id
  union all
  select user_id, 'feature_toggles', count(*)::bigint,
         coalesce(sum(pg_column_size(to_jsonb(t))), 0)::bigint
    from kilo.feature_toggles t group by user_id
  union all
  select user_id, 'weight_entries', count(*)::bigint,
         coalesce(sum(pg_column_size(to_jsonb(t))), 0)::bigint
    from kilo.weight_entries t group by user_id
  union all
  select user_id, 'weight_goal', count(*)::bigint,
         coalesce(sum(pg_column_size(to_jsonb(t))), 0)::bigint
    from kilo.weight_goal t group by user_id
  union all
  select user_id, 'workout_notes', count(*)::bigint,
         coalesce(sum(pg_column_size(to_jsonb(t))), 0)::bigint
    from kilo.workout_notes t group by user_id
  union all
  select user_id, 'deload_history', count(*)::bigint,
         coalesce(sum(pg_column_size(to_jsonb(t))), 0)::bigint
    from kilo.deload_history t group by user_id
  union all
  select user_id, 'fatigue_checkins', count(*)::bigint,
         coalesce(sum(pg_column_size(to_jsonb(t))), 0)::bigint
    from kilo.fatigue_checkins t group by user_id
  union all
  select user_id, 'archived_weight_goals', count(*)::bigint,
         coalesce(sum(pg_column_size(to_jsonb(t))), 0)::bigint
    from kilo.archived_weight_goals t group by user_id
  union all
  select user_id, 'user_health_profile', count(*)::bigint,
         coalesce(sum(pg_column_size(to_jsonb(t))), 0)::bigint
    from kilo.user_health_profile t group by user_id
  union all
  select user_id, 'recovery_blocks', count(*)::bigint,
         coalesce(sum(pg_column_size(to_jsonb(t))), 0)::bigint
    from kilo.recovery_blocks t group by user_id
  union all
  select user_id, 'recovery_block_weeks', count(*)::bigint,
         coalesce(sum(pg_column_size(to_jsonb(t))), 0)::bigint
    from kilo.recovery_block_weeks t group by user_id
)
insert into kilo.collection_storage_usage (
  user_id, collection, row_count, total_bytes
)
select user_id, collection, row_count, total_bytes
from usage_by_collection
on conflict (user_id, collection) do update
  set row_count = excluded.row_count,
      total_bytes = excluded.total_bytes;

insert into kilo.account_storage_usage (user_id, total_bytes)
select user_id, sum(total_bytes)::bigint
from kilo.collection_storage_usage
group by user_id
on conflict (user_id) do update
  set total_bytes = excluded.total_bytes;

create or replace function kilo.enforce_collection_payload_bounds()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_payload jsonb := to_jsonb(new);
  v_field text;
begin
  -- 8 MiB is intentionally well above the app's 200k-character note contract,
  -- while making JSON amplification finite even when a client bypasses the UI.
  if pg_column_size(v_payload) > 8388608 then
    raise exception 'Collection row exceeds the 8 MiB payload limit.'
      using errcode = '22001';
  end if;

  foreach v_field in array array[
    'id', 'current_workout_note_id', 'workout_note_id',
    'baseline_note_id', 'block_id', 'note_id'
  ] loop
    if v_payload ? v_field
       and jsonb_typeof(v_payload -> v_field) = 'string'
       and char_length(v_payload ->> v_field) > 512 then
      raise exception 'Collection identifier exceeds 512 characters.'
        using errcode = '22001';
    end if;
  end loop;

  foreach v_field in array array['raw_text', 'current_deload_note_raw_text'] loop
    if v_payload ? v_field
       and jsonb_typeof(v_payload -> v_field) = 'string'
       and char_length(v_payload ->> v_field) > 200000 then
      raise exception 'Note text exceeds 200000 characters.'
        using errcode = '22001';
    end if;
  end loop;

  foreach v_field in array array['title', 'baseline_note_title'] loop
    if v_payload ? v_field
       and jsonb_typeof(v_payload -> v_field) = 'string'
       and char_length(v_payload ->> v_field) > 4096 then
      raise exception 'Collection title exceeds 4096 characters.'
        using errcode = '22001';
    end if;
  end loop;

  if v_payload ? 'display_name'
     and jsonb_typeof(v_payload -> 'display_name') = 'string'
     and char_length(v_payload ->> 'display_name') > 1024 then
    raise exception 'Display name exceeds 1024 characters.'
      using errcode = '22001';
  end if;

  if v_payload ? 'note'
     and jsonb_typeof(v_payload -> 'note') = 'string'
     and char_length(v_payload ->> 'note') > 65536 then
    raise exception 'Entry note exceeds 65536 characters.'
      using errcode = '22001';
  end if;

  foreach v_field in array array['unit_system', 'entry_type', 'status'] loop
    if v_payload ? v_field
       and jsonb_typeof(v_payload -> v_field) = 'string'
       and char_length(v_payload ->> v_field) > 128 then
      raise exception 'Collection enum-like text exceeds 128 characters.'
        using errcode = '22001';
    end if;
  end loop;

  return new;
end;
$$;

create or replace function kilo.apply_collection_storage_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_old_bytes bigint := 0;
  v_new_bytes bigint := 0;
  v_byte_delta bigint;
  v_row_delta bigint := 0;
  v_row_limit bigint;
  v_reserved boolean;
begin
  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    raise exception 'Collection ownership is immutable.' using errcode = '22023';
  end if;

  if tg_op <> 'INSERT' then
    v_old_bytes := pg_column_size(to_jsonb(old));
  end if;
  if tg_op <> 'DELETE' then
    v_new_bytes := pg_column_size(to_jsonb(new));
  end if;

  v_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  v_byte_delta := v_new_bytes - v_old_bytes;
  v_row_delta := case tg_op when 'INSERT' then 1 when 'DELETE' then -1 else 0 end;
  v_row_limit := case
    when tg_table_name in (
      'user_profile', 'feature_toggles', 'weight_goal', 'user_health_profile'
    ) then 1
    else 100000
  end;

  if tg_op = 'DELETE' then
    update kilo.account_storage_usage
       set total_bytes = greatest(0, total_bytes + v_byte_delta)
     where user_id = v_user_id;

    update kilo.collection_storage_usage
       set row_count = greatest(0, row_count + v_row_delta),
           total_bytes = greatest(0, total_bytes + v_byte_delta)
     where user_id = v_user_id and collection = tg_table_name;
    return old;
  end if;

  v_reserved := false;
  insert into kilo.account_storage_usage (user_id, total_bytes)
  values (v_user_id, v_new_bytes)
  on conflict (user_id) do update
    set total_bytes = kilo.account_storage_usage.total_bytes + v_byte_delta
    where kilo.account_storage_usage.total_bytes + v_byte_delta >= 0
      and (
        v_byte_delta <= 0
        or kilo.account_storage_usage.total_bytes + v_byte_delta <= 536870912
      )
  returning true into v_reserved;

  if not coalesce(v_reserved, false) then
    raise exception 'Account storage quota exceeded.' using errcode = '54000';
  end if;

  v_reserved := false;
  insert into kilo.collection_storage_usage (
    user_id, collection, row_count, total_bytes
  ) values (
    v_user_id, tg_table_name, v_row_delta, v_new_bytes
  )
  on conflict (user_id, collection) do update
    set row_count = kilo.collection_storage_usage.row_count + v_row_delta,
        total_bytes = kilo.collection_storage_usage.total_bytes + v_byte_delta
    where kilo.collection_storage_usage.row_count + v_row_delta >= 0
      and kilo.collection_storage_usage.total_bytes + v_byte_delta >= 0
      and (
        (v_row_delta <= 0 and v_byte_delta <= 0)
        or (
          kilo.collection_storage_usage.row_count + v_row_delta <= v_row_limit
          and kilo.collection_storage_usage.total_bytes + v_byte_delta <= 268435456
        )
      )
  returning true into v_reserved;

  if not coalesce(v_reserved, false) then
    raise exception 'Collection storage quota exceeded.' using errcode = '54000';
  end if;

  return new;
end;
$$;

revoke all on function kilo.apply_collection_storage_usage() from public, anon, authenticated;

do $$
declare
  v_table text;
  v_tables text[] := array[
    'user_profile',
    'feature_toggles',
    'weight_entries',
    'weight_goal',
    'workout_notes',
    'deload_history',
    'fatigue_checkins',
    'archived_weight_goals',
    'user_health_profile',
    'recovery_blocks',
    'recovery_block_weeks'
  ];
begin
  foreach v_table in array v_tables loop
    execute format(
      'create trigger enforce_collection_payload_bounds
         before insert or update on kilo.%I
         for each row execute function kilo.enforce_collection_payload_bounds()',
      v_table
    );
    execute format(
      'create trigger apply_collection_storage_usage
         after insert or update or delete on kilo.%I
         for each row execute function kilo.apply_collection_storage_usage()',
      v_table
    );
  end loop;
end;
$$;
