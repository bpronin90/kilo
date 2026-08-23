-- Optional recovery-block reason: ownership, bounds, legacy rows, sync metadata
-- (issue #872).
--
-- The claim this file defends: adding one nullable free-text column to
-- kilo.recovery_blocks changes nothing about who can reach a recovery block,
-- how large a write may be, whether rows written before the column existed are
-- still valid, or who owns the sync clock.
--
-- Every write assertion runs as the `authenticated` role with a real JWT claim,
-- the way PostgREST executes a request, so "user B cannot read A's reason" is a
-- statement about RLS rather than about client code.
--
-- Harness: pgTAP.
--   psql "$DATABASE_URL" -f supabase/tests/recovery-block-reason.test.sql

begin;

select plan(21);

\set user_a '87200000-0000-0000-0000-000000000001'
\set user_b '87200000-0000-0000-0000-000000000002'

insert into auth.users (id) values (:'user_a'::uuid) on conflict do nothing;
insert into auth.users (id) values (:'user_b'::uuid) on conflict do nothing;

-- Both claim GUCs are set for the reason consent-gate.test.sql documents: a
-- NULL auth.uid() would turn every "the other user cannot do X" assertion into
-- a test that passes because nobody was logged in.
create or replace function pg_temp.as_user_872(p_user uuid)
  returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- The consent gate itself is consent-gate.test.sql's subject. This file holds it
-- open explicitly so a failure here is unambiguously about `reason`.
update kilo.health_sync_config
   set mode = 'legacy', minimum_consent_protocol_version = 0
 where id = true;

select pg_temp.as_user_872(:'user_a'::uuid);
select is(
  auth.uid(),
  :'user_a'::uuid,
  'the test harness actually authenticates as the intended user'
);
reset role;

-- ---------------------------------------------------------------------------
-- 1. Structure
-- ---------------------------------------------------------------------------

select has_column('kilo', 'recovery_blocks', 'reason', 'recovery blocks carry a reason column');
select col_type_is('kilo', 'recovery_blocks', 'reason', 'text', 'the reason is opaque free text');
select col_is_null('kilo', 'recovery_blocks', 'reason', 'the reason is optional, never required');
select col_hasnt_default('kilo', 'recovery_blocks', 'reason',
  'the reason has no default, so the server never invents one');

-- The column is health-adjacent free text on an already Art. 9-gated table, so
-- the gate must still be part of every policy. A reason column that arrived
-- alongside a quietly relaxed policy would be a new ungated health surface.
select is(
  (select count(*)::integer from pg_policies
    where schemaname = 'kilo' and tablename = 'recovery_blocks'
      -- coalesce BOTH sides: an INSERT policy has a NULL `qual` (it only has
      -- WITH CHECK), and `NULL || text` is NULL, which would silently drop the
      -- insert policy from the count instead of failing loudly.
      and coalesce(qual, '') || coalesce(with_check, '') like '%health_gate_ok%'),
  4,
  'all four recovery_blocks policies still require an active consent grant'
);

select ok(
  not has_table_privilege('anon', 'kilo.recovery_blocks', 'select')
  and not has_table_privilege('anon', 'kilo.recovery_blocks', 'insert')
  and not has_table_privilege('anon', 'kilo.recovery_blocks', 'update')
  and not has_table_privilege('anon', 'kilo.recovery_blocks', 'delete'),
  'anon has no access to recovery blocks, reason included'
);

-- ---------------------------------------------------------------------------
-- 2. Legacy rows: written before the column existed
-- ---------------------------------------------------------------------------
--
-- A block inserted without naming `reason` at all is exactly what every row
-- already in the table looks like after this migration.

select pg_temp.as_user_872(:'user_a'::uuid);

select lives_ok(
  $$ insert into kilo.recovery_blocks (user_id, id, baseline_note_id, baseline)
     values ('87200000-0000-0000-0000-000000000001', 'rb-legacy', 'wn-1',
             '{"version": 1, "exercises": []}'::jsonb) $$,
  'a block written without a reason is still a valid row'
);

select is(
  (select reason from kilo.recovery_blocks where id = 'rb-legacy'),
  null,
  'a legacy block reads back as having no reason rather than a blank one'
);

-- A legacy row remains fully editable: naming the injury later is the whole
-- point of the field being editable from Recovery administration.
select lives_ok(
  $$ update kilo.recovery_blocks set reason = 'torn hamstring'
      where id = 'rb-legacy' $$,
  'a legacy block accepts a reason added later'
);

select is(
  (select reason from kilo.recovery_blocks where id = 'rb-legacy'),
  'torn hamstring',
  'the added reason is stored verbatim'
);

-- ---------------------------------------------------------------------------
-- 3. Sync metadata stays server-owned
-- ---------------------------------------------------------------------------
--
-- An edit that touches ONLY the reason must go through the same
-- server-authoritative stamping as any other write: a client-proposed
-- `updated_at` is discarded, and the row records the transaction that wrote it
-- so the commit-safe pull feed can bound a page containing it. `now()` is the
-- transaction timestamp, so this compares against that rather than asserting a
-- wall-clock advance inside one transaction.

select lives_ok(
  $$ update kilo.recovery_blocks
        set reason = 'returning from surgery',
            updated_at = '2001-01-01T00:00:00Z'
      where id = 'rb-legacy' $$,
  'a reason-only edit may propose an updated_at'
);

select is(
  (select updated_at from kilo.recovery_blocks where id = 'rb-legacy'),
  now(),
  'the server overrides a client-proposed updated_at on a reason-only edit'
);

select is(
  (select sync_xid from kilo.recovery_blocks where id = 'rb-legacy'),
  pg_current_xact_id()::text::bigint,
  'a reason-only edit stamps the writing transaction into sync_xid'
);

-- ---------------------------------------------------------------------------
-- 4. Authenticated write bounds
-- ---------------------------------------------------------------------------
--
-- The client normalizes a reason to 280 characters; the database bound is the
-- looser abuse bound that survives a bypassed UI.

select lives_ok(
  $$ update kilo.recovery_blocks set reason = repeat('r', 4096)
      where id = 'rb-legacy' $$,
  'a reason at the database bound is accepted'
);

select throws_ok(
  $$ update kilo.recovery_blocks set reason = repeat('r', 4097)
      where id = 'rb-legacy' $$,
  '22001',
  null,
  'a reason past the database bound is refused'
);

select lives_ok(
  $$ update kilo.recovery_blocks set reason = null where id = 'rb-legacy' $$,
  'a reason can be cleared back to none'
);

reset role;

-- ---------------------------------------------------------------------------
-- 5. Owner isolation
-- ---------------------------------------------------------------------------
--
-- A cross-user attempt has to be a real write attempt, not a read: RLS makes an
-- update on someone else's row match zero rows rather than raise, so the
-- assertion has to be about the affected row COUNT. A data-modifying statement
-- is not allowed inside a sub-SELECT, so the attempt runs inside a helper that
-- reports `row_count`. The helper is SECURITY INVOKER (the default), so it is
-- the impersonated caller's policies that decide, not the definer's.
create or replace function pg_temp.try_rewrite_872()
  returns integer language plpgsql as $$
declare
  v_rows integer;
begin
  update kilo.recovery_blocks
     set reason = 'rewritten by a stranger'
   where id = 'rb-private';
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

select pg_temp.as_user_872(:'user_a'::uuid);

-- `recovery_blocks_one_active_idx` allows one live, uncompleted block per user,
-- so the isolation fixture needs the earlier block closed out first. Completing
-- it is ordinary lifecycle, not a workaround: it also leaves a completed block
-- in the table, which is the state the reason stays editable in.
update kilo.recovery_blocks set completed_at = now() where id = 'rb-legacy';

select lives_ok(
  $$ insert into kilo.recovery_blocks (user_id, id, baseline_note_id, baseline, reason)
     values ('87200000-0000-0000-0000-000000000001', 'rb-private', 'wn-2',
             '{"version": 1, "exercises": []}'::jsonb, 'private medical context') $$,
  'a user can write their own reason'
);
reset role;

select pg_temp.as_user_872(:'user_b'::uuid);

select is(
  (select count(*)::integer from kilo.recovery_blocks
    where reason = 'private medical context'),
  0,
  'another user cannot read the reason on a block they do not own'
);

select is(
  pg_temp.try_rewrite_872(),
  0,
  'another user cannot rewrite the reason on a block they do not own'
);

reset role;

select is(
  (select reason from kilo.recovery_blocks where id = 'rb-private'),
  'private medical context',
  'the owner''s reason survives the attempted cross-user write unchanged'
);

select * from finish();
rollback;
