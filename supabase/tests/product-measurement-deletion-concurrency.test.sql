-- Product measurement: deletion vs. concurrent ingest race (issue #671).
--
-- product-measurement-deletion.test.sql proves the tombstone rejects an
-- ingest that STARTS after a deletion has already COMMITTED. It cannot prove
-- serialization of two transactions that overlap on an ALREADY-bound
-- installation: a plain (non-locking) read of revoked_at inside
-- record_product_measurement_event would let a concurrent deletion
-- delete-then-tombstone in between that read and the later insert, so an
-- already-admitted ingest could still resurrect a row.
--
-- This file uses dblink to open real, separate PostgreSQL sessions and prove
-- both RPCs actually block on the same install's binding row (FOR UPDATE)
-- under both possible commit orderings:
--
--   A: an in-flight second ingest commits first; a concurrent deletion,
--      blocked behind it, is unblocked and still sweeps up every event for
--      that install, including the one just committed.
--   B: an in-flight deletion transaction commits first; a concurrent second
--      ingest, blocked behind it, is unblocked and observes revocation
--      rather than resurrecting anything.
--
-- Scenarios A and B pre-establish the install/token binding OUTSIDE the
-- race, so there is always an existing binding row to FOR UPDATE. A row lock
-- cannot protect a row that does not exist yet, though: it cannot serialize
-- a deletion against a genuinely concurrent *first* ingest for a
-- still-unbound token. Scenarios C and D race a still-unbound token instead,
-- exercising kilo.product_measurement_revocations and the digest-derived
-- advisory lock both RPCs take before touching either table:
--
--   C: an in-flight deletion for a never-bound token commits first; a
--      concurrent first ingest for that same token, blocked behind it, is
--      unblocked and observes revocation instead of establishing a binding.
--   D: an in-flight first ingest commits first; a concurrent deletion for
--      that same (now just-bound) token, blocked behind it, is unblocked
--      and still sweeps up the event and tombstones the binding.
--
-- Harness: pgTAP on disposable local Supabase only.
--   supabase test db supabase/tests/product-measurement-deletion-concurrency.test.sql
--
-- This file manages its own connections/cleanup rather than relying on an
-- outer ROLLBACK: dblink sessions are independent connections whose commits
-- are not undone by rolling back the coordinating session. Each scenario
-- uses its own pair of connections (never reused across scenarios) so one
-- scenario's async dispatch/result-fetch bookkeeping can never leak into the
-- other's.

create extension if not exists dblink with schema extensions;

select plan(14);

-- Default to the Supabase CLI disposable stack, while allowing CI/local callers
-- to provide a separately generated database credential through PGOPTIONS GUCs.
create or replace function pg_temp.dblink_conninfo_671() returns text
language sql stable
as $$
  select format(
    'host=%s port=%s dbname=%s user=%s password=%s',
    coalesce(nullif(current_setting('kilo.test_db_host', true), ''), 'host.docker.internal'),
    coalesce(nullif(current_setting('kilo.test_db_port', true), ''), '54322'),
    current_database(),
    coalesce(nullif(current_setting('kilo.test_db_user', true), ''), 'postgres'),
    coalesce(nullif(current_setting('kilo.test_db_password', true), ''), 'postgres')
  )
$$;

-- Fetching an async dblink_send_query result via dblink_get_result raises
-- locally if the remote statement raised; capture the message instead of
-- aborting this file, and return the successful value as text otherwise.
create or replace function pg_temp.fetch_dblink_bool_671(p_conn text)
returns text
language plpgsql
as $$
declare
  v_result boolean;
begin
  select result into v_result from extensions.dblink_get_result(p_conn) as t(result boolean);
  return v_result::text;
exception when others then
  return sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scenario A: a second, in-flight ingest for an already-bound install
-- commits first; deletion, blocked behind it, still sweeps up every event
-- for that install once unblocked.
-- ---------------------------------------------------------------------------
select extensions.dblink_connect(
  'pm_a1_671',
  pg_temp.dblink_conninfo_671()
);
select extensions.dblink_connect(
  'pm_b1_671',
  pg_temp.dblink_conninfo_671()
);

-- Establish the binding and a first event OUTSIDE the race, committed
-- immediately (this coordinator session runs in autocommit).
select kilo.record_product_measurement_event(
  'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1',
  'tab_viewed', '{"tab":"Home"}'::jsonb, 1000
);

-- dblink_exec rejects statements that return rows, so the boolean-returning
-- RPC call is wrapped in a DO block (PERFORM discards the result) purely to
-- satisfy that constraint — the call itself, and the FOR UPDATE lock it
-- takes on the already-existing binding row, are unchanged.
select extensions.dblink_exec('pm_a1_671', 'begin');
select extensions.dblink_exec('pm_a1_671', $ingest$
  do $do$ begin
    perform kilo.record_product_measurement_event(
      'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1',
      'tab_viewed', '{"tab":"Home"}'::jsonb, 2000
    );
  end $do$;
$ingest$);

-- Dispatched asynchronously: with session A's transaction still open and
-- holding the row lock, this must block rather than run to completion.
select extensions.dblink_send_query('pm_b1_671', $delete$
  select kilo.delete_product_measurement_install('b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1')
$delete$);

select ok(
  extensions.dblink_is_busy('pm_b1_671') = 1,
  'scenario A: the concurrent deletion is genuinely blocked behind the open second-ingest transaction'
);

-- Release session A's lock; its second event becomes durable.
select extensions.dblink_exec('pm_a1_671', 'commit');

select is(
  pg_temp.fetch_dblink_bool_671('pm_b1_671'),
  'true',
  'scenario A: the deletion completes successfully once unblocked'
);

select is(
  (select count(*)::int from kilo.product_measurement_events
   where install_id = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'),
  0,
  'scenario A: deletion sweeps up every event, including the one the concurrent ingest had just committed'
);

select extensions.dblink_disconnect('pm_a1_671');
select extensions.dblink_disconnect('pm_b1_671');

-- ---------------------------------------------------------------------------
-- Scenario B: an in-flight deletion commits first; a concurrent second
-- ingest, blocked behind it, is unblocked and observes revocation rather
-- than resurrecting anything.
-- ---------------------------------------------------------------------------
select extensions.dblink_connect(
  'pm_a2_671',
  pg_temp.dblink_conninfo_671()
);
select extensions.dblink_connect(
  'pm_b2_671',
  pg_temp.dblink_conninfo_671()
);

-- Establish the binding and a first event OUTSIDE the race.
select kilo.record_product_measurement_event(
  'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1', 'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1',
  'tab_viewed', '{"tab":"Home"}'::jsonb, 1000
);

select extensions.dblink_exec('pm_b2_671', 'begin');
select extensions.dblink_exec('pm_b2_671', $delete2$
  do $do$ begin
    perform kilo.delete_product_measurement_install('d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1');
  end $do$;
$delete2$);

-- Dispatched asynchronously: with session B's transaction still open and
-- holding the row lock, this must block rather than run to completion.
select extensions.dblink_send_query('pm_a2_671', $ingest2$
  select kilo.record_product_measurement_event(
    'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1', 'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1',
    'tab_viewed', '{"tab":"Home"}'::jsonb, 2000
  )
$ingest2$);

select ok(
  extensions.dblink_is_busy('pm_a2_671') = 1,
  'scenario B: the concurrent second ingest is genuinely blocked behind the open deletion transaction'
);

-- Release session B's lock; the deletion (events removed, tombstone set)
-- becomes durable.
select extensions.dblink_exec('pm_b2_671', 'commit');

select is(
  pg_temp.fetch_dblink_bool_671('pm_a2_671'),
  'installation has been revoked',
  'scenario B: the blocked ingest is rejected once unblocked, not silently admitted'
);

select is(
  (select count(*)::int from kilo.product_measurement_events
   where install_id = 'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1'),
  0,
  'scenario B: no event survives from the losing ingest'
);

select extensions.dblink_disconnect('pm_a2_671');
select extensions.dblink_disconnect('pm_b2_671');

-- ---------------------------------------------------------------------------
-- Scenario C: an in-flight deletion for a NEVER-bound token commits first; a
-- concurrent first ingest for that exact token, blocked behind it, is
-- unblocked and observes revocation instead of establishing a binding. There
-- is no product_measurement_installs row for FOR UPDATE to lock here — only
-- the digest-derived advisory lock (acquired by both RPCs before either
-- touches product_measurement_installs or product_measurement_revocations)
-- can serialize this.
-- ---------------------------------------------------------------------------
select extensions.dblink_connect(
  'pm_c1_671',
  pg_temp.dblink_conninfo_671()
);
select extensions.dblink_connect(
  'pm_c2_671',
  pg_temp.dblink_conninfo_671()
);

-- No prior ingest at all: this token has never been bound to any install.
select extensions.dblink_exec('pm_c1_671', 'begin');
select extensions.dblink_exec('pm_c1_671', $delete3$
  do $do$ begin
    perform kilo.delete_product_measurement_install('e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1');
  end $do$;
$delete3$);

-- Dispatched asynchronously: with session C1's transaction still open and
-- holding the digest's advisory lock, this must block rather than run to
-- completion, even though no binding row exists for it to FOR UPDATE.
select extensions.dblink_send_query('pm_c2_671', $ingest3$
  select kilo.record_product_measurement_event(
    'f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1', 'e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1',
    'tab_viewed', '{"tab":"Home"}'::jsonb, 1000
  )
$ingest3$);

select ok(
  extensions.dblink_is_busy('pm_c2_671') = 1,
  'scenario C: the concurrent first ingest for a never-bound token is genuinely blocked behind the open deletion'
);

-- Release session C1's lock; the revocation record becomes durable.
select extensions.dblink_exec('pm_c1_671', 'commit');

select is(
  pg_temp.fetch_dblink_bool_671('pm_c2_671'),
  'installation has been revoked',
  'scenario C: the blocked first ingest is rejected once unblocked, not silently admitted'
);

select is(
  (select count(*)::int from kilo.product_measurement_installs
   where install_id = 'f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1'),
  0,
  'scenario C: no binding is established for the losing first ingest'
);

select is(
  (select count(*)::int from kilo.product_measurement_events
   where install_id = 'f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1'),
  0,
  'scenario C: no event is persisted for the losing first ingest'
);

select extensions.dblink_disconnect('pm_c1_671');
select extensions.dblink_disconnect('pm_c2_671');

-- ---------------------------------------------------------------------------
-- Scenario D: an in-flight FIRST ingest (still-unbound token) commits first;
-- a concurrent deletion for that same token, blocked behind it, is unblocked
-- and still sweeps up the event and tombstones the binding it just missed
-- racing to prevent. The inverse of scenario C: here the advisory lock lets
-- the first ingest establish its binding before deletion can act on it.
-- ---------------------------------------------------------------------------
select extensions.dblink_connect(
  'pm_d1_671',
  pg_temp.dblink_conninfo_671()
);
select extensions.dblink_connect(
  'pm_d2_671',
  pg_temp.dblink_conninfo_671()
);

select extensions.dblink_exec('pm_d1_671', 'begin');
select extensions.dblink_exec('pm_d1_671', $ingest4$
  do $do$ begin
    perform kilo.record_product_measurement_event(
      'f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2', 'e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2',
      'tab_viewed', '{"tab":"Home"}'::jsonb, 1000
    );
  end $do$;
$ingest4$);

-- Dispatched asynchronously: with session D1's transaction still open and
-- holding the digest's advisory lock, this must block rather than run to
-- completion.
select extensions.dblink_send_query('pm_d2_671', $delete4$
  select kilo.delete_product_measurement_install('e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2')
$delete4$);

select ok(
  extensions.dblink_is_busy('pm_d2_671') = 1,
  'scenario D: the concurrent deletion for the still-racing token is genuinely blocked behind the open first ingest'
);

-- Release session D1's lock; the fresh binding and its event become durable.
select extensions.dblink_exec('pm_d1_671', 'commit');

select is(
  pg_temp.fetch_dblink_bool_671('pm_d2_671'),
  'true',
  'scenario D: the deletion completes successfully once unblocked'
);

select is(
  (select count(*)::int from kilo.product_measurement_events
   where install_id = 'f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2'),
  0,
  'scenario D: the event the first ingest had just committed does not survive'
);

select ok(
  (select revoked_at from kilo.product_measurement_installs
   where install_id = 'f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2') is not null,
  'scenario D: the binding the first ingest just established is tombstoned, not left active'
);

select extensions.dblink_disconnect('pm_d1_671');
select extensions.dblink_disconnect('pm_d2_671');

-- ---------------------------------------------------------------------------
-- Cleanup: explicit, since dblink commits are independent of this session.
-- ---------------------------------------------------------------------------
delete from kilo.product_measurement_events
 where install_id in (
   'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1',
   'f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1', 'f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2'
 );
delete from kilo.product_measurement_installs
 where install_id in (
   'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1',
   'f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1', 'f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2'
 );
delete from kilo.product_measurement_revocations
 where deletion_token_digest in (
   encode(sha256(convert_to('e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1', 'UTF8')), 'hex'),
   encode(sha256(convert_to('e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2', 'UTF8')), 'hex')
 );

select * from finish();
