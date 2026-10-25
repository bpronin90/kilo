-- MCP workout-note page RPC (issue #1627; docs/architecture/mcp-mvp.md 6.3, 7.2).
--
-- An OAuth-client token has no direct table access in `kilo` (#1625), so this
-- function is the only data path for workout notes. It re-runs the full request
-- gate inside the reading statement, spends the durable data quota, bounds raw
-- text and the encoded response size in SQL, and filters by the caller explicitly
-- because definer rights bypass RLS.
--
-- Failures raise fixed SQLSTATEs whose message is a fixed token, never data:
--   MC001 session/account no longer valid   MC002 cloud health consent required
--   MC003 invalid arguments                 MC004 data quota exhausted
-- A limiter error propagates and aborts the statement, so an outage fails closed.

create or replace function kilo.mcp_workout_notes_page(
  p_limit int,
  p_as_of timestamptz default null,
  p_after_updated_at timestamptz default null,
  p_after_id text default null,
  p_include_raw_text boolean default false
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
  c_raw constant int := 4000;
  v_uid uuid := auth.uid();
  v_status text;
  v_raw boolean := coalesce(p_include_raw_text, false);
  v_max int := (select case when coalesce(p_include_raw_text, false) then 25 else 100 end);
  v_as_of timestamptz;
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

  if p_limit is null or p_limit < 1 or p_limit > v_max
     or (p_after_id is null) <> (p_after_updated_at is null)
     or (p_after_id is not null and p_as_of is null)
     or char_length(coalesce(p_after_id, '')) > 512 then
    raise exception 'invalid_arguments' using errcode = 'MC003';
  end if;
  v_as_of := least(coalesce(p_as_of, now()), now());

  if not kilo.rate_limit_check('mcp:data:' || v_uid::text || ':m', 30, 60000)
     or not kilo.rate_limit_check('mcp:data:' || v_uid::text || ':h', 500, 3600000) then
    raise exception 'rate_limited' using errcode = 'MC004';
  end if;

  return (with cand as (
    select n.id, n.updated_at,
           row_number() over (order by n.updated_at desc, n.id desc) as rn,
           case when v_raw then
             json_build_object('id', n.id, 'title', n.title, 'saved_at', n.saved_at,
               'updated_at', n.updated_at, 'is_current', n.is_current,
               'raw_text', left(n.raw_text, c_raw),
               'raw_text_chars', coalesce(char_length(n.raw_text), 0),
               'raw_text_truncated', coalesce(char_length(n.raw_text), 0) > c_raw)
           else
             json_build_object('id', n.id, 'title', n.title, 'saved_at', n.saved_at,
               'updated_at', n.updated_at, 'is_current', n.is_current)
           end as j
      from kilo.workout_notes n
     where n.user_id = v_uid
       and n.deleted_at is null
       and n.updated_at <= v_as_of
       and (p_after_id is null or (n.updated_at, n.id) < (p_after_updated_at, p_after_id))
     order by n.updated_at desc, n.id desc
     limit p_limit + 1
  ), costed as (
    select rn, j, sum(octet_length(j::text) + 2) over (order by rn) as running from cand
  ), kept as (
    select rn, j from costed where rn <= p_limit and (rn = 1 or running <= c_budget)
  )
  select jsonb_build_object(
    'as_of', v_as_of,
    'has_more', (select count(*) from cand) > (select count(*) from kept),
    'items', coalesce((select json_agg(k.j order by k.rn) from kept k)::jsonb, '[]'::jsonb)));
end;
$$;

revoke all on function kilo.mcp_workout_notes_page(int, timestamptz, timestamptz, text, boolean)
  from public, anon, service_role;
grant execute on function kilo.mcp_workout_notes_page(int, timestamptz, timestamptz, text, boolean)
  to authenticated;
