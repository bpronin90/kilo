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

select plan(71);

\set user_a '71570000-0000-4000-8000-00000000000a'
\set user_b '71570000-0000-4000-8000-00000000000b'
\set user_c '71570000-0000-4000-8000-00000000000c'
\set user_d '71570000-0000-4000-8000-00000000000d'
\set user_e '71570000-0000-4000-8000-00000000000e'
\set user_ghost '71570000-0000-4000-8000-0000000000ff'

insert into auth.users (id) values (:'user_a'::uuid), (:'user_b'::uuid), (:'user_c'::uuid), (:'user_d'::uuid), (:'user_e'::uuid)
on conflict do nothing;
update auth.users set encrypted_password = '$2a$10$fixturehashfixturehashfixturehashfixturehashfixtureh'
 where id = :'user_e'::uuid;

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

-- Test stand-in for GoTrue sessions (issue #1162). auth.sessions is created by
-- GoTrue, which this database does not run, so kilo.restore_session_active is
-- replaced -- inside this rolled-back transaction only -- by one that reads a
-- temp table. pg_temp.sess(uid) is each user's default session id.
create temp table fake_sessions (id uuid primary key, user_id uuid not null);

create or replace function pg_temp.sess(uid uuid) returns uuid
language sql as $$ select md5('sess:' || uid::text)::uuid $$;

create or replace function kilo.restore_session_active(p_session_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from pg_temp.fake_sessions s where s.id = p_session_id and s.user_id = p_user_id)
$$;

-- The Edge Function's enrollment sequence: issue a registration challenge,
-- consume it, then register against it.
create or replace function pg_temp.enroll(uid uuid, cred text, pubkey text, sid uuid default null) returns uuid
language plpgsql as $$
declare
  v_sid uuid := coalesce(sid, pg_temp.sess(uid));
begin
  perform kilo.restore_issue_challenge('registration', pg_temp.chal('en' || cred), uid, v_sid, null, 300);
  perform kilo.restore_consume_challenge('registration', pg_temp.chal('en' || cred), uid, v_sid, null);
  return kilo.restore_register_credential(uid, pg_temp.chal('en' || cred), v_sid, cred, pubkey, 0);
end;
$$;

insert into pg_temp.fake_sessions (id, user_id)
select pg_temp.sess(u.id), u.id from auth.users u
where u.id in (:'user_a'::uuid, :'user_b'::uuid, :'user_c'::uuid, :'user_d'::uuid, :'user_e'::uuid);

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
  format('select kilo.restore_register_credential(%L, %L, null, %L, %L, 0)',
    :'user_a', pg_temp.chal('x'), rpad('cred', 20, 'a'), rpad('key', 20, 'a')),
  '42501', null,
  'an authenticated client cannot call the registration function'
);
select throws_ok(
  format('select kilo.restore_consume_challenge(%L, %L, %L, null, null)',
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
  format('select kilo.restore_issue_challenge(%L, %L, null, null, %L, 300)',
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
  has_function_privilege('service_role', 'kilo.restore_consume_challenge(text, text, uuid, uuid, text)', 'execute')
  and has_function_privilege('service_role', 'kilo.restore_revoke_user(uuid)', 'execute'),
  'service_role can execute the restore functions'
);

-- ---------------------------------------------------------------------------
-- 2. One-time registration challenges
-- ---------------------------------------------------------------------------

select isnt(
  kilo.restore_issue_challenge('registration', pg_temp.chal('reg1'), :'user_a'::uuid, pg_temp.sess(:'user_a'::uuid), null, 300),
  null,
  'a registration challenge is issued for user A'
);
select is(
  kilo.restore_consume_challenge('registration', pg_temp.chal('reg1'), :'user_b'::uuid, pg_temp.sess(:'user_b'::uuid), null),
  false,
  'another user cannot consume user A''s registration challenge'
);
select is(
  kilo.restore_consume_challenge('assertion', pg_temp.chal('reg1'), null, null, rpad('cred', 20, 'a')),
  false,
  'a registration challenge cannot be consumed as an assertion'
);
select is(
  kilo.restore_consume_challenge('registration', pg_temp.chal('reg1'), :'user_a'::uuid, pg_temp.sess(:'user_a'::uuid), null),
  true,
  'user A consumes their registration challenge'
);
select is(
  kilo.restore_consume_challenge('registration', pg_temp.chal('reg1'), :'user_a'::uuid, pg_temp.sess(:'user_a'::uuid), null),
  false,
  'a replayed registration challenge is refused'
);

insert into kilo.restore_challenges (challenge, operation, user_id, session_id, password_fingerprint, created_at, expires_at)
values (pg_temp.chal('expired'), 'registration', :'user_a'::uuid, pg_temp.sess(:'user_a'::uuid), repeat('0', 64), now() - interval '10 minutes', now() - interval '5 minutes');
select is(
  kilo.restore_consume_challenge('registration', pg_temp.chal('expired'), :'user_a'::uuid, pg_temp.sess(:'user_a'::uuid), null),
  false,
  'an expired challenge is refused'
);

select throws_ok(
  format('select kilo.restore_issue_challenge(%L, %L, null, null, null, 300)', 'registration', pg_temp.chal('unbound')),
  '23514', null,
  'a registration challenge must be bound to a user'
);
select throws_ok(
  format('select kilo.restore_issue_challenge(%L, %L, %L, null, %L, 300)',
    'assertion', pg_temp.chal('overbound'), :'user_a', rpad('cred', 20, 'a')),
  '23514', null,
  'an assertion challenge must not carry a user id'
);
select throws_ok(
  format('select kilo.restore_issue_challenge(%L, %L, %L, %L, null, 3600)', 'registration', pg_temp.chal('ttl'), :'user_a', pg_temp.sess(:'user_a'::uuid)),
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
  format('select kilo.restore_register_credential(%L, %L, null, %L, %L, 0)',
    :'user_ghost', pg_temp.chal('ghost'), rpad('credG', 20, 'g'), rpad('keyG', 20, 'k')),
  'P0001', 'restore credential owner does not exist',
  'a credential cannot be registered for a user that does not exist'
);

-- Registration is bound to a consumed challenge, and a revocation that lands
-- between consuming it and registering wins (the sign-out / account-deletion
-- race).
select isnt(
  kilo.restore_issue_challenge('registration', pg_temp.chal('unconsumed'), :'user_d'::uuid, pg_temp.sess(:'user_d'::uuid), null, 300),
  null,
  'user D has an unconsumed registration challenge'
);
select is(
  kilo.restore_register_credential(:'user_d'::uuid, pg_temp.chal('unconsumed'), pg_temp.sess(:'user_d'::uuid), rpad('credD0', 20, 'd'), rpad('keyD0', 20, 'k'), 0),
  null,
  'a registration against an unconsumed challenge is refused'
);

select kilo.restore_issue_challenge('registration', pg_temp.chal('race'), :'user_d'::uuid, pg_temp.sess(:'user_d'::uuid), null, 300);
select kilo.restore_consume_challenge('registration', pg_temp.chal('race'), :'user_d'::uuid, pg_temp.sess(:'user_d'::uuid), null);
select kilo.restore_revoke_user(:'user_d'::uuid);
select is(
  kilo.restore_register_credential(:'user_d'::uuid, pg_temp.chal('race'), pg_temp.sess(:'user_d'::uuid), rpad('credD1', 20, 'd'), rpad('keyD1', 20, 'k'), 0),
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
  kilo.restore_issue_challenge('assertion', pg_temp.chal('asrt1'), null, null, rpad('credA2', 20, 'a'), 300),
  null,
  'an assertion challenge is issued for a credential id'
);
select isnt(
  kilo.restore_issue_challenge('assertion', pg_temp.chal('unknown'), null, null, rpad('never-registered', 20, 'z'), 300),
  null,
  'an assertion challenge is issued identically for an unknown credential id'
);
select is(
  kilo.restore_consume_challenge('assertion', pg_temp.chal('asrt1'), null, null, rpad('credB1', 20, 'b')),
  false,
  'an assertion challenge cannot be consumed for a different credential'
);
select isnt(
  kilo.restore_issue_challenge('registration', pg_temp.chal('reg-pending'), :'user_a'::uuid, pg_temp.sess(:'user_a'::uuid), null, 300),
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
  kilo.restore_consume_challenge('assertion', pg_temp.chal('asrt1'), null, null, rpad('credA2', 20, 'a')),
  false,
  'revocation burns the outstanding assertion challenge'
);
select is(
  kilo.restore_consume_challenge('registration', pg_temp.chal('reg-pending'), :'user_a'::uuid, pg_temp.sess(:'user_a'::uuid), null),
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

-- ---------------------------------------------------------------------------
-- 7. Auth lifecycle (issue #1162): password change, global sign-out,
--    session-bound enrollment, and clean re-enrollment
-- ---------------------------------------------------------------------------

select isnt(
  pg_temp.enroll(:'user_e'::uuid, rpad('credE1', 20, 'e'), rpad('keyE1', 20, 'k')),
  null,
  'user E enrolls from a live session'
);
select ok(
  kilo.restore_credential_eligible(rpad('credE1', 20, 'e'), :'user_e'::uuid),
  'a freshly enrolled credential is eligible'
);
select ok(
  (select password_fingerprint ~ '^[0-9a-f]{64}$'
      and password_fingerprint <> (select encrypted_password from auth.users where id = :'user_e'::uuid)
   from kilo.restore_credentials where credential_id = rpad('credE1', 20, 'e')),
  'only a digest of the password hash is stored, never the hash itself'
);
select is(
  (select enrolled_session_id from kilo.restore_credentials where credential_id = rpad('credE1', 20, 'e')),
  pg_temp.sess(:'user_e'::uuid),
  'the credential records the session that enrolled it'
);

-- Password change or reset, from Kilo or anywhere else.
update auth.users set encrypted_password = '$2a$10$changedpasswordchangedpasswordchangedpasswordchang'
 where id = :'user_e'::uuid;
select ok(
  not kilo.restore_credential_eligible(rpad('credE1', 20, 'e'), :'user_e'::uuid),
  'a password change makes the credential ineligible'
);
select is(
  kilo.restore_record_use(rpad('credE1', 20, 'e'), :'user_e'::uuid, 1),
  false,
  'no session can be issued from a credential enrolled before the password change'
);
select ok(
  (select revoked_at is not null from kilo.restore_credentials where credential_id = rpad('credE1', 20, 'e')),
  'the stale credential is revoked durably'
);
select isnt(
  pg_temp.enroll(:'user_e'::uuid, rpad('credE2', 20, 'e'), rpad('keyE2', 20, 'k')),
  null,
  'after the password change the owner re-enrolls cleanly'
);
select ok(
  kilo.restore_record_use(rpad('credE2', 20, 'e'), :'user_e'::uuid, 1),
  'the re-enrolled credential can issue again'
);

-- Global sign-out (every session row for the user goes), by any path.
delete from pg_temp.fake_sessions where user_id = :'user_e'::uuid;
select is(
  kilo.restore_record_use(rpad('credE2', 20, 'e'), :'user_e'::uuid, 2),
  false,
  'after a global sign-out the credential cannot issue'
);

-- Re-authentication creates a new session; enrollment from it works.
insert into pg_temp.fake_sessions values ('71570000-0000-4000-8000-0000000000e2', :'user_e'::uuid);
select isnt(
  pg_temp.enroll(:'user_e'::uuid, rpad('credE3', 20, 'e'), rpad('keyE3', 20, 'k'), '71570000-0000-4000-8000-0000000000e2'),
  null,
  'after re-authentication the owner re-enrolls from the new session'
);
select ok(
  kilo.restore_credential_eligible(rpad('credE3', 20, 'e'), :'user_e'::uuid),
  'the credential enrolled from the new session is eligible'
);

-- A registration challenge belongs to the session that requested it.
select kilo.restore_issue_challenge('registration', pg_temp.chal('sessbound'), :'user_e'::uuid,
  '71570000-0000-4000-8000-0000000000e2', null, 300);
select is(
  kilo.restore_consume_challenge('registration', pg_temp.chal('sessbound'), :'user_e'::uuid,
    '71570000-0000-4000-8000-0000000000e3', null),
  false,
  'another session of the same user cannot spend the registration challenge'
);

-- The enrolling session ends between options and registration.
select kilo.restore_consume_challenge('registration', pg_temp.chal('sessbound'), :'user_e'::uuid,
  '71570000-0000-4000-8000-0000000000e2', null);
delete from pg_temp.fake_sessions where id = '71570000-0000-4000-8000-0000000000e2';
select is(
  kilo.restore_register_credential(:'user_e'::uuid, pg_temp.chal('sessbound'),
    '71570000-0000-4000-8000-0000000000e2', rpad('credE4', 20, 'e'), rpad('keyE4', 20, 'k'), 0),
  null,
  'a registration whose session was signed out mid-enrollment is refused'
);

-- The password is reset between enrollment options and verification.
insert into pg_temp.fake_sessions values ('71570000-0000-4000-8000-0000000000e5', :'user_e'::uuid);
select kilo.restore_issue_challenge('registration', pg_temp.chal('pwrace'), :'user_e'::uuid,
  '71570000-0000-4000-8000-0000000000e5', null, 300);
select kilo.restore_consume_challenge('registration', pg_temp.chal('pwrace'), :'user_e'::uuid,
  '71570000-0000-4000-8000-0000000000e5', null);
update auth.users set encrypted_password = '$2a$10$resetmidenrollmentresetmidenrollmentresetmidenrollm'
 where id = :'user_e'::uuid;
select is(
  kilo.restore_register_credential(:'user_e'::uuid, pg_temp.chal('pwrace'),
    '71570000-0000-4000-8000-0000000000e5', rpad('credE5', 20, 'e'), rpad('keyE5', 20, 'k'), 0),
  null,
  'a registration whose challenge predates a password reset is refused'
);

-- A credential without lifecycle binding (enrolled before this migration).
insert into kilo.restore_credentials (user_id, credential_id, public_key)
values (:'user_c'::uuid, rpad('legacyC', 20, 'c'), rpad('keyC', 20, 'k'));
select ok(
  not kilo.restore_credential_eligible(rpad('legacyC', 20, 'c'), :'user_c'::uuid),
  'a credential with no recorded session or password digest is never eligible'
);

select ok(
  not has_function_privilege('authenticated', 'kilo.restore_credential_eligible(text, uuid)', 'execute')
  and not has_function_privilege('service_role', 'kilo.restore_password_fingerprint(uuid)', 'execute')
  and not has_function_privilege('service_role', 'kilo.restore_session_active(uuid, uuid)', 'execute'),
  'the lifecycle reads are internal and the eligibility check is service_role only'
);

select * from finish();
rollback;
