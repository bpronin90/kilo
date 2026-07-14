-- Expand/contract compatibility mirror regression tests (issue #487).
--
-- These cover the failure modes the spec calls out by name, because each one is
-- silent in production and only shows up as corrupted sync ordering weeks later:
--
--   * a mirror re-entering the opposite trigger and ping-ponging;
--   * a mirror creating a SECOND, later timestamp, so every mirror looks like a
--     fresh user edit ("phantom edit") that beats genuine writes from other
--     devices;
--   * reconciliation restamping the row it is repairing, destroying the very
--     timestamp it exists to preserve;
--   * cross-version conflicts resolving to the wrong side.
--
-- A note on time, because it shapes several tests below: now() is TRANSACTION
-- time, so every statement in this file shares one timestamp. In production each
-- PostgREST request is its own transaction and successive writes differ. Where a
-- test needs one write to be genuinely later than another, it moves the other
-- row's timestamp into the past through the privileged suppression path rather
-- than relying on wall-clock movement that will not happen inside a transaction.
--
-- Harness: pgTAP.
--   psql "$DATABASE_URL" -f supabase/tests/health-mirror.test.sql

begin;

select plan(27);

\set user_a '55555555-5555-5555-5555-555555555555'
\set user_b '66666666-6666-6666-6666-666666666666'

insert into auth.users (id) values (:'user_a'::uuid) on conflict do nothing;
insert into auth.users (id) values (:'user_b'::uuid) on conflict do nothing;

-- The gate is off in `legacy` mode, which is the state during expansion. This
-- file is about mirror mechanics; consent-gate.test.sql covers authorization.
update kilo.health_sync_config set mode = 'legacy' where id = true;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select has_table('kilo', 'user_health_profile', 'canonical health table exists');
select has_column('kilo', 'user_health_profile', 'current_deload_note_raw_text', 'canonical: deload raw text');
select has_column('kilo', 'user_health_profile', 'fatigue_multiplier', 'canonical: fatigue multiplier');
select has_column('kilo', 'user_health_profile', 'tracked_lifts', 'canonical: tracked lifts');
select has_column('kilo', 'user_health_profile', 'current_workout_note_id', 'canonical: current workout note id');

-- ---------------------------------------------------------------------------
-- Old-client write -> mirrored into the canonical table
-- ---------------------------------------------------------------------------

insert into kilo.user_profile (user_id, display_name, fatigue_multiplier, tracked_lifts)
values (:'user_a'::uuid, 'A', 1.5, '["squat"]'::jsonb);

select is(
  (select fatigue_multiplier from kilo.user_health_profile where user_id = :'user_a'::uuid),
  1.5::numeric,
  'legacy insert mirrors the health value into user_health_profile'
);

-- The whole point of the compatibility-aware timestamp wrapper: ONE genuine write
-- produces ONE server timestamp, shared by both copies. If these ever differ,
-- every mirror is a phantom edit that outranks real writes from other devices.
select is(
  (select h.updated_at from kilo.user_health_profile h where h.user_id = :'user_a'::uuid),
  (select p.updated_at from kilo.user_profile p where p.user_id = :'user_a'::uuid),
  'legacy write: both copies carry the same originating updated_at'
);

-- ---------------------------------------------------------------------------
-- New-client write -> mirrored back out for old clients
-- ---------------------------------------------------------------------------

update kilo.user_health_profile
  set fatigue_multiplier = 2.5
  where user_id = :'user_a'::uuid;

select is(
  (select fatigue_multiplier from kilo.user_profile where user_id = :'user_a'::uuid),
  2.5::numeric,
  'canonical write mirrors back into the legacy columns'
);

select is(
  (select h.updated_at from kilo.user_health_profile h where h.user_id = :'user_a'::uuid),
  (select p.updated_at from kilo.user_profile p where p.user_id = :'user_a'::uuid),
  'canonical write: both copies carry the same originating updated_at'
);

-- A user who only ever ran a new client has no legacy row yet. The outward mirror
-- must create it, or an old client on a second device sees nothing.
insert into kilo.user_health_profile (user_id, fatigue_multiplier)
values (:'user_b'::uuid, 3.5);

select is(
  (select fatigue_multiplier from kilo.user_profile where user_id = :'user_b'::uuid),
  3.5::numeric,
  'canonical insert creates the legacy row when it does not exist'
);

-- ---------------------------------------------------------------------------
-- Recursion is bounded, and mirrors are not gratuitous
-- ---------------------------------------------------------------------------

-- Age the canonical row so the legacy write below is genuinely later (see the
-- transaction-time note in the header). Without this the two writes tie, and a tie
-- is won by the canonical table by rule — which would be correct behavior but
-- would not exercise the mirror.
set session kilo.suppress_updated_at_stamp = 'on';
update kilo.user_health_profile
  set updated_at = now() - interval '1 hour'
  where user_id = :'user_a'::uuid;
set session kilo.suppress_updated_at_stamp = 'off';

-- If the mirrors could re-enter each other this statement would never terminate
-- (or would exhaust the trigger-depth limit). Reaching the assertion is the proof.
update kilo.user_profile set fatigue_multiplier = 4.5 where user_id = :'user_a'::uuid;

select is(
  (select fatigue_multiplier from kilo.user_health_profile where user_id = :'user_a'::uuid),
  4.5::numeric,
  'bidirectional mirrors terminate (no ping-pong) and a later legacy write mirrors'
);

select is(
  (select h.updated_at from kilo.user_health_profile h where h.user_id = :'user_a'::uuid),
  (select p.updated_at from kilo.user_profile p where p.user_id = :'user_a'::uuid),
  'the mirrored write did not mint a second, later timestamp'
);

-- A write that changes only NON-health columns must not touch the canonical row.
-- Otherwise every display_name edit would bump the health row's timestamp and beat
-- a genuine health edit made on another device.
create temp table mirror_before as
  select updated_at from kilo.user_health_profile where user_id = :'user_a'::uuid;

update kilo.user_profile set display_name = 'A renamed' where user_id = :'user_a'::uuid;

select is(
  (select updated_at from kilo.user_health_profile where user_id = :'user_a'::uuid),
  (select updated_at from mirror_before),
  'a non-health write does not mirror and does not bump the canonical timestamp'
);

-- ---------------------------------------------------------------------------
-- Mirror-level conflict rules
-- ---------------------------------------------------------------------------

-- An OLDER legacy write must not clobber a newer canonical row. Suppression lets
-- the write carry its own (older) originating timestamp, which is exactly what an
-- old client's delayed write looks like once it reaches the server.
set session kilo.suppress_updated_at_stamp = 'on';

update kilo.user_health_profile set
  fatigue_multiplier = 10,
  updated_at = '2026-07-10 12:00:00+00'
where user_id = :'user_a'::uuid;

update kilo.user_profile set
  fatigue_multiplier = 20,
  updated_at = '2026-07-09 12:00:00+00'
where user_id = :'user_a'::uuid;

set session kilo.suppress_updated_at_stamp = 'off';

select is(
  (select fatigue_multiplier from kilo.user_health_profile where user_id = :'user_a'::uuid),
  10::numeric,
  'an older legacy write does not overwrite a newer canonical row'
);

-- Exact tie: the canonical table is authoritative, so an equal-timestamp legacy
-- write must NOT win.
set session kilo.suppress_updated_at_stamp = 'on';
update kilo.user_profile set
  fatigue_multiplier = 999,
  updated_at = '2026-07-10 12:00:00+00'
where user_id = :'user_a'::uuid;
set session kilo.suppress_updated_at_stamp = 'off';

select is(
  (select fatigue_multiplier from kilo.user_health_profile where user_id = :'user_a'::uuid),
  10::numeric,
  'on an equal timestamp the legacy mirror does NOT overwrite the canonical row'
);

-- ---------------------------------------------------------------------------
-- Reconciliation
-- ---------------------------------------------------------------------------

-- Reconciliation repairs a divergence the mirrors could not have produced on their
-- own — rows that predate the mirrors, or a tie whose values disagree. Disable the
-- mirrors to manufacture exactly that state, then turn them back on and repair.
alter table kilo.user_profile disable trigger mirror_profile_to_health;
alter table kilo.user_health_profile disable trigger mirror_health_to_profile;

set session kilo.suppress_updated_at_stamp = 'on';
update kilo.user_health_profile set
  fatigue_multiplier = 10, updated_at = '2026-07-10 12:00:00+00'
where user_id = :'user_a'::uuid;
update kilo.user_profile set
  fatigue_multiplier = 20, updated_at = '2026-07-09 12:00:00+00'
where user_id = :'user_a'::uuid;
set session kilo.suppress_updated_at_stamp = 'off';

alter table kilo.user_profile enable trigger mirror_profile_to_health;
alter table kilo.user_health_profile enable trigger mirror_health_to_profile;

select is(
  (select count(*) from kilo.health_parity_report() where user_id = :'user_a'::uuid),
  1::bigint,
  'the parity report detects a divergence'
);

select is(
  kilo.reconcile_user_health(:'user_a'::uuid),
  'user_health_profile',
  'reconciliation picks the strictly later canonical row'
);

select is(
  (select fatigue_multiplier from kilo.user_profile where user_id = :'user_a'::uuid),
  10::numeric,
  'reconciliation copies the winner onto the loser'
);

-- The critical one. A plain UPDATE inside reconcile would have restamped this to
-- now(); it must still be the ORIGINATING timestamp of the winning write.
select is(
  (select updated_at from kilo.user_profile where user_id = :'user_a'::uuid),
  '2026-07-10 12:00:00+00'::timestamptz,
  'reconciliation preserves the originating timestamp (no phantom bump)'
);

select is(
  (select updated_at from kilo.user_health_profile where user_id = :'user_a'::uuid),
  '2026-07-10 12:00:00+00'::timestamptz,
  'reconciliation does not restamp the winner either'
);

select is(
  (select count(*) from kilo.health_parity_report() where user_id = :'user_a'::uuid),
  0::bigint,
  'reconciliation restores parity'
);

-- The other direction: the old client genuinely wrote last, so it wins.
alter table kilo.user_profile disable trigger mirror_profile_to_health;
set session kilo.suppress_updated_at_stamp = 'on';
update kilo.user_profile set
  fatigue_multiplier = 30, updated_at = '2026-07-11 12:00:00+00'
where user_id = :'user_a'::uuid;
set session kilo.suppress_updated_at_stamp = 'off';
alter table kilo.user_profile enable trigger mirror_profile_to_health;

select is(
  kilo.reconcile_user_health(:'user_a'::uuid),
  'user_profile',
  'reconciliation picks the strictly later legacy row'
);

select is(
  (select fatigue_multiplier from kilo.user_health_profile where user_id = :'user_a'::uuid),
  30::numeric,
  'a later old-client write wins over an older canonical row'
);

-- Equal timestamps, disagreeing values: the canonical table breaks the tie.
alter table kilo.user_profile disable trigger mirror_profile_to_health;
alter table kilo.user_health_profile disable trigger mirror_health_to_profile;
set session kilo.suppress_updated_at_stamp = 'on';
update kilo.user_health_profile set
  fatigue_multiplier = 100, updated_at = '2026-07-12 12:00:00+00'
where user_id = :'user_a'::uuid;
update kilo.user_profile set
  fatigue_multiplier = 200, updated_at = '2026-07-12 12:00:00+00'
where user_id = :'user_a'::uuid;
set session kilo.suppress_updated_at_stamp = 'off';
alter table kilo.user_profile enable trigger mirror_profile_to_health;
alter table kilo.user_health_profile enable trigger mirror_health_to_profile;

select is(
  kilo.reconcile_user_health(:'user_a'::uuid),
  'user_health_profile',
  'on an equal timestamp reconciliation resolves to the canonical table'
);

select is(
  (select fatigue_multiplier from kilo.user_profile where user_id = :'user_a'::uuid),
  100::numeric,
  'the tie-break winner is copied onto the legacy side'
);

select is(
  (select count(*) from kilo.health_parity_report() where user_id = :'user_a'::uuid),
  0::bigint,
  'parity is restored after the tie-break'
);

-- ---------------------------------------------------------------------------
-- Clients cannot forge the sync clock
-- ---------------------------------------------------------------------------

-- The suppression signal is honored only for privileged roles. If an
-- `authenticated` session could set it, a tampered client could stamp a
-- far-future updated_at and win every LWW conflict forever — the exact attack
-- #349 closed.
set local role authenticated;
set session kilo.suppress_updated_at_stamp = 'on';

update kilo.user_health_profile set
  fatigue_multiplier = 999,
  updated_at = '2099-01-01 00:00:00+00'
where user_id = :'user_a'::uuid;

reset role;
set session kilo.suppress_updated_at_stamp = 'off';

select ok(
  (select updated_at from kilo.user_health_profile where user_id = :'user_a'::uuid)
    < '2030-01-01 00:00:00+00'::timestamptz,
  'an authenticated client cannot suppress the stamp or forge a future timestamp'
);

select * from finish();
rollback;
