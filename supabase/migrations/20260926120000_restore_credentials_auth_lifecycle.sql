-- Android Restore Credentials: tie each restore key to the owner's auth
-- lifecycle (issue #1162, hardening #1157).
--
-- THE GAP
--
-- After #1157 a restore key stopped working only when Kilo's /v1/revoke route
-- or account deletion revoked it. A password change or reset, or a GoTrue
-- global sign-out through any other path, left it eligible -- so a key planted
-- by someone who briefly held a victim's access token kept minting sessions
-- after the victim reset their password.
--
-- THE GUARANTEE (server-side; no client cooperation assumed)
--
-- A credential is eligible to issue a session only while BOTH hold:
--
--   1. The owner's password is unchanged since enrollment. Enrollment stores a
--      digest of auth.users.encrypted_password; issuance recomputes it. Any
--      password change or recovery completion rewrites encrypted_password, from
--      Kilo or anywhere else, so the digests stop matching. (A hash upgrade by
--      GoTrue would also stop them matching: that fails safe, costing only a
--      re-enrollment.) The digest is of the bcrypt string, which carries its
--      own salt; without that string it is not an offline password oracle.
--
--   2. The GoTrue session that enrolled the key still exists. Enrollment
--      records the bearer token's session_id; issuance checks auth.sessions. A
--      global sign-out deletes every session row for the user, so every key
--      they enrolled becomes ineligible, whatever path triggered the sign-out.
--      (So does ending just the enrolling device's session, which matches
--      #1157: signing out already revokes the key.)
--
-- Both checks run in kilo.restore_record_use (immediately before issuance) and
-- in kilo.restore_credential_eligible (the Edge Function's re-check after the
-- GoTrue exchange). A key found stale is revoked durably.
--
-- Nothing here writes to, alters, or adds a trigger to the auth schema. The
-- functions only read auth.users and auth.sessions as their owner.
--
-- ENROLLMENT FRESHNESS is enforced in the Edge Function from the GoTrue-signed
-- `amr` claim. The database's part is binding each registration challenge to
-- the session that requested it, so a challenge cannot be spent from another
-- session.

-- ---------------------------------------------------------------------------
-- 1. Lifecycle columns
-- ---------------------------------------------------------------------------

-- Nullable so the migration applies cleanly. A credential without them is
-- never eligible (fail closed), so anything enrolled before this migration
-- must re-enroll.
alter table kilo.restore_credentials
  add column if not exists enrolled_session_id uuid,
  add column if not exists password_fingerprint text
    check (password_fingerprint ~ '^[0-9a-f]{64}$');

-- A registration challenge also captures the owner's password digest when it
-- is issued, and registration requires it unchanged: a password reset between
-- options and verification must not let the in-flight enrollment record the
-- NEW digest and survive the reset.
alter table kilo.restore_challenges
  add column if not exists session_id uuid,
  add column if not exists password_fingerprint text
    check (password_fingerprint ~ '^[0-9a-f]{64}$');

-- Registration challenges issued before this migration carry no session and
-- could never be spent under the session-bound functions below, so they are
-- removed first; otherwise any still in the table would fail the new
-- constraint and abort the migration.
delete from kilo.restore_challenges
 where operation = 'registration'
   and session_id is null;

alter table kilo.restore_challenges drop constraint if exists restore_challenges_registration_session;
alter table kilo.restore_challenges add constraint restore_challenges_registration_session
  check (operation <> 'registration' or (session_id is not null and password_fingerprint is not null));

-- ---------------------------------------------------------------------------
-- 2. Lifecycle reads (internal; granted to no role)
-- ---------------------------------------------------------------------------

create or replace function kilo.restore_password_fingerprint(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      'kilo-restore:' || u.id::text || ':' || coalesce(u.encrypted_password, ''),
      'UTF8'
    )),
    'hex'
  )
  from auth.users u
  where u.id = p_user_id
$$;

revoke all on function kilo.restore_password_fingerprint(uuid) from public, anon, authenticated, service_role;

-- Whether a GoTrue session row still exists for this user. Dynamic SQL because
-- auth.sessions is created by GoTrue, not by the database image: it exists in
-- the hosted project but not in a GoTrue-less test database, and a missing
-- table must mean "not eligible", never an error that bubbles up as a 500 or a
-- crash of the enclosing check.
create or replace function kilo.restore_session_active(p_session_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_active boolean;
begin
  if p_session_id is null or p_user_id is null or pg_catalog.to_regclass('auth.sessions') is null then
    return false;
  end if;

  execute 'select exists (
             select 1 from auth.sessions s
             where s.id = $1
               and s.user_id = $2
               and (s.not_after is null or s.not_after > now())
           )'
    into v_active
    using p_session_id, p_user_id;

  return coalesce(v_active, false);
end;
$$;

revoke all on function kilo.restore_session_active(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Eligibility
-- ---------------------------------------------------------------------------

-- True only for an active credential owned by p_user_id whose password digest
-- still matches and whose enrolling session still exists.
create or replace function kilo.restore_credential_eligible(p_credential_id text, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session uuid;
  v_fingerprint text;
begin
  select rc.enrolled_session_id, rc.password_fingerprint
    into v_session, v_fingerprint
  from kilo.restore_credentials rc
  where rc.credential_id = p_credential_id
    and rc.user_id = p_user_id
    and rc.revoked_at is null;

  if not found or v_session is null or v_fingerprint is null then
    return false;
  end if;

  if v_fingerprint is distinct from kilo.restore_password_fingerprint(p_user_id) then
    return false;
  end if;

  return kilo.restore_session_active(v_session, p_user_id);
end;
$$;

revoke all on function kilo.restore_credential_eligible(text, uuid) from public, anon, authenticated;
grant execute on function kilo.restore_credential_eligible(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Session-bound challenges and registration
-- ---------------------------------------------------------------------------
--
-- The signatures change (a session id joins them), so the #1157 versions are
-- dropped rather than overloaded: an overload would leave the unbound form
-- callable.

drop function if exists kilo.restore_issue_challenge(text, text, uuid, text, integer);
drop function if exists kilo.restore_consume_challenge(text, text, uuid, text);
drop function if exists kilo.restore_register_credential(uuid, text, text, text, bigint);

create or replace function kilo.restore_issue_challenge(
  p_operation text,
  p_challenge text,
  p_user_id uuid,
  p_session_id uuid,
  p_credential_id text,
  p_ttl_seconds integer
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 30 or p_ttl_seconds > 600 then
    raise exception 'restore challenge ttl out of range';
  end if;

  delete from kilo.restore_challenges c
  where c.expires_at < now() - interval '1 hour';

  if p_operation = 'registration' and p_user_id is not null then
    perform kilo.restore_lock_user(p_user_id);
  end if;

  v_expires := pg_catalog.clock_timestamp() + make_interval(secs => p_ttl_seconds);

  insert into kilo.restore_challenges (
    challenge, operation, user_id, session_id, password_fingerprint, credential_id, created_at, expires_at
  ) values (
    p_challenge, p_operation, p_user_id, p_session_id,
    case when p_operation = 'registration' then kilo.restore_password_fingerprint(p_user_id) end,
    p_credential_id, pg_catalog.clock_timestamp(), v_expires
  );

  return v_expires;
end;
$$;

-- As in #1157, plus: a registration challenge is consumed only by the session
-- that requested it.
create or replace function kilo.restore_consume_challenge(
  p_operation text,
  p_challenge text,
  p_user_id uuid,
  p_session_id uuid,
  p_credential_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  update kilo.restore_challenges c
     set consumed_at = now()
   where c.challenge = p_challenge
     and c.operation = p_operation
     and c.consumed_at is null
     and c.expires_at > now()
     and (
       (p_operation = 'registration' and c.user_id = p_user_id and c.session_id = p_session_id)
       or (p_operation = 'assertion' and c.credential_id = p_credential_id)
     )
  returning c.id into v_id;

  return v_id is not null;
end;
$$;

-- As in #1157, plus: the challenge must belong to p_session_id, that session
-- must still exist, and the new credential records both the session and the
-- owner's current password digest.
create or replace function kilo.restore_register_credential(
  p_user_id uuid,
  p_challenge text,
  p_session_id uuid,
  p_credential_id text,
  p_public_key text,
  p_sign_count bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_issued timestamptz;
  v_revoked timestamptz;
  v_challenge_fingerprint text;
  v_fingerprint text;
begin
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'restore credential owner does not exist';
  end if;

  perform kilo.restore_lock_user(p_user_id);

  select c.created_at, c.password_fingerprint into v_issued, v_challenge_fingerprint
  from kilo.restore_challenges c
  where c.challenge = p_challenge
    and c.operation = 'registration'
    and c.user_id = p_user_id
    and c.session_id = p_session_id
    and c.consumed_at is not null;
  if v_issued is null then
    return null;
  end if;

  select r.revoked_at into v_revoked
  from kilo.restore_revocations r
  where r.user_id = p_user_id;
  if v_revoked is not null and v_revoked >= v_issued then
    return null;
  end if;

  -- The enrolling session was signed out between options and verification.
  if not kilo.restore_session_active(p_session_id, p_user_id) then
    return null;
  end if;

  -- The password changed between options and verification.
  v_fingerprint := kilo.restore_password_fingerprint(p_user_id);
  if v_challenge_fingerprint is null or v_fingerprint is distinct from v_challenge_fingerprint then
    return null;
  end if;

  update kilo.restore_credentials rc
     set revoked_at = now()
   where rc.user_id = p_user_id
     and rc.revoked_at is null;

  insert into kilo.restore_credentials (
    user_id, credential_id, public_key, sign_count, enrolled_session_id, password_fingerprint
  ) values (
    p_user_id, p_credential_id, p_public_key, coalesce(p_sign_count, 0),
    p_session_id, v_fingerprint
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- As in #1157, plus the lifecycle check. A credential that is active but no
-- longer eligible is revoked here, durably, so a later password or session
-- state cannot make it eligible again.
create or replace function kilo.restore_record_use(
  p_credential_id text,
  p_user_id uuid,
  p_sign_count bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not kilo.restore_credential_eligible(p_credential_id, p_user_id) then
    update kilo.restore_credentials rc
       set revoked_at = now()
     where rc.credential_id = p_credential_id
       and rc.user_id = p_user_id
       and rc.revoked_at is null;
    return false;
  end if;

  update kilo.restore_credentials rc
     set last_used_at = now(),
         sign_count = greatest(rc.sign_count, coalesce(p_sign_count, 0))
   where rc.credential_id = p_credential_id
     and rc.user_id = p_user_id
     and rc.revoked_at is null
  returning rc.id into v_id;

  return v_id is not null;
end;
$$;

revoke all on function kilo.restore_issue_challenge(text, text, uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function kilo.restore_consume_challenge(text, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function kilo.restore_register_credential(uuid, text, uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function kilo.restore_record_use(text, uuid, bigint) from public, anon, authenticated;

grant execute on function kilo.restore_issue_challenge(text, text, uuid, uuid, text, integer) to service_role;
grant execute on function kilo.restore_consume_challenge(text, text, uuid, uuid, text) to service_role;
grant execute on function kilo.restore_register_credential(uuid, text, uuid, text, text, bigint) to service_role;
grant execute on function kilo.restore_record_use(text, uuid, bigint) to service_role;
