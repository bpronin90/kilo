-- Post-contract data-integrity monitor for kilo.user_health_profile (issue #558).
--
-- #493 dropped the six legacy user_profile health columns and every compatibility
-- path, including kilo.health_parity_report(), kilo.reconcile_user_health(), and
-- kilo.health_values_differ(). Those helpers only worked because health values
-- were duplicated across user_profile and user_health_profile; that redundancy
-- was itself the Art. 9 problem #487/#493 exists to remove, so it cannot come
-- back. But it also provided the only detector for health-data loss (the genuine
-- missing_health_row divergence behind #538). Post-contract there is exactly one
-- copy of health data, so a granted account whose user_health_profile row
-- disappears -- or whose values are silently cleared -- is indistinguishable
-- from an account that never wrote health data, unless something remembers that
-- it once existed.
--
-- The monitor below remembers ONLY presence, timestamps, and a derived
-- has-any-content boolean -- never the health values themselves. That boolean is
-- the same kind of fact kilo.health_data_row_counts() already stores in
-- health_data_deletion_jobs.table_counts ("no deleted values, ever. Per-table
-- counts and completion status ONLY"); this monitor follows the same rule.
--
-- Design:
--   1. kilo.health_presence_watermark is a keyed shadow table. A periodic sweep
--      (kilo.health_presence_sweep, scheduled via pg_cron) upserts, for every
--      user_health_profile row that currently exists, when it was first seen,
--      when it was last seen present, whether it had any content at that sweep,
--      and when content was last seen present. It never touches a watermark row
--      for a user whose health row is currently absent, so a stale
--      last_present_at is exactly the fact a loss detector needs.
--   2. kilo.health_integrity_report() is the queryable operational check. It
--      joins the watermark against the LIVE user_health_profile and consent_state
--      tables and flags a divergence only for accounts the watermark has already
--      seen WITH content -- so an account that never wrote health data never
--      appears, with no dependency on consent_state at all for that exclusion.
--      A currently-granted account whose row is gone, or whose row is present but
--      empty, is flagged UNLESS explained by consent_state.status
--      ('withdrawn'/'deletion_pending') or by a completed purge
--      (cloud_rebuild_armed_at at or after the last time content was seen).
--      Following the #542 lesson, the withdrawn/deletion_pending check uses
--      coalesce(..., false) so a missing consent_state row is never silently
--      treated as an explanation -- it stays flagged.
--
-- This is a read/observe-only addition: it changes no consent, purge, or publish
-- behavior, and grants nothing beyond service_role.

-- ---------------------------------------------------------------------------
-- 1. Presence/timestamp watermark (no health values, ever)
-- ---------------------------------------------------------------------------

create table if not exists kilo.health_presence_watermark (
  user_id uuid primary key references auth.users (id) on delete cascade,
  first_seen_at timestamptz not null,
  last_present_at timestamptz not null,
  last_had_content boolean not null,
  last_content_at timestamptz,
  last_row_updated_at timestamptz not null,
  last_swept_at timestamptz not null
);

alter table kilo.health_presence_watermark enable row level security;
-- Service-role only. This table exists purely for operator-side loss detection;
-- no user-facing surface reads or writes it, and it must not be exposed the way
-- health_data_deletion_jobs is not.
grant all on kilo.health_presence_watermark to service_role;

comment on table kilo.health_presence_watermark is
  'Presence/timestamp shadow of kilo.user_health_profile for post-contract loss detection (#558). Never stores health values.';

-- Shared has-any-content predicate for one user_health_profile row, used by both
-- the sweep and the report so they can never disagree about what counts as
-- content. Returns a boolean derived from the row; it is not itself stored.
create or replace function kilo.health_profile_has_content(h kilo.user_health_profile)
  returns boolean
  language sql
  immutable
  set search_path = ''
as $$
  select h.current_deload_note_raw_text is not null
      or h.current_deload_note_saved_at is not null
      or h.current_deload_note_updated_at is not null
      or h.fatigue_multiplier is not null
      or h.tracked_lifts is not null
      or h.current_workout_note_id is not null;
$$;

revoke all on function kilo.health_profile_has_content(kilo.user_health_profile) from public, anon, authenticated;
grant execute on function kilo.health_profile_has_content(kilo.user_health_profile) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Sweep: record presence/timestamp facts for every row that currently exists
-- ---------------------------------------------------------------------------
--
-- Deliberately only touches watermark rows for users who currently HAVE a
-- user_health_profile row. A row that has disappeared is not re-touched here --
-- its last_present_at simply stops advancing, which is what lets the report
-- distinguish "gone since the last sweep" from "never seen".
create or replace function kilo.health_presence_sweep()
  returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into kilo.health_presence_watermark as w (
    user_id, first_seen_at, last_present_at, last_had_content,
    last_content_at, last_row_updated_at, last_swept_at
  )
  select
    h.user_id,
    now(),
    now(),
    kilo.health_profile_has_content(h),
    case when kilo.health_profile_has_content(h) then now() end,
    h.updated_at,
    now()
  from kilo.user_health_profile h
  on conflict (user_id) do update set
    last_present_at = now(),
    last_had_content = excluded.last_had_content,
    last_content_at = case
      when excluded.last_had_content then now()
      else w.last_content_at
    end,
    last_row_updated_at = excluded.last_row_updated_at,
    last_swept_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function kilo.health_presence_sweep() from public, anon, authenticated;
grant execute on function kilo.health_presence_sweep() to service_role;

-- Every 30 minutes: frequent enough that a genuine loss is caught same-day,
-- infrequent enough to stay a lightweight scan of a small table (one row per
-- consented account with health data).
select cron.schedule(
  'health-presence-sweep',
  '*/30 * * * *',
  $cron$ select kilo.health_presence_sweep() $cron$
);

-- ---------------------------------------------------------------------------
-- 3. The operational check
-- ---------------------------------------------------------------------------
create or replace function kilo.health_integrity_report()
  returns table (
    user_id uuid,
    divergence text,
    consent_status text,
    last_seen_present_at timestamptz,
    last_seen_content_at timestamptz,
    last_row_updated_at timestamptz
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select
    w.user_id,
    case
      when h.user_id is null then 'health_row_lost'
      else 'health_content_cleared'
    end as divergence,
    cs.status,
    w.last_present_at,
    w.last_content_at,
    w.last_row_updated_at
  from kilo.health_presence_watermark w
  left join kilo.user_health_profile h on h.user_id = w.user_id
  left join kilo.consent_state cs on cs.user_id = w.user_id
  where
    -- Only accounts the watermark has actually seen with content are candidates.
    -- Never-written health state (no watermark row, or a watermark row that has
    -- never had content) is excluded here and never reaches the exemption logic
    -- below at all.
    w.last_had_content
    and (
      h.user_id is null
      or not kilo.health_profile_has_content(h)
    )
    -- Legitimate absence: an explicit withdrawal or an in-flight purge. Per the
    -- #542 coalesce lesson, a MISSING consent_state row must not be silently
    -- treated as an explanation -- `... in (...)` against a null status is null,
    -- not false, and `coalesce(..., false)` is what keeps that null from being
    -- discarded as if it were a legitimate exemption.
    and not coalesce(cs.status in ('withdrawn', 'deletion_pending'), false)
    -- Legitimate absence: a completed purge (withdrawal, quarantine expiry, or
    -- operator re-enqueue) armed AT OR AFTER the last time this account's health
    -- row was seen with content. #538's rebuild signal is exactly the record of
    -- "this account's cloud copy was verifiably emptied by a purge, and a device
    -- is expected to repopulate it" -- that is not data loss, it is the window
    -- the rebuild-generation counter exists to cover.
    and not (
      cs.cloud_rebuild_armed_at is not null
      and cs.cloud_rebuild_armed_at >= w.last_content_at
    );
$$;

revoke all on function kilo.health_integrity_report() from public, anon, authenticated;
grant execute on function kilo.health_integrity_report() to service_role;

comment on function kilo.health_integrity_report() is
  'Operational check (#558): flags a previously-content-bearing account whose kilo.user_health_profile row is missing or empty with no consent withdrawal, pending deletion, or completed purge explaining it. health_content_cleared also fires on legitimate user-initiated clearing (e.g. deleting a deload note) -- it is a coarse signal for operator review, not an automated alert, because a single remaining copy of the data gives no way to tell "cleared by the user" apart from "cleared by a bug" without storing the values it exists to protect.';
