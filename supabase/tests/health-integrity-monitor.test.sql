-- Post-contract health-data-loss monitor tests (issue #558).
--
-- Post-contract there is exactly one copy of health data, so a granted
-- account's user_health_profile row disappearing -- or being silently
-- cleared -- is indistinguishable from an account that never wrote health
-- data unless something remembers it once existed. These tests exercise both
-- directions: a simulated loss must be flagged, and every legitimate-absence
-- case (never-written, withdrawn, deletion_pending, a completed purge, and a
-- missing consent_state row per the #542 coalesce lesson) must stay quiet.
--
-- Harness: pgTAP.
--   psql "$DATABASE_URL" -f supabase/tests/health-integrity-monitor.test.sql

begin;

select plan(14);

\set user_new 'b0000000-0000-0000-0000-000000000001'
\set user_lost 'b0000000-0000-0000-0000-000000000002'
\set user_cleared 'b0000000-0000-0000-0000-000000000003'
\set user_withdrawn 'b0000000-0000-0000-0000-000000000004'
\set user_pending 'b0000000-0000-0000-0000-000000000005'
\set user_purged 'b0000000-0000-0000-0000-000000000006'
\set user_no_consent_row 'b0000000-0000-0000-0000-000000000007'
\set user_sweep 'b0000000-0000-0000-0000-000000000008'

insert into auth.users (id)
  values (:'user_new'::uuid), (:'user_lost'::uuid), (:'user_cleared'::uuid),
         (:'user_withdrawn'::uuid), (:'user_pending'::uuid), (:'user_purged'::uuid),
         (:'user_no_consent_row'::uuid), (:'user_sweep'::uuid)
  on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Never-written health state is never flagged (no watermark row at all)
-- ---------------------------------------------------------------------------

insert into kilo.consent_state (user_id, status) values (:'user_new'::uuid, 'granted')
  on conflict (user_id) do update set status = 'granted';

select is(
  (select count(*) from kilo.health_integrity_report() where user_id = :'user_new'::uuid),
  0::bigint,
  'an account that never wrote health data is never flagged'
);

-- ---------------------------------------------------------------------------
-- Simulated loss: watermark remembers content, the row is now gone, account
-- is still granted, nothing explains the absence -- this is the genuine
-- divergence the monitor exists to catch.
-- ---------------------------------------------------------------------------

insert into kilo.consent_state (user_id, status) values (:'user_lost'::uuid, 'granted')
  on conflict (user_id) do update set status = 'granted';

insert into kilo.health_presence_watermark (
  user_id, first_seen_at, last_present_at, last_had_content, last_content_at,
  last_row_updated_at, last_swept_at
) values (
  :'user_lost'::uuid, now() - interval '1 day', now() - interval '1 hour', true,
  now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour'
);

select is(
  (select divergence from kilo.health_integrity_report() where user_id = :'user_lost'::uuid),
  'health_row_lost',
  'a granted account whose content-bearing health row disappeared is flagged health_row_lost'
);

-- ---------------------------------------------------------------------------
-- Simulated clearing: the row still exists but every gated field is now null.
-- ---------------------------------------------------------------------------

insert into kilo.consent_state (user_id, status) values (:'user_cleared'::uuid, 'granted')
  on conflict (user_id) do update set status = 'granted';

insert into kilo.user_health_profile (user_id) values (:'user_cleared'::uuid)
  on conflict (user_id) do update set
    current_deload_note_raw_text = null, current_deload_note_saved_at = null,
    current_deload_note_updated_at = null, fatigue_multiplier = null,
    tracked_lifts = null, current_workout_note_id = null;

insert into kilo.health_presence_watermark (
  user_id, first_seen_at, last_present_at, last_had_content, last_content_at,
  last_row_updated_at, last_swept_at
) values (
  :'user_cleared'::uuid, now() - interval '1 day', now() - interval '1 hour', true,
  now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour'
);

select is(
  (select divergence from kilo.health_integrity_report() where user_id = :'user_cleared'::uuid),
  'health_content_cleared',
  'a granted account whose present health row went fully empty is flagged health_content_cleared'
);

-- ---------------------------------------------------------------------------
-- Legitimate absence: withdrawn
-- ---------------------------------------------------------------------------

insert into kilo.consent_state (user_id, status) values (:'user_withdrawn'::uuid, 'withdrawn')
  on conflict (user_id) do update set status = 'withdrawn';

insert into kilo.health_presence_watermark (
  user_id, first_seen_at, last_present_at, last_had_content, last_content_at,
  last_row_updated_at, last_swept_at
) values (
  :'user_withdrawn'::uuid, now() - interval '1 day', now() - interval '1 hour', true,
  now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour'
);

select is(
  (select count(*) from kilo.health_integrity_report() where user_id = :'user_withdrawn'::uuid),
  0::bigint,
  'a withdrawn account with no health row is not flagged'
);

-- ---------------------------------------------------------------------------
-- Legitimate absence: deletion_pending (purge mid-flight)
-- ---------------------------------------------------------------------------

insert into kilo.consent_state (user_id, status) values (:'user_pending'::uuid, 'deletion_pending')
  on conflict (user_id) do update set status = 'deletion_pending';

insert into kilo.health_presence_watermark (
  user_id, first_seen_at, last_present_at, last_had_content, last_content_at,
  last_row_updated_at, last_swept_at
) values (
  :'user_pending'::uuid, now() - interval '1 day', now() - interval '1 hour', true,
  now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour'
);

select is(
  (select count(*) from kilo.health_integrity_report() where user_id = :'user_pending'::uuid),
  0::bigint,
  'a deletion_pending account with no health row is not flagged'
);

-- ---------------------------------------------------------------------------
-- Legitimate absence: a completed purge armed the rebuild signal AFTER the
-- account was last seen with content -- the account re-granted and is
-- waiting on a device to rebuild the cloud copy (#538), which is not loss.
-- ---------------------------------------------------------------------------

insert into kilo.consent_state (
  user_id, status, cloud_rebuild_generation, cloud_rebuild_armed_at
) values (
  :'user_purged'::uuid, 'granted', 1, now() - interval '10 minutes'
)
on conflict (user_id) do update set
  status = 'granted', cloud_rebuild_generation = 1,
  cloud_rebuild_armed_at = now() - interval '10 minutes';

insert into kilo.health_presence_watermark (
  user_id, first_seen_at, last_present_at, last_had_content, last_content_at,
  last_row_updated_at, last_swept_at
) values (
  :'user_purged'::uuid, now() - interval '1 day', now() - interval '1 hour', true,
  now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour'
);

select is(
  (select count(*) from kilo.health_integrity_report() where user_id = :'user_purged'::uuid),
  0::bigint,
  'an account whose row is absent because of a completed purge after last content is not flagged'
);

-- A purge armed BEFORE the last time content was seen present does not explain
-- a later loss (e.g. the row was legitimately rebuilt after the purge, then
-- genuinely lost again) -- it must still flag.
update kilo.consent_state
  set cloud_rebuild_armed_at = now() - interval '2 days'
  where user_id = :'user_purged'::uuid;

select is(
  (select divergence from kilo.health_integrity_report() where user_id = :'user_purged'::uuid),
  'health_row_lost',
  'a purge armed before the last content sighting does not explain a later loss'
);

-- ---------------------------------------------------------------------------
-- Missing consent_state row entirely (#542 coalesce lesson): must NOT be
-- silently treated as an explanation. `status in (...)` against a null status
-- is null, not false, so the report has to coalesce it to false or this case
-- would be discarded exactly like a legitimate withdrawal.
-- ---------------------------------------------------------------------------

delete from kilo.consent_state where user_id = :'user_no_consent_row'::uuid;

insert into kilo.health_presence_watermark (
  user_id, first_seen_at, last_present_at, last_had_content, last_content_at,
  last_row_updated_at, last_swept_at
) values (
  :'user_no_consent_row'::uuid, now() - interval '1 day', now() - interval '1 hour', true,
  now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour'
);

select is(
  (select divergence from kilo.health_integrity_report() where user_id = :'user_no_consent_row'::uuid),
  'health_row_lost',
  'an account with no consent_state row at all still reports health_row_lost'
);

-- ---------------------------------------------------------------------------
-- Sweep behavior: populates the watermark from live state, tracks
-- last_content_at across an upsert, and never touches rows for users whose
-- health row is currently absent.
-- ---------------------------------------------------------------------------

delete from kilo.health_presence_watermark where user_id = :'user_sweep'::uuid;
insert into kilo.consent_state (user_id, status) values (:'user_sweep'::uuid, 'granted')
  on conflict (user_id) do update set status = 'granted';
insert into kilo.user_health_profile (user_id, fatigue_multiplier)
  values (:'user_sweep'::uuid, 1.25)
  on conflict (user_id) do update set fatigue_multiplier = 1.25;

select kilo.health_presence_sweep();

select is(
  (select last_had_content from kilo.health_presence_watermark where user_id = :'user_sweep'::uuid),
  true,
  'the sweep records last_had_content = true for a row with a set field'
);

select isnt(
  (select last_content_at from kilo.health_presence_watermark where user_id = :'user_sweep'::uuid),
  null,
  'the sweep records a last_content_at for a content-bearing row'
);

-- Clear the field and re-sweep: last_had_content flips false, but
-- last_content_at is preserved from the prior sweep rather than cleared,
-- which is exactly what keeps a completed-purge exemption honest about when
-- content was truly last seen.
select last_content_at as user_sweep_prior_content_at
  from kilo.health_presence_watermark where user_id = :'user_sweep'::uuid
\gset

update kilo.user_health_profile set fatigue_multiplier = null
  where user_id = :'user_sweep'::uuid;

select kilo.health_presence_sweep();

select is(
  (select last_had_content from kilo.health_presence_watermark where user_id = :'user_sweep'::uuid),
  false,
  'the sweep updates last_had_content to false once the row is emptied'
);

select is(
  (select last_content_at from kilo.health_presence_watermark where user_id = :'user_sweep'::uuid),
  :'user_sweep_prior_content_at'::timestamptz,
  'the sweep preserves last_content_at rather than clearing it when content disappears'
);

-- Delete the row entirely and re-sweep: the watermark row is left untouched
-- (last_present_at does not advance), which is what lets the report tell
-- "gone since the last sweep" apart from "never seen".
select last_present_at as user_sweep_prior_present_at
  from kilo.health_presence_watermark where user_id = :'user_sweep'::uuid
\gset

delete from kilo.user_health_profile where user_id = :'user_sweep'::uuid;

select kilo.health_presence_sweep();

select is(
  (select last_present_at from kilo.health_presence_watermark where user_id = :'user_sweep'::uuid),
  :'user_sweep_prior_present_at'::timestamptz,
  'the sweep does not advance last_present_at for a user whose health row is currently absent'
);

select is(
  (select count(*) from kilo.health_presence_watermark where user_id = :'user_new'::uuid),
  0::bigint,
  'the sweep never creates a watermark row for a user with no health row at all'
);

select * from finish();

rollback;
