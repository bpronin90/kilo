-- MCP weight-entry page RPC (issue #1628; docs/architecture/mcp-mvp.md 6.3, 7.3).
--
-- An OAuth-client token has no direct table access in `kilo` (#1625), so this
-- function is the only data path for weight entries. It re-runs the full request
-- gate inside the reading statement, spends the durable data quota, bounds the
-- encoded response size in SQL, and filters by the caller explicitly because
-- definer rights bypass RLS. The weight `note` and `saved_at`/`updated_at` columns
-- are never selected.
--
-- Position: (logged_at desc nulls last, id desc). `p_phase` is null on the first
-- page, 'dated' after a dated row and 'undated' after a row whose logged_at is
-- null. A range ([from, to) on logged_at) matches dated rows only.
--
-- Failures raise fixed SQLSTATEs whose message is a fixed token, never data:
--   MC001 session/account no longer valid   MC002 cloud health consent required
--   MC003 invalid arguments                 MC004 data quota exhausted
-- A limiter error propagates and aborts the statement, so an outage fails closed.

create or replace function kilo.mcp_weight_entries_page(
  p_limit int,
  p_phase text default null,
  p_after_logged_at timestamptz default null,
  p_after_id text default null,
  p_logged_from timestamptz default null,
  p_logged_to timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
  c_budget constant int := 204800;
  v_uid uuid := auth.uid();
  v_status text;
  v_ranged boolean := p_logged_from is not null;
begin
  if v_uid is null or not kilo.is_oauth_client_token() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  v_status := kilo.mcp_gate_status() ->> 'status';
  if v_status is distinct from 'ok' then
    if v_status = 'consent_required' then
      raise exception 'consent_required' using errcode = 'MC002';
    end if;
    raise exception 'session_inactive' using errcode = 'MC001';
  end if;
  if exists (select 1 from kilo.health_sync_config c where c.id = true and c.mode = 'paused') then
    raise exception 'consent_required' using errcode = 'MC002';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100
     or char_length(coalesce(p_after_id, '')) > 512
     or coalesce(p_phase not in ('dated', 'undated'), false)
     or (p_phase is null) <> (p_after_id is null)
     or coalesce(p_phase = 'dated', false) <> (p_after_logged_at is not null)
     or (p_logged_from is null) <> (p_logged_to is null)
     or (v_ranged and (p_logged_from >= p_logged_to
                       or p_logged_to - p_logged_from > interval '366 days'
                       or p_phase = 'undated')) then
    raise exception 'invalid_arguments' using errcode = 'MC003';
  end if;

  if not kilo.rate_limit_check('mcp:data:' || v_uid::text || ':m', 30, 60000)
     or not kilo.rate_limit_check('mcp:data:' || v_uid::text || ':h', 500, 3600000) then
    raise exception 'rate_limited' using errcode = 'MC004';
  end if;

  return (with cand as (
    select w.id,
           row_number() over (order by w.logged_at desc nulls last, w.id desc) as rn,
           json_build_object('id', w.id, 'value', w.weight_value, 'date', w.date,
                             'logged_at', w.logged_at) as j
      from kilo.weight_entries w
     where w.user_id = v_uid
       and w.deleted_at is null
       and w.entry_type = 'weight'
       and (not v_ranged or (w.logged_at >= p_logged_from and w.logged_at < p_logged_to))
       and (p_phase is null
            or (p_phase = 'dated'
                and (w.logged_at is null or (w.logged_at, w.id) < (p_after_logged_at, p_after_id)))
            or (p_phase = 'undated' and w.logged_at is null and w.id < p_after_id))
     order by w.logged_at desc nulls last, w.id desc
     limit p_limit + 1
  ), costed as (
    select rn, j, sum(octet_length(j::text) + 2) over (order by rn) as running from cand
  ), kept as (
    select rn, j from costed where rn <= p_limit and (rn = 1 or running <= c_budget)
  )
  select jsonb_build_object(
    'as_of', now(),
    'has_more', (select count(*) from cand) > (select count(*) from kept),
    'items', coalesce((select json_agg(k.j order by k.rn) from kept k)::jsonb, '[]'::jsonb)));
end;
$$;

revoke all on function kilo.mcp_weight_entries_page(int, text, timestamptz, text, timestamptz, timestamptz)
  from public, anon, service_role;
grant execute on function kilo.mcp_weight_entries_page(int, text, timestamptz, text, timestamptz, timestamptz)
  to authenticated;
