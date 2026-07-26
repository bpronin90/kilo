-- Product measurement: server-side deletion on opt-out (issue #671).
--
-- Covers kilo.product_measurement_installs, the token-aware
-- kilo.record_product_measurement_event(text, text, text, jsonb, bigint),
-- and kilo.delete_product_measurement_install: one-to-one install/token
-- binding, token-only scoped deletion, cross-install isolation, idempotent
-- non-enumerating behavior, removal of the old tokenless ingest overload,
-- RLS/direct-access denial, and function grants/search_path.
--
-- Run: psql "$DATABASE_URL" -f supabase/tests/product-measurement-deletion.test.sql
-- or:  supabase test db

begin;

select plan(38);

-- ---------------------------------------------------------------------------
-- record_product_measurement_event: format validation, in order
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select kilo.record_product_measurement_event(
    'not-a-valid-install-id', '11111111111111111111111111111111'::text, 'tab_viewed', '{"tab":"Home"}'::jsonb, 1000
  )$$,
  'invalid install id'
);

select throws_ok(
  $$select kilo.record_product_measurement_event(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'not-a-valid-token', 'tab_viewed', '{"tab":"Home"}'::jsonb, 1000
  )$$,
  'invalid deletion token'
);

select throws_ok(
  $$select kilo.record_product_measurement_event(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '11111111111111111111111111111111', 'unknown_event', '{}'::jsonb, 1000
  )$$,
  'unknown event name'
);

select is(
  (select count(*)::int from kilo.product_measurement_events
   where install_id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  0, 'nothing persisted for any rejected call'
);

select is(
  (select count(*)::int from kilo.product_measurement_installs
   where install_id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  0, 'no binding established by any rejected call'
);

-- ---------------------------------------------------------------------------
-- record_product_measurement_event: first accepted ingest binds install to
-- the digest of its deletion token, never the raw token.
-- ---------------------------------------------------------------------------
select ok(
  kilo.record_product_measurement_event(
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '22222222222222222222222222222222',
    'tab_viewed', '{"tab":"Log"}'::jsonb, 5000
  ),
  'well-formed first ingest for an install is admitted'
);

select is(
  (select properties from kilo.product_measurement_events
   where install_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  '{"tab":"Log"}'::jsonb,
  'persisted properties match the allow-listed shape exactly'
);

select is(
  (select deletion_token_digest from kilo.product_measurement_installs
   where install_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  encode(sha256(convert_to('22222222222222222222222222222222', 'UTF8')), 'hex'),
  'binding stores only the one-way digest of the deletion token'
);

select isnt(
  (select deletion_token_digest from kilo.product_measurement_installs
   where install_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  '22222222222222222222222222222222',
  'the raw deletion token itself is never stored'
);

-- ---------------------------------------------------------------------------
-- record_product_measurement_event: same install + same token ingests again
-- without re-raising a binding error.
-- ---------------------------------------------------------------------------
select ok(
  kilo.record_product_measurement_event(
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '22222222222222222222222222222222',
    'weight_save_attempted', '{}'::jsonb, 6000
  ),
  'second ingest for the same install with the same token succeeds'
);

select is(
  (select count(*)::int from kilo.product_measurement_events
   where install_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  2, 'both events for the bound install are persisted'
);

-- ---------------------------------------------------------------------------
-- record_product_measurement_event: one-to-one binding, both directions
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select kilo.record_product_measurement_event(
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '33333333333333333333333333333333',
    'tab_viewed', '{"tab":"Home"}'::jsonb, 7000
  )$$,
  'install is bound to a different deletion token'
);

select throws_ok(
  $$select kilo.record_product_measurement_event(
    'cccccccccccccccccccccccccccccccc', '22222222222222222222222222222222',
    'tab_viewed', '{"tab":"Home"}'::jsonb, 7000
  )$$,
  'deletion token already bound to a different installation'
);

select is(
  (select count(*)::int from kilo.product_measurement_events
   where install_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  2, 'rebind attempt persists no additional event'
);

select is(
  (select count(*)::int from kilo.product_measurement_installs
   where install_id = 'cccccccccccccccccccccccccccccccc'),
  0, 'cross-install token reuse establishes no new binding'
);

-- ---------------------------------------------------------------------------
-- delete_product_measurement_install: malformed token is rejected, deletes
-- nothing.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select kilo.delete_product_measurement_install('not-a-valid-token')$$,
  'invalid deletion token'
);

select is(
  (select count(*)::int from kilo.product_measurement_events
   where install_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  2, 'malformed-token delete attempt leaves existing rows untouched'
);

-- ---------------------------------------------------------------------------
-- delete_product_measurement_install: well-formed but unbound token is a
-- non-revealing idempotent no-op.
-- ---------------------------------------------------------------------------
select ok(
  kilo.delete_product_measurement_install('99999999999999999999999999999999'),
  'a well-formed but never-bound token still returns the success result'
);

-- ---------------------------------------------------------------------------
-- delete_product_measurement_install: correct token deletes only its bound
-- installation's events and binding, leaving other installs untouched.
-- ---------------------------------------------------------------------------
select ok(
  kilo.record_product_measurement_event(
    'dddddddddddddddddddddddddddddddd', '44444444444444444444444444444444',
    'tab_viewed', '{"tab":"Weight"}'::jsonb, 8000
  ),
  'unrelated install used as an isolation control is admitted'
);

select ok(
  kilo.delete_product_measurement_install('22222222222222222222222222222222'),
  'deleting with the correct bound token succeeds'
);

select is(
  (select count(*)::int from kilo.product_measurement_events
   where install_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  0, 'the bound installation''s events are gone'
);

select is(
  (select count(*)::int from kilo.product_measurement_installs
   where install_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  1, 'the bound installation''s binding row survives as a tombstone, not deleted'
);

select ok(
  (select revoked_at from kilo.product_measurement_installs
   where install_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') is not null,
  'the tombstone records a revocation timestamp'
);

select is(
  (select count(*)::int from kilo.product_measurement_events
   where install_id = 'dddddddddddddddddddddddddddddddd'),
  1, 'an unrelated installation''s events are untouched'
);

-- ---------------------------------------------------------------------------
-- record_product_measurement_event: a late in-flight ingest that reaches the
-- server after deletion committed (e.g. a flush that read the install id and
-- token before local opt-out cleared them) must not resurrect the revoked
-- installation's data. This is the tombstone's reason for existing: without
-- it, the ingest function would see no binding and recreate one.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select kilo.record_product_measurement_event(
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '22222222222222222222222222222222',
    'tab_viewed', '{"tab":"Home"}'::jsonb, 9000
  )$$,
  'installation has been revoked'
);

select is(
  (select count(*)::int from kilo.product_measurement_events
   where install_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  0, 'the late in-flight ingest does not resurrect any event for the revoked install'
);

-- ---------------------------------------------------------------------------
-- record_product_measurement_event: the revoked token's digest stays
-- permanently reserved — a different install id still cannot claim it.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select kilo.record_product_measurement_event(
    'ffffffffffffffffffffffffffffffff', '22222222222222222222222222222222',
    'tab_viewed', '{"tab":"Home"}'::jsonb, 9000
  )$$,
  'deletion token already bound to a different installation'
);

select is(
  (select count(*)::int from kilo.product_measurement_installs
   where install_id = 'ffffffffffffffffffffffffffffffff'),
  0, 'a revoked token''s digest cannot be claimed by a new installation either'
);

-- ---------------------------------------------------------------------------
-- delete_product_measurement_install: repeating deletion with the
-- already-revoked token is safe and returns the same non-revealing success.
-- ---------------------------------------------------------------------------
select ok(
  kilo.delete_product_measurement_install('22222222222222222222222222222222'),
  'repeating deletion with an already-used token is idempotent'
);

-- ---------------------------------------------------------------------------
-- The old tokenless overload is gone; the token-aware signature is the only
-- ingest RPC.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc
   where pronamespace = 'kilo'::regnamespace
     and proname = 'record_product_measurement_event'
     and pg_get_function_identity_arguments(oid) = 'p_install_id text, p_event_name text, p_properties jsonb, p_client_recorded_at_ms bigint'),
  0,
  'the old tokenless ingest overload no longer exists'
);

select has_function(
  'kilo', 'record_product_measurement_event',
  array['text', 'text', 'text', 'jsonb', 'bigint'],
  'the token-aware ingest RPC exists'
);

-- ---------------------------------------------------------------------------
-- RLS: neither anon nor authenticated can read or write the installs table
-- directly; both can call the RPCs.
-- ---------------------------------------------------------------------------
select is(
  (select relrowsecurity from pg_class
   where oid = 'kilo.product_measurement_installs'::regclass),
  true,
  'row level security is enabled on the installs table'
);

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'kilo' and tablename = 'product_measurement_installs'),
  0,
  'no RLS policies exist on the installs table'
);

select is(
  has_table_privilege('anon', 'kilo.product_measurement_installs', 'select'),
  false,
  'anon has no direct read privilege on the installs table'
);

select is(
  has_function_privilege('anon', 'kilo.delete_product_measurement_install(text)', 'execute'),
  true,
  'anon can call the deletion RPC (installs may be signed out)'
);

-- ---------------------------------------------------------------------------
-- Security posture: SECURITY DEFINER with a fixed safe search_path.
-- ---------------------------------------------------------------------------
select is(
  (select prosecdef from pg_proc
   where oid = 'kilo.delete_product_measurement_install(text)'::regprocedure),
  true,
  'deletion RPC is SECURITY DEFINER'
);

select is(
  (select proconfig from pg_proc
   where oid = 'kilo.delete_product_measurement_install(text)'::regprocedure),
  array['search_path=kilo, pg_temp'],
  'deletion RPC pins a fixed safe search_path'
);

-- ---------------------------------------------------------------------------
-- All new objects live in the kilo schema.
-- ---------------------------------------------------------------------------
select is(
  (select nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.oid = 'kilo.product_measurement_installs'::regclass),
  'kilo',
  'the installs table lives in the kilo schema'
);

select * from finish();

rollback;
