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

select plan(18);

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
-- rate_limit_global_prune: export-prefix rows pruned after 10-minute window
-- ---------------------------------------------------------------------------

-- Expired: 11 minutes old — past the export window.
insert into kilo.rate_limit_hits (bucket, occurred_at)
values ('export:ip:10.0.0.1', now() - interval '11 minutes');

-- Live: 9 minutes old — still inside the export window.
insert into kilo.rate_limit_hits (bucket, occurred_at)
values ('export:ip:10.0.0.2', now() - interval '9 minutes');

select is(
  (select count(*)::int from kilo.rate_limit_hits where bucket = 'export:ip:10.0.0.1'),
  1, 'expired export row present before prune'
);

select kilo.rate_limit_global_prune();

select is(
  (select count(*)::int from kilo.rate_limit_hits where bucket = 'export:ip:10.0.0.1'),
  0, 'global prune removed expired export row (past 10-min window)'
);
select is(
  (select count(*)::int from kilo.rate_limit_hits where bucket = 'export:ip:10.0.0.2'),
  1, 'global prune kept live export row (within 10-min window)'
);

-- ---------------------------------------------------------------------------
-- rate_limit_global_prune: delete-prefix rows pruned after 1-hour window
-- ---------------------------------------------------------------------------

-- Expired: 61 minutes old — past the delete window.
insert into kilo.rate_limit_hits (bucket, occurred_at)
values ('delete:ip:10.0.0.3', now() - interval '61 minutes');

-- Live: 59 minutes old — still inside the delete window.
insert into kilo.rate_limit_hits (bucket, occurred_at)
values ('delete:ip:10.0.0.4', now() - interval '59 minutes');

select kilo.rate_limit_global_prune();

select is(
  (select count(*)::int from kilo.rate_limit_hits where bucket = 'delete:ip:10.0.0.3'),
  0, 'global prune removed expired delete row (past 1-hour window)'
);
select is(
  (select count(*)::int from kilo.rate_limit_hits where bucket = 'delete:ip:10.0.0.4'),
  1, 'global prune kept live delete row (within 1-hour window)'
);

-- ---------------------------------------------------------------------------
-- rate_limit_global_prune: healthdelete-prefix rows use a 1-hour window
-- ---------------------------------------------------------------------------

-- Expired/live rows cover both production health-deletion bucket families.
insert into kilo.rate_limit_hits (bucket, occurred_at)
values
  ('healthdelete:ip:10.0.0.5', now() - interval '61 minutes'),
  ('healthdelete:ip:10.0.0.6', now() - interval '59 minutes'),
  ('healthdelete:user:uuid-expired', now() - interval '61 minutes'),
  ('healthdelete:user:uuid-live', now() - interval '59 minutes');

select kilo.rate_limit_global_prune();

select is(
  (select count(*)::int from kilo.rate_limit_hits
   where bucket in ('healthdelete:ip:10.0.0.5', 'healthdelete:user:uuid-expired')),
  0, 'global prune removed expired healthdelete IP and user rows (past 1-hour window)'
);
select is(
  (select count(*)::int from kilo.rate_limit_hits
   where bucket in ('healthdelete:ip:10.0.0.6', 'healthdelete:user:uuid-live')),
  2, 'global prune kept live healthdelete IP and user rows (within 1-hour window)'
);

-- Rows on either side of the one-hour boundary exercise the strict cutoff
-- with enough margin for the prune call to advance its transaction timestamp.
insert into kilo.rate_limit_hits (bucket, occurred_at)
values
  ('healthdelete:ip:10.0.0.7', now() - interval '1 hour 1 second'),
  ('healthdelete:user:uuid-boundary', now() - interval '59 minutes 59 seconds');

select kilo.rate_limit_global_prune();

select is(
  (select count(*)::int from kilo.rate_limit_hits
   where bucket = 'healthdelete:ip:10.0.0.7'),
  0, 'global prune removes healthdelete rows just past the 1-hour boundary'
);
select is(
  (select count(*)::int from kilo.rate_limit_hits
   where bucket = 'healthdelete:user:uuid-boundary'),
  1, 'global prune keeps healthdelete rows just inside the 1-hour boundary'
);

-- ---------------------------------------------------------------------------
-- rate_limit_global_prune: live check-admitted rows survive prune
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from kilo.rate_limit_hits where bucket = 'test:ip:1.2.3.4'),
  3,
  'global prune left live check-admitted rows untouched'
);

-- ---------------------------------------------------------------------------
-- rate_limit_global_prune: unknown-prefix fallback uses 2-hour horizon
-- ---------------------------------------------------------------------------
insert into kilo.rate_limit_hits (bucket, occurred_at)
values ('unknown:bucket', now() - interval '3 hours');

select kilo.rate_limit_global_prune();

select is(
  (select count(*)::int from kilo.rate_limit_hits where bucket = 'unknown:bucket'),
  0, 'global prune removed unknown-prefix row via 2-hour fallback'
);

select * from finish();

rollback;
