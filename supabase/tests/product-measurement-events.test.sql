-- Product measurement ingest tests (issue #670).
--
-- Covers kilo.product_measurement_events, kilo.record_product_measurement_event,
-- and kilo.sanitize_product_measurement_properties: only the allow-listed
-- shape may ever persist, unknown event names are rejected outright, unknown
-- or out-of-range fields are dropped, and neither anon nor authenticated can
-- read or write the table directly.
--
-- Run: psql "$DATABASE_URL" -f supabase/tests/product-measurement-events.test.sql
-- or:  supabase test db

begin;

select plan(22);

-- ---------------------------------------------------------------------------
-- record_product_measurement_event: unknown event name is rejected outright
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select kilo.record_product_measurement_event(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'unknown_event', '{}'::jsonb, 1000
  )$$,
  'unknown event name'
);

select is(
  (select count(*)::int from kilo.product_measurement_events
   where install_id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  0, 'nothing persisted for a rejected unknown event name'
);

-- ---------------------------------------------------------------------------
-- record_product_measurement_event: malformed install id is rejected
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select kilo.record_product_measurement_event(
    'not-a-valid-install-id', 'tab_viewed', '{"tab":"Home"}'::jsonb, 1000
  )$$,
  'invalid install id'
);

-- ---------------------------------------------------------------------------
-- record_product_measurement_event: allow-listed shape persists as sent
-- ---------------------------------------------------------------------------
select ok(
  kilo.record_product_measurement_event(
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'tab_viewed', '{"tab":"Log"}'::jsonb, 5000
  ),
  'well-formed tab_viewed event is admitted'
);

select is(
  (select properties from kilo.product_measurement_events
   where install_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  '{"tab":"Log"}'::jsonb,
  'persisted properties match the allow-listed shape exactly'
);

select is(
  (select client_recorded_at_ms from kilo.product_measurement_events
   where install_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  5000::bigint,
  'client-provided recorded-at timestamp is persisted'
);

-- ---------------------------------------------------------------------------
-- record_product_measurement_event: unknown/invalid fields are dropped, not
-- rejected — the event still records with only its valid subset.
-- ---------------------------------------------------------------------------
select ok(
  kilo.record_product_measurement_event(
    'cccccccccccccccccccccccccccccccc',
    'workout_save_completed',
    '{"ok": true, "duration_ms": 1234.6, "warning_count": 2, "raw_text": "bench 225x5", "email": "person@example.com"}'::jsonb,
    9000
  ),
  'partially valid workout_save_completed event is admitted'
);

select is(
  (select properties from kilo.product_measurement_events
   where install_id = 'cccccccccccccccccccccccccccccccc'),
  '{"ok": true, "duration_ms": 1235, "warning_count": 2}'::jsonb,
  'unknown fields (raw_text, email) dropped; duration_ms rounded'
);

-- ---------------------------------------------------------------------------
-- sanitize_product_measurement_properties: out-of-range values dropped
-- ---------------------------------------------------------------------------
select is(
  kilo.sanitize_product_measurement_properties(
    'workout_save_completed',
    '{"ok": "yes", "duration_ms": 99999999, "warning_count": -1}'::jsonb
  ),
  '{}'::jsonb,
  'wrong-typed/out-of-range values all dropped, leaving an empty object'
);

-- ---------------------------------------------------------------------------
-- sanitize_product_measurement_properties: unknown tab/section values dropped
-- ---------------------------------------------------------------------------
select is(
  kilo.sanitize_product_measurement_properties('tab_viewed', '{"tab": "Settings"}'::jsonb),
  '{}'::jsonb,
  'unlisted tab name is dropped'
);

select is(
  kilo.sanitize_product_measurement_properties('analytics_viewed', '{"section": "overview"}'::jsonb),
  '{"section": "overview"}'::jsonb,
  'listed analytics section is kept'
);

-- ---------------------------------------------------------------------------
-- record_product_measurement_event: attempted-events carry no properties
-- ---------------------------------------------------------------------------
select ok(
  kilo.record_product_measurement_event(
    'dddddddddddddddddddddddddddddddd',
    'workout_save_attempted',
    '{"anything": "goes here"}'::jsonb,
    1000
  ),
  'workout_save_attempted event is admitted regardless of extra properties'
);

select is(
  (select properties from kilo.product_measurement_events
   where install_id = 'dddddddddddddddddddddddddddddddd'),
  '{}'::jsonb,
  'workout_save_attempted persists no properties at all'
);

-- ---------------------------------------------------------------------------
-- record_product_measurement_event: per-install rate limit denies overflow
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from (
    select kilo.record_product_measurement_event(
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'weight_save_attempted', '{}'::jsonb, 1000
    ) as admitted
    from generate_series(1, 120)
  ) admits where admitted),
  120,
  'first 120 events for a single install within the window are admitted'
);

select is(
  kilo.record_product_measurement_event(
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'weight_save_attempted', '{}'::jsonb, 1000
  ),
  false,
  '121st event for the same install within the window is throttled, not persisted'
);

select is(
  (select count(*)::int from kilo.product_measurement_events
   where install_id = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
  120,
  'throttled event is not persisted'
);

-- ---------------------------------------------------------------------------
-- Table constraints: bad shapes are rejected at the table level too
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into kilo.product_measurement_events
    (install_id, event_name, properties, client_recorded_at_ms)
    values ('short', 'tab_viewed', '{}'::jsonb, 1000)$$,
  '23514',
  null,
  'malformed install id is rejected by the table check constraint'
);

select throws_ok(
  $$insert into kilo.product_measurement_events
    (install_id, event_name, properties, client_recorded_at_ms)
    values ('ffffffffffffffffffffffffffffffff', 'not_a_real_event', '{}'::jsonb, 1000)$$,
  '23514',
  null,
  'unknown event name is rejected by the table check constraint'
);

-- ---------------------------------------------------------------------------
-- RLS: neither anon nor authenticated can read or write the table directly
-- ---------------------------------------------------------------------------
select is(
  (select relrowsecurity from pg_class
   where oid = 'kilo.product_measurement_events'::regclass),
  true,
  'row level security is enabled on the table'
);

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'kilo' and tablename = 'product_measurement_events'),
  0,
  'no RLS policies exist — anon/authenticated have no direct access'
);

select is(
  has_function_privilege(
    'anon', 'kilo.record_product_measurement_event(text, text, jsonb, bigint)', 'execute'
  ),
  true,
  'anon can call the validated RPC (installs may be signed out)'
);

select is(
  has_table_privilege('anon', 'kilo.product_measurement_events', 'insert'),
  false,
  'anon has no direct insert privilege on the table'
);

select * from finish();

rollback;
