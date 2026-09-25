-- Android Restore Credentials schema tests (issue #1157).
--
-- Proves the database half of the restore trust boundary:
--   * least privilege: no client role can read, write, or call anything, and
--     even service_role reaches the tables only through the functions;
--   * one-time challenges: replayed, expired, wrong-operation, cross-user, and
--     wrong-credential challenges are all refused;
--   * enrollment replaces the previous credential, and a failed enrollment
--     (partial write) leaves the previous one intact;
--   * a co-tenant or non-enrolled user id is never eligible;
--   * revocation is durable and one-way, burns outstanding challenges, and
--     closes the lookup -> issuance race;
--   * the security-event catalog accepts the restore events and source.
--
-- Harness: pgTAP, inside a rolled-back transaction.
--   psql "$DATABASE_URL" -f supabase/tests/android-restore-credentials.test.sql

begin;

select plan(54);

\set user_a '71570000-0000-4000-8000-00000000000a'
\set user_b '71570000-0000-4000-8000-00000000000b'
\set user_c '71570000-0000-4000-8000-00000000000c'
\set user_d '71570000-0000-4000-8000-00000000000d'
\set user_ghost '71570000-0000-4000-8000-0000000000ff'

insert into auth.users (id) values (:'user_a'::uuid), (:'user_b'::uuid), (:'user_c'::uuid), (:'user_d'::uuid)
on conflict do nothing;

create or replace function pg_temp.login_as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

create or replace function pg_temp.logout() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('request.jwt.claims', null, true);
end;
$$;

-- 43 base64url characters, the shape of 32 random bytes.
create or replace function pg_temp.chal(tag text) returns text
language sql as $$ select rpad('chal' || tag, 43, 'x') $$;

-- The Edge Function's enrollment sequence: issue a registration challenge,
-- consume it, then register against it.
create or replace function pg_temp.enroll(uid uuid, cred text, pubkey text) returns uuid
language plpgsql as $$
begin
  perform kilo.restore_issue_challenge('registration', pg_temp.chal('en' || cred), uid, null, 300);
  perform kilo.restore_consume_challenge('registration', pg_temp.chal('en' || cred), uid, null);
  return kilo.restore_register_credential(uid, pg_temp.chal('en' || cred), cred, pubkey, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Least privilege
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'kilo.restore_credentials'::regclass),
  'restore_credentials has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'kilo.restore_challenges'::regclass),
  'restore_challenges has RLS enabled'
);

select pg_temp.login_as(:'user_a'::uuid);
select throws_ok(
  'select * from kilo.restore_credentials', '42501', null,
  'an authenticated client cannot read restore credentials'
);
select throws_ok(
  'select * from kilo.restore_challenges', '42501', null,
  'an authenticated client cannot read restore challenges'
);
select throws_ok(
  format('insert into kilo.restore_credentials (user_id, credential_id, public_key) values (%L, %L, %L)',
    :'user_a', rpad('cred', 20, 'a'), rpad('key', 20, 'a')),
  '42501', null,
  'an authenticated client cannot register a credential directly'
);
select throws_ok(
  format('select kilo.restore_lookup_credential(%L)', rpad('cred', 20, 'a')),
  '42501', null,
  'an authenticated client cannot look up verification material'
);
select throws_ok(
  format('select kilo.restore_register_credential(%L, %L, %L, %L, 0)',
    :'user_a', pg_temp.chal('x'), rpad('cred', 20, 'a'), rpad('key', 20, 'a')),
  '42501', null,
  'an authenticated client cannot call the registration function'
);
select throws_ok(
  format('select kilo.restore_consume_challenge(%L, %L, %L, null)',
    'registration', pg_temp.chal('x'), :'user_a'),
  '42501', null,
  'an authenticated client cannot consume a challenge'
);
select throws_ok(
  format('select kilo.restore_revoke_user(%L)', :'user_b'),
  '42501', null,
  'an authenticated client cannot revoke another user'
);
select pg_temp.logout();

set local role anon;
select throws_ok(
  'select * from kilo.restore_credentials', '42501', null,
  'anon cannot read restore credentials'
);
select throws_ok(
  format('select kilo.restore_issue_challenge(%L, %L, null, %L, 300)',
    'assertion', pg_temp.chal('anon'), rpad('cred', 20, 'a')),
  '42501', null,
  'anon cannot issue challenges'
);
reset role;

set local role service_role;
select throws_ok(
  'select * from kilo.restore_credentials', '42501', null,
  'service_role reaches credentials only through the functions'
);
reset role;

select ok(
  has_function_privilege('service_role', 'kilo.restore_consume_challenge(text, text, uuid, text)', 'execute')
  and has_function_privilege('service_role', 'kilo.restore_revoke_user(uuid)', 'execute'),
  'service_role can execute the restore functions'
);

-- ---------------------------------------------------------------------------
-- 2. One-time registration challenges
-- ---------------------------------------------------------------------------

select isnt(
  kilo.restore_issue_challenge('registration', pg_temp.chal('reg1'), :'user_a'::uuid, null, 300),
  null,
  'a registration challenge is issued for user A'
);
select is(
  kilo.restore_consume_challenge('registration', pg_temp.chal('reg1'), :'user_b'::uuid, null),
  false,
  'another user cannot consume user A''s registration challenge'
);
select is(
  kilo.restore_consume_challenge('assertion', pg_temp.chal('reg1'), null, rpad('cred', 20, 'a')),
  false,
  'a registration challenge cannot be consumed as an assertion'
);
select is(
  kilo.restore_consume_challenge('registration', pg_temp.chal('reg1'), :'user_a'::uuid, null),
  true,
  'user A consumes their registration challenge'
);
select is(
  kilo.restore_consume_challenge('registration', pg_temp.chal('reg1'), :'user_a'::uuid, null),
  false,
  'a replayed registration challenge is refused'
);

insert into kilo.restore_challenges (challenge, operation, user_id, created_at, expires_at)
values (pg_temp.chal('expired'), 'registration', :'user_a'::uuid, now() - interval '10 minutes', now() - interval '5 minutes');
select is(
  kilo.restore_consume_challenge('registration', pg_temp.chal('expired'), :'user_a'::uuid, null),
  false,
  'an expired challenge is refused'
);

select throws_ok(
  format('select kilo.restore_issue_challenge(%L, %L, null, null, 300)', 'registration', pg_temp.chal('unbound')),
  '23514', null,
  'a registration challenge must be bound to a user'
);
select throws_ok(
  format('select kilo.restore_issue_challenge(%L, %L, %L, %L, 300)',
    'assertion', pg_temp.chal('overbound'), :'user_a', rpad('cred', 20, 'a')),
  '23514', null,
  'an assertion challenge must not carry a user id'
);
select throws_ok(
  format('select kilo.restore_issue_challenge(%L, %L, %L, null, 3600)', 'registration', pg_temp.chal('ttl'), :'user_a'),
  'P0001', 'restore challenge ttl out of range',
  'a challenge lifetime outside the bound is refused'
);

-- ---------------------------------------------------------------------------
-- 3. Enrollment, replacement, and partial writes
-- ---------------------------------------------------------------------------

select isnt(
  pg_temp.enroll(:'user_a'::uuid, rpad('credA1', 20, 'a'), rpad('keyA1', 20, 'k')),
  null,
  'user A registers a credential'
);
select is(
  (select user_id from kilo.restore_lookup_credential(rpad('credA1', 20, 'a'))),
  :'user_a'::uuid,
  'the active credential resolves to its owner'
);
select isnt(
  pg_temp.enroll(:'user_a'::uuid, rpad('credA2', 20, 'a'), rpad('keyA2', 20, 'k')),
  null,
  'user A enrolls a replacement credential'
);
select is(
  (select count(*)::int from kilo.restore_lookup_credential(rpad('credA1', 20, 'a'))),
  0,
  'the replaced credential is no longer eligible'
);
select is(
  (select count(*)::int from kilo.restore_credentials where user_id = :'user_a'::uuid and revoked_at is null),
  1,
  'a user has at most one active credential'
);

select isnt(
  pg_temp.enroll(:'user_b'::uuid, rpad('credB1', 20, 'b'), rpad('keyB1', 20, 'k')),
  null,
  'user B registers a credential'
);
select throws_ok(
  format('select pg_temp.enroll(%L, %L, %L)',
    :'user_b', rpad('credA2', 20, 'a'), rpad('keyX', 20, 'k')),
  '23505', null,
  'a credential id that is already registered cannot be re-bound to another user'
);
select is(
  (select user_id from kilo.restore_lookup_credential(rpad('credB1', 20, 'b'))),
  :'user_b'::uuid,
  'the failed enrollment left user B''s previous credential active'
);
select is(
  (select user_id from kilo.restore_lookup_credential(rpad('credA2', 20, 'a'))),
  :'user_a'::uuid,
  'the failed enrollment did not take over user A''s credential'
);
select throws_ok(
  format('select kilo.restore_register_credential(%L, %L, %L, %L, 0)',
    :'user_ghost', pg_temp.chal('ghost'), rpad('credG', 20, 'g'), rpad('keyG', 20, 'k')),
  'P0001', 'restore credential owner does not exist',
  'a credential cannot be registered for a user that does not exist'
);

-- Registration is bound to a consumed challenge, and a revocation that lands
-- between consuming it and registering wins (the sign-out / account-deletion
-- race).
select isnt(
  kilo.restore_issue_challenge('registration', pg_temp.chal('unconsumed'), :'user_d'::uuid, null, 300),
  null,
  'user D has an unconsumed registration challenge'
);
select is(
  kilo.restore_register_credential(:'user_d'::uuid, pg_temp.chal('unconsumed'), rpad('credD0', 20, 'd'), rpad('keyD0', 20, 'k'), 0),
  null,
  'a registration against an unconsumed challenge is refused'
);

select kilo.restore_issue_challenge('registration', pg_temp.chal('race'), :'user_d'::uuid, null, 300);
select kilo.restore_consume_challenge('registration', pg_temp.chal('race'), :'user_d'::uuid, null);
select kilo.restore_revoke_user(:'user_d'::uuid);
select is(
  kilo.restore_register_credential(:'user_d'::uuid, pg_temp.chal('race'), rpad('credD1', 20, 'd'), rpad('keyD1', 20, 'k'), 0),
  null,
  'a registration whose challenge predates a revocation is refused even though the challenge was consumed'
);
select isnt(
  pg_temp.enroll(:'user_d'::uuid, rpad('credD2', 20, 'd'), rpad('keyD2', 20, 'k')),
  null,
  'a registration started after the revocation succeeds'
);

-- ---------------------------------------------------------------------------
-- 4. Eligibility: co-tenant and non-enrolled users
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from kilo.restore_lookup_credential(rpad('never-registered', 20, 'z'))),
  0,
  'an unknown credential resolves to nothing'
);
select is(
  kilo.restore_record_use(rpad('credA2', 20, 'a'), :'user_c'::uuid, 1),
  false,
  'a non-enrolled user id cannot claim another user''s credential'
);
select is(
  kilo.restore_record_use(rpad('credA2', 20, 'a'), :'user_a'::uuid, 5),
  true,
  'the owner''s use is recorded'
);
select is(
  kilo.restore_record_use(rpad('credA2', 20, 'a'), :'user_a'::uuid, 2),
  true,
  'a later use is recorded'
);
select is(
  (select sign_count from kilo.restore_lookup_credential(rpad('credA2', 20, 'a'))),
  5::bigint,
  'the stored counter never moves backwards'
);

-- ---------------------------------------------------------------------------
-- 5. Assertion challenges and revocation
-- ---------------------------------------------------------------------------

select isnt(
  kilo.restore_issue_challenge('assertion', pg_temp.chal('asrt1'), null, rpad('credA2', 20, 'a'), 300),
  null,
  'an assertion challenge is issued for a credential id'
);
select isnt(
  kilo.restore_issue_challenge('assertion', pg_temp.chal('unknown'), null, rpad('never-registered', 20, 'z'), 300),
  null,
  'an assertion challenge is issued identically for an unknown credential id'
);
select is(
  kilo.restore_consume_challenge('assertion', pg_temp.chal('asrt1'), null, rpad('credB1', 20, 'b')),
  false,
  'an assertion challenge cannot be consumed for a different credential'
);
select isnt(
  kilo.restore_issue_challenge('registration', pg_temp.chal('reg-pending'), :'user_a'::uuid, null, 300),
  null,
  'user A has a pending registration challenge'
);

select is(kilo.restore_revoke_user(:'user_a'::uuid), 1, 'revocation revokes user A''s active credential');
select is(
  (select count(*)::int from kilo.restore_lookup_credential(rpad('credA2', 20, 'a'))),
  0,
  'a revoked credential resolves to nothing'
);
select is(
  kilo.restore_record_use(rpad('credA2', 20, 'a'), :'user_a'::uuid, 9),
  false,
  'a credential revoked after lookup cannot record the use that precedes issuance'
);
select is(
  kilo.restore_consume_challenge('assertion', pg_temp.chal('asrt1'), null, rpad('credA2', 20, 'a')),
  false,
  'revocation burns the outstanding assertion challenge'
);
select is(
  kilo.restore_consume_challenge('registration', pg_temp.chal('reg-pending'), :'user_a'::uuid, null),
  false,
  'revocation burns the outstanding registration challenge'
);
select is(kilo.restore_revoke_user(:'user_a'::uuid), 0, 'revocation is idempotent');

delete from auth.users where id = :'user_b'::uuid;
select is(
  (select count(*)::int from kilo.restore_credentials where user_id = :'user_b'::uuid),
  0,
  'deleting the auth user removes their credentials'
);

-- ---------------------------------------------------------------------------
-- 6. Security-event catalog
-- ---------------------------------------------------------------------------

select ok(
  kilo.record_security_event('restore.assertion_rejected', 'android-restore-credentials', 'denied', 'ip', '203.0.113.7',
    '{"status": 401, "reason": "verification_failed"}'::jsonb),
  'the restore source can record a rejected assertion'
);
select is(
  (select severity || ':' || (context ->> 'reason') from kilo.security_events
    where event_name = 'restore.assertion_rejected' order by id desc limit 1),
  'warning:verification_failed',
  'a rejected assertion is a warning and keeps its bounded reason'
);

select * from finish();
rollback;
