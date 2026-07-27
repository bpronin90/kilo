-- Product measurement ingest: table + validated RPC insert path (issue #670).
--
-- Why this exists:
--   mobile/lib/productMeasurement.js buffers consent-gated, allow-listed,
--   PII-free measurement events locally (issue #672) and, until now, never
--   sent them anywhere (docs/product-measurement.md). This migration adds the
--   receiving table and the only way to write to it: a SECURITY DEFINER RPC
--   that re-validates the event name and every property server-side. The
--   client sanitizer (mobile/lib/productMeasurement.js) is defense in depth,
--   not the security boundary — a compromised or modified client cannot make
--   the server persist anything outside the allow-listed shape.
--
-- Design (mirrors kilo.rate_limit_hits / kilo.rate_limit_check from
-- 20260622120001_edge_rate_limit.sql):
--   * kilo.product_measurement_events is the receiving table, keyed by the
--     client's random install id (never an account id — installs are
--     anonymous by design; see docs/product-measurement.md). RLS is enabled
--     with no policies, so neither anon nor authenticated can read or write
--     the table directly; only service_role (via BYPASSRLS) and the RPC
--     below ever touch it.
--   * kilo.record_product_measurement_event(...) is SECURITY DEFINER, granted
--     to anon and authenticated (mobile installs may be signed out), and:
--       1. validates install_id looks like the client's 32-hex-char id,
--       2. validates event_name against the same fixed allow-list as the
--          client sanitizer,
--       3. re-sanitizes properties per event using the same bounds as
--          mobile/lib/productMeasurement.js's EVENT_SCHEMAS (unknown keys are
--          dropped, not persisted; out-of-range values are dropped),
--       4. rate-limits per install via the existing kilo.rate_limit_check to
--          bound abuse from a single (or spoofed) install id,
--       5. inserts only the re-sanitized row.
--     An unknown event_name raises and rejects the whole call; unknown or
--     invalid properties are silently dropped, matching the client's
--     sanitizeMeasurementEvent behavior so a partially-valid event still
--     records its valid fields.

create table if not exists kilo.product_measurement_events (
  id bigint generated always as identity primary key,
  install_id text not null check (install_id ~ '^[0-9a-f]{32}$'),
  event_name text not null check (event_name in (
    'tab_viewed',
    'workout_save_attempted',
    'workout_save_completed',
    'weight_save_attempted',
    'weight_save_completed',
    'parse_warning_summary',
    'analytics_viewed'
  )),
  properties jsonb not null default '{}'::jsonb,
  client_recorded_at_ms bigint not null check (client_recorded_at_ms >= 0),
  created_at timestamptz not null default now()
);

-- Lookup indexes for per-install and per-event aggregate queries.
create index if not exists product_measurement_events_install_created_idx
  on kilo.product_measurement_events (install_id, created_at);
create index if not exists product_measurement_events_event_created_idx
  on kilo.product_measurement_events (event_name, created_at);

-- Lock the table down: enable RLS with no policies so neither anon nor
-- authenticated can read or write it directly. Only service_role
-- (BYPASSRLS) and the RPC below ever touch these rows.
alter table kilo.product_measurement_events enable row level security;

-- ---------------------------------------------------------------------------
-- Server-side re-sanitizer, one branch per allow-listed event name. Mirrors
-- mobile/lib/productMeasurement.js's EVENT_SCHEMAS/sanitizeValue exactly:
--   tab_viewed:               { tab: one of the five fixed tab names }
--   workout_save_attempted:   {}
--   workout_save_completed:   { ok: boolean, duration_ms: 0..3600000, warning_count: 0..10000 }
--   weight_save_attempted:    {}
--   weight_save_completed:    { ok: boolean, duration_ms: 0..3600000 }
--   parse_warning_summary:    { warning_count: 0..10000 }
--   analytics_viewed:         { section: one of the four fixed section names }
-- Unknown keys and out-of-range/wrong-typed values are dropped, never raised.
create or replace function kilo.sanitize_product_measurement_properties(
  p_event_name text,
  p_properties jsonb
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_ok boolean;
  v_duration numeric;
  v_count numeric;
begin
  if p_properties is null or jsonb_typeof(p_properties) <> 'object' then
    return v_out;
  end if;

  if p_event_name = 'tab_viewed' then
    if p_properties ->> 'tab' in ('Home', 'Log', 'Weight', 'Analytics', 'More') then
      v_out := jsonb_build_object('tab', p_properties ->> 'tab');
    end if;

  elsif p_event_name = 'analytics_viewed' then
    if p_properties ->> 'section' in ('overview', 'strength', 'weight', 'other') then
      v_out := jsonb_build_object('section', p_properties ->> 'section');
    end if;

  elsif p_event_name in ('workout_save_completed', 'weight_save_completed') then
    if jsonb_typeof(p_properties -> 'ok') = 'boolean' then
      v_ok := (p_properties -> 'ok')::boolean;
      v_out := v_out || jsonb_build_object('ok', v_ok);
    end if;
    if jsonb_typeof(p_properties -> 'duration_ms') = 'number' then
      v_duration := (p_properties -> 'duration_ms')::numeric;
      if v_duration >= 0 and v_duration <= 3600000 then
        v_out := v_out || jsonb_build_object('duration_ms', round(v_duration));
      end if;
    end if;
    if p_event_name = 'workout_save_completed' and jsonb_typeof(p_properties -> 'warning_count') = 'number' then
      v_count := (p_properties -> 'warning_count')::numeric;
      if v_count >= 0 and v_count <= 10000 and v_count = trunc(v_count) then
        v_out := v_out || jsonb_build_object('warning_count', v_count::bigint);
      end if;
    end if;

  elsif p_event_name = 'parse_warning_summary' then
    if jsonb_typeof(p_properties -> 'warning_count') = 'number' then
      v_count := (p_properties -> 'warning_count')::numeric;
      if v_count >= 0 and v_count <= 10000 and v_count = trunc(v_count) then
        v_out := jsonb_build_object('warning_count', v_count::bigint);
      end if;
    end if;

  end if;
  -- workout_save_attempted / weight_save_attempted carry no properties.

  return v_out;
end;
$$;

revoke all on function kilo.sanitize_product_measurement_properties(text, jsonb) from public;

-- ---------------------------------------------------------------------------
-- The only write path into kilo.product_measurement_events. Rejects unknown
-- event names outright; re-sanitizes properties so only the allow-listed
-- shape can ever persist regardless of what the caller sent.
create or replace function kilo.record_product_measurement_event(
  p_install_id text,
  p_event_name text,
  p_properties jsonb,
  p_client_recorded_at_ms bigint
)
returns boolean
language plpgsql
security definer
set search_path = kilo, pg_temp
as $$
declare
  v_sanitized jsonb;
begin
  if p_install_id is null or p_install_id !~ '^[0-9a-f]{32}$' then
    raise exception 'invalid install id';
  end if;

  if p_event_name is null or p_event_name not in (
    'tab_viewed',
    'workout_save_attempted',
    'workout_save_completed',
    'weight_save_attempted',
    'weight_save_completed',
    'parse_warning_summary',
    'analytics_viewed'
  ) then
    raise exception 'unknown event name';
  end if;

  if p_client_recorded_at_ms is null or p_client_recorded_at_ms < 0 then
    raise exception 'invalid recorded_at';
  end if;

  -- Bound the ingest rate per install id so a single (or spoofed) install
  -- cannot flood the table; independent of the export/delete buckets.
  if not kilo.rate_limit_check(
    'product_measurement:install:' || p_install_id,
    120,
    60000
  ) then
    return false;
  end if;

  v_sanitized := kilo.sanitize_product_measurement_properties(p_event_name, p_properties);

  insert into kilo.product_measurement_events (
    install_id, event_name, properties, client_recorded_at_ms
  ) values (
    p_install_id, p_event_name, v_sanitized, p_client_recorded_at_ms
  );

  return true;
end;
$$;

-- Mobile installs may be signed out, so both anon and authenticated must be
-- able to call the RPC; neither can touch the table directly (see RLS above).
revoke all on function kilo.record_product_measurement_event(text, text, jsonb, bigint) from public;
grant execute on function kilo.record_product_measurement_event(text, text, jsonb, bigint) to anon, authenticated;
