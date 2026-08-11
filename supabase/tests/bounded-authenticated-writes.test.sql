-- Database-enforced authenticated write bounds and quota serialization (#796).
-- Disposable database only: the dblink sessions commit independently and the
-- fixed fixture account is explicitly removed at the end.

create extension if not exists dblink with schema extensions;

select plan(25);

\set user_id '79600000-0000-0000-0000-000000000001'

select has_table('kilo', 'account_storage_usage', 'account usage ledger exists');
select has_table('kilo', 'collection_storage_usage', 'collection usage ledger exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'kilo.account_storage_usage'::regclass),
  'account usage ledger has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'kilo.collection_storage_usage'::regclass),
  'collection usage ledger has RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'kilo.account_storage_usage', 'select'),
  'authenticated cannot read account quota state'
);
select ok(
  not has_table_privilege('authenticated', 'kilo.collection_storage_usage', 'select'),
  'authenticated cannot read collection quota state'
);
select ok(
  has_table_privilege('service_role', 'kilo.account_storage_usage', 'select'),
  'service_role has read-only operational visibility into account quota state'
);

select ok(
  (select prosecdef from pg_proc
    where oid = 'kilo.apply_collection_storage_usage()'::regprocedure),
  'quota trigger function is SECURITY DEFINER'
);
select is(
  (select proconfig from pg_proc
    where oid = 'kilo.apply_collection_storage_usage()'::regprocedure),
  array['search_path=""'],
  'quota trigger function has an empty fixed search_path'
);
select ok(
  not has_function_privilege(
    'authenticated', 'kilo.apply_collection_storage_usage()', 'execute'
  ),
  'authenticated cannot invoke the privileged quota function directly'
);

select is(
  (select count(*)::integer
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kilo'
      and c.relname = any (array[
        'user_profile', 'feature_toggles', 'weight_entries', 'weight_goal',
        'workout_notes', 'deload_history', 'fatigue_checkins',
        'archived_weight_goals', 'user_health_profile', 'recovery_blocks',
        'recovery_block_weeks'
      ])
      and t.tgname in (
        'enforce_collection_payload_bounds', 'apply_collection_storage_usage'
      )
      and not t.tgisinternal),
  22,
  'both database bounds triggers cover every authenticated-writable collection'
);

-- Commit fixtures so independent dblink sessions can participate in the race.
delete from auth.users where id = :'user_id'::uuid;
create temp table config_796 as
select mode from kilo.health_sync_config where id = true;
update kilo.health_sync_config set mode = 'legacy' where id = true;
insert into auth.users (id) values (:'user_id'::uuid);

create or replace function pg_temp.as_user_796(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, false);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text,
    false
  );
  execute 'set role authenticated';
end;
$$;

select pg_temp.as_user_796(:'user_id'::uuid);

select lives_ok(
  format(
    'insert into kilo.workout_notes (user_id, id, raw_text) values (%L, %L, %L)',
    :'user_id', 'base', 'short note'
  ),
  'an in-contract authenticated write succeeds'
);

reset role;

select is(
  (select row_count from kilo.collection_storage_usage
    where user_id = :'user_id'::uuid and collection = 'workout_notes'),
  1::bigint,
  'the collection row counter records a successful insert'
);
select is(
  (select total_bytes from kilo.collection_storage_usage
    where user_id = :'user_id'::uuid and collection = 'workout_notes'),
  (select pg_column_size(to_jsonb(t))::bigint from kilo.workout_notes t
    where user_id = :'user_id'::uuid and id = 'base'),
  'the collection byte counter matches the stored logical row'
);
select is(
  (select total_bytes from kilo.account_storage_usage
    where user_id = :'user_id'::uuid),
  (select pg_column_size(to_jsonb(t))::bigint from kilo.workout_notes t
    where user_id = :'user_id'::uuid and id = 'base'),
  'the account byte counter matches the stored logical row'
);

select pg_temp.as_user_796(:'user_id'::uuid);

select throws_ok(
  format(
    'insert into kilo.workout_notes (user_id, id) values (%L, %L)',
    :'user_id', repeat('i', 513)
  ),
  '22001', null,
  'an oversized collection identifier is rejected by the database'
);
select throws_ok(
  format(
    'insert into kilo.workout_notes (user_id, id, raw_text) values (%L, %L, %L)',
    :'user_id', 'oversized-note', repeat('n', 200001)
  ),
  '22001', null,
  'note text above the parser contract is rejected by the database'
);

reset role;

update kilo.collection_storage_usage
   set row_count = 100000
 where user_id = :'user_id'::uuid and collection = 'workout_notes';

select pg_temp.as_user_796(:'user_id'::uuid);
select throws_ok(
  format(
    'insert into kilo.workout_notes (user_id, id) values (%L, %L)',
    :'user_id', 'over-row-quota'
  ),
  '54000', 'Collection storage quota exceeded.',
  'the per-collection row quota is database-enforced'
);
reset role;
select is(
  (select count(*)::integer from kilo.workout_notes
    where user_id = :'user_id'::uuid and id = 'over-row-quota'),
  0,
  'a rejected collection-quota write leaves no row behind'
);

update kilo.collection_storage_usage
   set row_count = 1
 where user_id = :'user_id'::uuid and collection = 'workout_notes';
update kilo.account_storage_usage
   set total_bytes = 536870912
 where user_id = :'user_id'::uuid;

select pg_temp.as_user_796(:'user_id'::uuid);
select throws_ok(
  format(
    'insert into kilo.workout_notes (user_id, id) values (%L, %L)',
    :'user_id', 'over-account-quota'
  ),
  '54000', 'Account storage quota exceeded.',
  'the aggregate account byte quota is database-enforced'
);
reset role;
select is(
  (select count(*)::integer from kilo.workout_notes
    where user_id = :'user_id'::uuid and id = 'over-account-quota'),
  0,
  'a rejected account-quota write leaves no row behind'
);

-- Put the ledger one row below its limit. Two concurrent authenticated inserts
-- race for the last slot; the account ledger row serializes them, so exactly one
-- commits and the other receives the quota error.
update kilo.account_storage_usage
   set total_bytes = (
     select pg_column_size(to_jsonb(t))::bigint
       from kilo.workout_notes t
      where user_id = :'user_id'::uuid and id = 'base'
   )
 where user_id = :'user_id'::uuid;
update kilo.collection_storage_usage
   set row_count = 99999,
       total_bytes = (
         select pg_column_size(to_jsonb(t))::bigint
           from kilo.workout_notes t
          where user_id = :'user_id'::uuid and id = 'base'
       )
 where user_id = :'user_id'::uuid and collection = 'workout_notes';

create or replace function pg_temp.dblink_conninfo_796() returns text
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

select extensions.dblink_connect('quota_a_796', pg_temp.dblink_conninfo_796());
select extensions.dblink_connect('quota_b_796', pg_temp.dblink_conninfo_796());

select extensions.dblink_exec('quota_a_796', 'begin');
select extensions.dblink_exec('quota_a_796', 'set local role authenticated');
select extensions.dblink_exec(
  'quota_a_796',
  format('set local request.jwt.claim.sub = %L', :'user_id')
);
select extensions.dblink_exec(
  'quota_a_796',
  format(
    'set local request.jwt.claims = %L',
    json_build_object('sub', :'user_id', 'role', 'authenticated')::text
  )
);
select extensions.dblink_exec(
  'quota_a_796',
  format(
    'insert into kilo.workout_notes (user_id, id) values (%L, %L)',
    :'user_id', 'quota-winner'
  )
);

select extensions.dblink_exec('quota_b_796', 'begin');
select extensions.dblink_exec('quota_b_796', 'set local role authenticated');
select extensions.dblink_exec(
  'quota_b_796',
  format('set local request.jwt.claim.sub = %L', :'user_id')
);
select extensions.dblink_exec(
  'quota_b_796',
  format(
    'set local request.jwt.claims = %L',
    json_build_object('sub', :'user_id', 'role', 'authenticated')::text
  )
);
select extensions.dblink_send_query(
  'quota_b_796',
  format(
    'insert into kilo.workout_notes (user_id, id) values (%L, %L)',
    :'user_id', 'quota-loser'
  )
);

select ok(
  extensions.dblink_is_busy('quota_b_796') = 1,
  'a concurrent quota reservation blocks behind the account ledger row'
);

select extensions.dblink_exec('quota_a_796', 'commit');

create or replace function pg_temp.fetch_quota_result_796() returns text
language plpgsql as $$
begin
  perform * from extensions.dblink_get_result('quota_b_796') as t(status text);
  return 'completed';
exception when others then
  return sqlerrm;
end;
$$;

select is(
  pg_temp.fetch_quota_result_796(),
  'Collection storage quota exceeded.',
  'the losing concurrent insert is rejected after serialization'
);
select is(
  (select count(*)::integer from kilo.workout_notes
    where user_id = :'user_id'::uuid
      and id in ('quota-winner', 'quota-loser')),
  1,
  'exactly one concurrent insert obtains the final collection slot'
);

select extensions.dblink_disconnect('quota_a_796');
select extensions.dblink_disconnect('quota_b_796');

delete from auth.users where id = :'user_id'::uuid;
update kilo.health_sync_config
   set mode = (select mode from config_796)
 where id = true;

select is(
  (select count(*)::integer from kilo.account_storage_usage
    where user_id = :'user_id'::uuid),
  0,
  'account deletion cascades private quota state'
);

select * from finish();
