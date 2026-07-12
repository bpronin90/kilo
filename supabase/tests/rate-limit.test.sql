-- Durable rate-limiter SQL layer tests (issue #451).
--
-- Covers kilo.rate_limit_check and kilo.rate_limit_global_prune now that
-- throttle state is backed by Postgres (not in-memory per-isolate Maps).
-- The clientIp() rightmost-XFF fix lives in TypeScript and is verified via
-- manual edge testing documented on issue #451.
--
-- Run: psql "$DATABASE_URL" -f supabase/tests/rate-limit.test.sql
-- or:  supabase test db

begin;

select plan(10);

-- ---------------------------------------------------------------------------
-- rate_limit_check: requests within limit are admitted
-- ---------------------------------------------------------------------------
select ok(
  kilo.rate_limit_check('test:ip:1.2.3.4', 3, 600000),
  'check admits first request'
);
select ok(
  kilo.rate_limit_check('test:ip:1.2.3.4', 3, 600000),
  'check admits second request'
);
select ok(
  kilo.rate_limit_check('test:ip:1.2.3.4', 3, 600000),
  'check admits third request (at limit)'
);

-- ---------------------------------------------------------------------------
-- rate_limit_check: request at max+1 is denied
-- ---------------------------------------------------------------------------
select is(
  kilo.rate_limit_check('test:ip:1.2.3.4', 3, 600000),
  false,
  'check denies fourth request (over limit)'
);

-- ---------------------------------------------------------------------------
-- rate_limit_check: different buckets are independent
-- ---------------------------------------------------------------------------
select ok(
  kilo.rate_limit_check('test:ip:5.6.7.8', 3, 600000),
  'second bucket is independent — first request admitted'
);
select ok(
  kilo.rate_limit_check('test:user:uuid-a', 3, 600000),
  'user bucket is independent of IP bucket — first request admitted'
);

-- ---------------------------------------------------------------------------
-- rate_limit_check: hit count matches expected rows after admits
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from kilo.rate_limit_hits
   where bucket = 'test:ip:1.2.3.4'),
  3,
  'three hits recorded for the throttled bucket'
);

-- ---------------------------------------------------------------------------
-- rate_limit_global_prune: removes only expired rows, leaves live ones
-- ---------------------------------------------------------------------------

-- Insert a synthetic expired row (older than the 2-hour prune horizon).
insert into kilo.rate_limit_hits (bucket, occurred_at)
values ('test:ip:expired', now() - interval '3 hours');

select is(
  (select count(*)::int from kilo.rate_limit_hits where bucket = 'test:ip:expired'),
  1,
  'expired row present before prune'
);

select kilo.rate_limit_global_prune();

select is(
  (select count(*)::int from kilo.rate_limit_hits where bucket = 'test:ip:expired'),
  0,
  'global prune removed expired row'
);

-- Live rows for the limited bucket must survive the prune.
select is(
  (select count(*)::int from kilo.rate_limit_hits where bucket = 'test:ip:1.2.3.4'),
  3,
  'global prune left live rows untouched'
);

select * from finish();

rollback;
