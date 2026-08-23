-- Optional "why this recovery block started" reason (issue #872).
--
-- One nullable text column on kilo.recovery_blocks, plus a length bound in the
-- shared payload-bounds trigger. Everything else about the collection is
-- deliberately unchanged: the same owner-first primary key, the same
-- consent-gated RLS policies, the same server-authoritative
-- `updated_at`/`sync_xid` trigger, the same partial unique indexes, and the same
-- entry in the commit-safe pull feed's allowlist.
--
-- WHY NOTHING ELSE MOVES:
--
--   * kilo.pull_sync_changes serializes each row with `to_jsonb(t)`, so the new
--     column joins the pull feed the moment it exists — no function change, and
--     no version of the client that predates it can be broken by an extra key
--     (the client merges whole records and writes back what it received).
--   * Every existing row keeps `reason is null`, which is the same value a block
--     started without an explanation gets today. A legacy row and a deliberately
--     reason-less one are indistinguishable, which is correct: neither has one.
--   * The column is nullable with NO default, so a client that pushes an upsert
--     without it still writes a valid row. A build predating this issue omits
--     `reason` from its push whitelist entirely, so the column never appears in
--     the statement's SET list and an existing server-side reason is left
--     untouched rather than cleared — an old device can carry a reason it does
--     not understand through a full pull/push round trip without erasing it.
--   * This is health-adjacent free text on an already Art. 9-gated table, so it
--     inherits the existing ownership-AND-consent policies unchanged. It adds no
--     new surface and therefore no new consent material version.

alter table kilo.recovery_blocks
  add column if not exists reason text;

comment on column kilo.recovery_blocks.reason is
  'Optional user-written reason a recovery block was started (issue #872). Opaque free text: the server never parses, classifies, or derives anything from it, and it takes no part in membership, comparison, or analytics semantics. NULL means no reason was given, including for every row that predates this column.';

-- ---------------------------------------------------------------------------
-- Payload bound for the new column
-- ---------------------------------------------------------------------------
--
-- Re-declares kilo.enforce_collection_payload_bounds() from 20260811022002 with
-- one added clause, so a direct authenticated write cannot use the new column as
-- an unbounded text surface. The rest of the body is carried forward verbatim;
-- the triggers installed by that migration already point at this function name,
-- so replacing the function is the whole change.
--
-- The 4096-character bound is a server abuse bound, not the product rule: the
-- client normalizes a reason to 280 characters (see
-- lib/data/recoveryBlocks.normalizeRecoveryReason). Bounding the server more
-- loosely than the client is deliberate and matches how `title` is handled — a
-- server limit exists to keep a bypassed UI finite, while the shorter client cap
-- is what keeps the field a caption rather than a journal.
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

  -- Issue #872. Same shape and same bound as a title: short, user-written,
  -- never interpreted.
  if v_payload ? 'reason'
     and jsonb_typeof(v_payload -> 'reason') = 'string'
     and char_length(v_payload ->> 'reason') > 4096 then
    raise exception 'Recovery block reason exceeds 4096 characters.'
      using errcode = '22001';
  end if;

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
