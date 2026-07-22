-- Commit-safe change-feed regression (issue #620).
--
-- This test is intentionally local-only. It uses dblink to create two real
-- PostgreSQL sessions against the disposable Supabase database:
--
--   A (reader) establishes a cursor and completes a pull while
--   B (writer) has already updated/stamped a row but has not committed.
--
-- B commits only after A returned its next cursor. A later pull from that exact
-- cursor must recover B's row. This is the transaction-start timestamp failure
-- that no fixed wall-clock lag can make safe.
--
-- Harness: pgTAP on disposable local Supabase only.
--   supabase test db supabase/tests/commit-safe-change-feed.test.sql

create extension if not exists dblink with schema extensions;

select plan(12);

select has_function(
  'kilo',
  'pull_sync_changes',
  array['text', 'text', 'text', 'timestamp with time zone', 'text', 'integer'],
  'the commit-safe pull RPC exists'
);

select col_type_is(
  'kilo', 'weight_entries', 'sync_xid', 'bigint',
  'synced rows record the writer xid as an internal bigint'
);

select extensions.dblink_connect(
  'reader_620',
  'host=host.docker.internal port=54322 dbname=' || current_database() ||
    ' user=postgres password=postgres'
);
select extensions.dblink_connect(
  'writer_620',
  'host=host.docker.internal port=54322 dbname=' || current_database() ||
    ' user=postgres password=postgres'
);

-- Seed committed fixtures outside the coordinator transaction so both test
-- sessions can see them. The foreign user proves SECURITY INVOKER + RLS owner
-- scope while the feed is exercised through the authenticated role.
select extensions.dblink_exec('writer_620', $setup$
  insert into auth.users (id, aud, role, email, encrypted_password)
  values
    ('62000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
      'issue-620-a@example.invalid', ''),
    ('62000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
      'issue-620-b@example.invalid', '')
  on conflict (id) do nothing;

  insert into kilo.weight_entries
    (user_id, id, entry_type, date, logged_at, weight_value, saved_at)
  values
    ('62000000-0000-0000-0000-000000000001', 'writer-row', 'weight', current_date,
      now(), 180, now()),
    ('62000000-0000-0000-0000-000000000002', 'foreign-row', 'weight', current_date,
      now(), 999, now())
  on conflict (user_id, id) do update set weight_value = excluded.weight_value;
$setup$);

select extensions.dblink_exec('reader_620', 'set role authenticated');
select extensions.dblink_exec(
  'reader_620',
  $$ set request.jwt.claim.sub = '62000000-0000-0000-0000-000000000001' $$
);
select extensions.dblink_exec(
  'reader_620',
  $$ set request.jwt.claims = '{"sub":"62000000-0000-0000-0000-000000000001","role":"authenticated"}' $$
);

create or replace function pg_temp.reader_pull_620(p_cursor text)
returns jsonb
language plpgsql
as $$
declare
  v_result text;
begin
  select result into v_result
  from extensions.dblink(
    'reader_620',
    format(
      'select kilo.pull_sync_changes(%L, %L, null, null, null, 1000)::text',
      'weight_entries', p_cursor
    )
  ) as pulled(result text);
  return v_result::jsonb;
end;
$$;

create temp table pull_620 (
  phase text primary key,
  result jsonb not null
);

insert into pull_620 values ('initial', pg_temp.reader_pull_620(null));

select is(
  jsonb_array_length((select result->'rows' from pull_620 where phase = 'initial')),
  1,
  'the initial feed is RLS-owner-scoped and excludes the foreign row'
);

select ok(
  (select result->>'cursor' from pull_620 where phase = 'initial') ~ '^xid:[0-9]+$',
  'the server returns an xid cursor rather than a client wall-clock boundary'
);

-- Session B receives both its server updated_at and sync_xid here, then remains
-- open. Session A's next RPC cannot see this uncommitted version.
select extensions.dblink_exec('writer_620', 'begin');
select extensions.dblink_exec('writer_620', 'set local role authenticated');
select extensions.dblink_exec(
  'writer_620',
  $$ set local request.jwt.claim.sub = '62000000-0000-0000-0000-000000000001' $$
);
select extensions.dblink_exec(
  'writer_620',
  $$ set local request.jwt.claims = '{"sub":"62000000-0000-0000-0000-000000000001","role":"authenticated"}' $$
);
select extensions.dblink_exec('writer_620', $update$
  update kilo.weight_entries
     set weight_value = 181
   where user_id = '62000000-0000-0000-0000-000000000001'
     and id = 'writer-row'
$update$);

create temp table writer_620 as
select xid::bigint
from extensions.dblink(
  'writer_620',
  $$ select sync_xid::text
       from kilo.weight_entries
      where user_id = '62000000-0000-0000-0000-000000000001'
        and id = 'writer-row' $$
) as stamped(xid text);

select ok(
  (select xid from writer_620) >=
    substring((select result->>'cursor' from pull_620 where phase = 'initial') from 5)::bigint,
  'the writer xid is at or beyond the previously completed pull boundary'
);

insert into pull_620
select 'during', pg_temp.reader_pull_620(
  (select result->>'cursor' from pull_620 where phase = 'initial')
);

select is(
  jsonb_array_length((select result->'rows' from pull_620 where phase = 'during')),
  0,
  'session A completes its pull while session B remains invisible'
);

select ok(
  substring((select result->>'cursor' from pull_620 where phase = 'during') from 5)::bigint
    <= (select xid from writer_620),
  'session A never advances past the still-open writer xid'
);

-- Commit only after A has returned its cursor, then prove the next pass recovers
-- the old-timestamp writer rather than stranding it behind that cursor.
select extensions.dblink_exec('writer_620', 'commit');

insert into pull_620
select 'later', pg_temp.reader_pull_620(
  (select result->>'cursor' from pull_620 where phase = 'during')
);

select is(
  jsonb_array_length((select result->'rows' from pull_620 where phase = 'later')),
  1,
  'a later pull recovers the writer that committed after the prior read'
);

select is(
  (select result->'rows'->0->>'id' from pull_620 where phase = 'later'),
  'writer-row',
  'the recovered change is the concurrently written row'
);

select is(
  (select (result->'rows'->0->>'weight_value')::numeric from pull_620 where phase = 'later'),
  181::numeric,
  'the recovered row carries the committed value'
);

select ok(
  substring((select result->>'cursor' from pull_620 where phase = 'later') from 5)::bigint
    > (select xid from writer_620),
  'the later completed boundary can advance beyond the committed writer'
);

select is(
  (select result->'rows'->0->>'__kilo_sync_xid' from pull_620 where phase = 'later'),
  (select xid::text from writer_620),
  'the feed carries exact internal xid evidence for reconciliation'
);

select extensions.dblink_exec('writer_620', 'reset role');
select extensions.dblink_exec('writer_620', $cleanup$
  delete from auth.users
   where id in (
     '62000000-0000-0000-0000-000000000001',
     '62000000-0000-0000-0000-000000000002'
   )
$cleanup$);
select extensions.dblink_disconnect('reader_620');
select extensions.dblink_disconnect('writer_620');

select * from finish();
