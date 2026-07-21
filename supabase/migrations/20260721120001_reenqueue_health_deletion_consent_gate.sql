-- Consent-state gate on the operator re-enqueue path (issue #598).
--
-- Follow-up to #572 claim 13: `kilo.reenqueue_health_deletion(p_user_id)`
-- (20260714120002_health_deletion_jobs.sql) rearmed a failed/pending job or, if
-- none existed, minted a brand-new `operator_reenqueue` job -- WITHOUT ever
-- checking the account's consent state. The purge worker then deletes the scoped
-- health rows. So a single operator call against a currently `granted` account
-- (or one that never withdrew) would erase health data the user still consents to
-- keep, and job completion would not move a granted account out of `granted`.
--
-- Deletion of a user's cloud health data is authorized only by an explicit
-- withdrawal. In this schema that authorization is exactly the consent state a
-- withdrawal produces:
--
--   deletion_pending   withdrawal recorded, purge in flight (the common recovery
--                      case: a failed/stuck withdrawal job to rearm)
--   withdrawn          purge already verified at zero rows; a re-enqueue re-checks
--                      and re-purges should scoped rows ever reappear
--
-- Every other state is refused, fail closed, with an explicit reason:
--
--   granted            the user currently consents; deletion is NOT authorized
--   needs_reconsent    scope changed but the user has NOT withdrawn; deletion is
--                      not authorized on the manual operator path (quarantine
--                      expiry has its own separately-armed automated purge)
--   (no state row)     no authorization of any kind exists
--
-- The deletion-authorizing state is itself the required job/evidence: it can only
-- have been reached through the append-only withdrawal ledger, so it proves an
-- actual withdrawal happened rather than an operator originating a deletion out of
-- nothing. Given that authorization, recovering the existing job or re-creating
-- the idempotent operator job is safe -- the worker still verifies zero rows
-- before recording completion.
--
-- This migration only tightens the guard; the recovery mechanics (rearm existing
-- open/failed job, else insert `operator_reenqueue`) are unchanged, so legitimate
-- failed/pending withdrawal jobs remain recoverable.

create or replace function kilo.reenqueue_health_deletion(p_user_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_state kilo.consent_state%rowtype;
  v_job_id uuid;
begin
  if p_user_id is null then
    raise exception 'reenqueue_health_deletion refused: a target user id is required'
      using errcode = 'check_violation';
  end if;

  -- Consent-state gate. Lock the state row so the authorization decision and the
  -- job write are one atomic step.
  select * into v_state
  from kilo.consent_state
  where user_id = p_user_id
  for update;

  if v_state.user_id is null then
    raise exception
      'reenqueue_health_deletion refused: no consent state for user %; health deletion is not authorized',
      p_user_id
      using errcode = 'check_violation';
  end if;

  -- Fail closed: only an explicit withdrawal (deletion_pending / withdrawn)
  -- authorizes deleting this account's cloud health data. A granted or
  -- needs_reconsent account is refused with its state named in the reason.
  if v_state.status not in ('deletion_pending', 'withdrawn') then
    raise exception
      'reenqueue_health_deletion refused: consent state % does not authorize health deletion for user %',
      v_state.status, p_user_id
      using errcode = 'check_violation';
  end if;

  -- Authorized. Recover an existing open/failed job; otherwise re-create the
  -- idempotent operator job. This block is unchanged from the pre-gate function.
  select id into v_job_id
  from kilo.health_data_deletion_jobs
  where user_id = p_user_id and status in ('pending', 'running', 'failed')
  order by created_at
  limit 1;

  if v_job_id is not null then
    update kilo.health_data_deletion_jobs set
      status = 'pending',
      last_error = null,
      -- An operator re-enqueue is an explicit "retry now"; it must not sit out the
      -- remaining backoff window.
      next_attempt_at = now(),
      updated_at = now()
    where id = v_job_id;
  else
    insert into kilo.health_data_deletion_jobs (user_id, reason)
    values (p_user_id, 'operator_reenqueue')
    returning id into v_job_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'job_id', v_job_id,
    'consent_status', v_state.status,
    'table_counts', kilo.health_data_row_counts(p_user_id)
  );
end;
$$;

revoke all on function kilo.reenqueue_health_deletion(uuid) from public, anon, authenticated;
grant execute on function kilo.reenqueue_health_deletion(uuid) to service_role;
