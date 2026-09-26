-- Discovery mode for Android Restore Credentials (issue #1159).
--
-- restore-options may now be called without a credentialId, issuing a challenge
-- with a null credential binding so the OS can offer any eligible key it holds.
-- The corresponding restore-verification still passes assertion.id as the
-- p_credential_id to consume the challenge.  This migration extends
-- restore_consume_challenge so that a null-bound assertion challenge (discovery
-- mode) is matched and consumed by any credential id.

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
       or (p_operation = 'assertion' and (
         c.credential_id = p_credential_id
         or (p_credential_id is not null and c.credential_id is null)
       ))
     )
  returning c.id into v_id;

  return v_id is not null;
end;
$$;

-- Permissions unchanged from #1157 / #1162.
revoke all on function kilo.restore_consume_challenge(text, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function kilo.restore_consume_challenge(text, text, uuid, uuid, text) to service_role;
