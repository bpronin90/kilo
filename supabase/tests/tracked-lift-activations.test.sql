-- Tracked-span activation records on the health singleton (issue #893, F12b;
-- contract in issue #892 comment 5425328351, matrix item 33).
--
-- The column is a SIBLING of tracked_lifts, added to the consent-gated health
-- table only. These tests pin the four properties that decision rests on:
--
--   1. the column exists on kilo.user_health_profile and nowhere else;
--   2. a profile holding ONLY activation records reports as having content, or
--      the integrity monitor could never flag losing it;
--   3. kilo.reconcile_user_health does not clear it -- it enumerates its columns
--      explicitly, and an unlisted one must survive a repair in either
--      direction, including the one that copies the LEGACY row onto the
--      canonical one (the only path that could plausibly blank it);
--   4. an activations-only write does not diverge the mirror, because
--      health_values_differ still compares exactly the six mirrored columns.
--
-- Harness: pgTAP.
--   psql "$DATABASE_URL" -f supabase/tests/tracked-lift-activations.test.sql

begin;

select plan(16);

\set user_a 'c1000000-0000-0000-0000-000000000001'
\set user_b 'c1000000-0000-0000-0000-000000000002'
\set user_c 'c1000000-0000-0000-0000-000000000003'

insert into auth.users (id) values (:'user_a'::uuid), (:'user_b'::uuid), (:'user_c'::uuid)
  on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 1. Shape: on the health table, and NOT mirrored onto the mixed account table
-- ---------------------------------------------------------------------------

select has_column('kilo', 'user_health_profile', 'tracked_lift_activations',
  'kilo.user_health_profile carries tracked_lift_activations');

select col_type_is('kilo', 'user_health_profile', 'tracked_lift_activations', 'jsonb',
  'tracked_lift_activations is jsonb');

select hasnt_column('kilo', 'user_profile', 'tracked_lift_activations',
  'the expand-phase mirror does NOT carry it: no client predating the #487 split can read it');

-- ---------------------------------------------------------------------------
-- 2. Content predicate: activations alone are content
-- ---------------------------------------------------------------------------
--
-- The deload columns, the multiplier and the routine pointer are null here on
-- purpose. Before this column was added to the predicate, a row carrying only
-- tracking state reported empty, so the presence watermark would never record
-- content for it and its later disappearance would have been indistinguishable
-- from an account that never wrote health data.
--
-- `tracked_lifts` is set alongside the record because the pairing trigger below
-- makes that a real invariant: a record for an untracked key is not a state the
-- table will hold.

insert into kilo.user_health_profile (user_id, tracked_lifts, tracked_lift_activations)
  values (:'user_a'::uuid, '{"squat": true}'::jsonb,
          '{"squat": {"anchor": 12, "at": "2026-08-26T14:03:11.204Z", "witness": {"headings": ["Squat"], "sessions": "[[1,5,225,\"lb\"]]"}}}'::jsonb)
  on conflict (user_id) do update set
    tracked_lifts = excluded.tracked_lifts,
    tracked_lift_activations = excluded.tracked_lift_activations;

select is(
  (select kilo.health_profile_has_content(h) from kilo.user_health_profile h where h.user_id = :'user_a'::uuid),
  true,
  'a profile holding only activation records reports as having content'
);

select is(
  (select kilo.health_profile_has_content(h) from kilo.user_health_profile h where h.user_id = :'user_b'::uuid),
  null,
  'a user with no health row is still no row at all (the predicate is over a row, not a user)'
);

-- ---------------------------------------------------------------------------
-- 3. Reconciliation never clears an unlisted column
-- ---------------------------------------------------------------------------
--
-- Force the legacy row to win: it is the direction that copies user_profile
-- onto user_health_profile, and user_profile has no activations to copy. The
-- repair must leave the canonical row's records intact rather than blanking
-- them to the loser's absent value.

-- The legacy row carries the same flag, so when it wins the repair below the
-- record it is paired with is still tracked and the pairing trigger leaves it
-- alone. (A legacy winner that said nothing was tracked SHOULD take the record
-- with it — that is the trigger's whole job, asserted separately below.)
insert into kilo.user_profile (user_id, display_name, tracked_lifts)
  values (:'user_a'::uuid, 'A', '{"squat": true}'::jsonb)
  on conflict (user_id) do update set tracked_lifts = excluded.tracked_lifts;

alter table kilo.user_profile disable trigger mirror_profile_to_health;
alter table kilo.user_health_profile disable trigger mirror_health_to_profile;
set session kilo.suppress_updated_at_stamp = 'on';
update kilo.user_health_profile set fatigue_multiplier = 1.07, updated_at = '2026-08-25 12:00:00+00'
  where user_id = :'user_a'::uuid;
update kilo.user_profile set fatigue_multiplier = 1.11, updated_at = '2026-08-26 12:00:00+00'
  where user_id = :'user_a'::uuid;
set session kilo.suppress_updated_at_stamp = 'off';
alter table kilo.user_profile enable trigger mirror_profile_to_health;
alter table kilo.user_health_profile enable trigger mirror_health_to_profile;

select is(
  kilo.reconcile_user_health(:'user_a'::uuid),
  'user_profile',
  'the strictly later legacy row wins the repair'
);

select is(
  (select tracked_lift_activations -> 'squat' ->> 'anchor'
     from kilo.user_health_profile where user_id = :'user_a'::uuid),
  '12',
  'reconciliation does not clear tracked_lift_activations when the legacy row wins'
);

-- ---------------------------------------------------------------------------
-- 4. An activations-only write does not diverge the mirror
-- ---------------------------------------------------------------------------
--
-- health_values_differ compares the six MIRRORED columns, so changing only this
-- one is an account-only write: the legacy row's watermark advances and parity
-- holds. If this column were ever added to that comparison without also being
-- mirrored, the two rows would diverge on every activation and never converge.

update kilo.user_health_profile
   set tracked_lifts = '{"bench press": true}'::jsonb,
       tracked_lift_activations = '{"bench press": {"anchor": 0, "at": "2026-08-26T15:00:00.000Z", "witness": null}}'::jsonb
 where user_id = :'user_a'::uuid;

select is(
  (select count(*) from kilo.health_parity_report() where user_id = :'user_a'::uuid),
  0::bigint,
  'a write that touches the activations column leaves the mirror in parity'
);

select is(
  (select tracked_lift_activations -> 'bench press' ->> 'anchor'
     from kilo.user_health_profile where user_id = :'user_a'::uuid),
  '0',
  'the activations-only write itself persisted'
);

-- ---------------------------------------------------------------------------
-- 5. The pairing trigger: a record never outlives the flag it belongs to
-- ---------------------------------------------------------------------------
--
-- This is the half an older client cannot do for itself. Its upsert names
-- `tracked_lifts` and not the activations column, so Postgres PRESERVES the
-- stored records across its untrack. Without the trigger the row is left with a
-- record for an untracked key, and a later retrack finds that record still
-- matching an unchanged opening history — reviving the abandoned span with every
-- gap session inside it.

insert into kilo.user_health_profile (user_id, tracked_lifts, tracked_lift_activations)
  values (:'user_b'::uuid, '{"squat": true, "bench": true}'::jsonb,
          '{"squat": {"anchor": 4, "at": "2026-08-26T10:00:00.000Z", "witness": {"headings": ["Monday"], "sessions": "s"}},
            "bench": {"anchor": 7, "at": "2026-08-26T10:00:00.000Z", "witness": {"headings": ["Friday"], "sessions": "b"}}}'::jsonb);

select is(
  (select count(*)::int from jsonb_each(
     (select tracked_lift_activations from kilo.user_health_profile where user_id = :'user_b'::uuid))),
  2,
  'a consistent row is untouched: both records belong to tracked keys'
);

-- Exactly what an older client's upsert does: it names the flags and nothing
-- else, so the activations column is carried over unchanged.
update kilo.user_health_profile
   set tracked_lifts = '{"bench": true}'::jsonb
 where user_id = :'user_b'::uuid;

select is(
  (select tracked_lift_activations -> 'squat' from kilo.user_health_profile where user_id = :'user_b'::uuid),
  null,
  'a legacy untrack drops the record it could not delete itself'
);

select is(
  (select tracked_lift_activations -> 'bench' ->> 'anchor' from kilo.user_health_profile where user_id = :'user_b'::uuid),
  '7',
  'and takes nothing else with it: a still-tracked key keeps its record'
);

-- The retrack that used to revive the span now finds nothing to revive.
update kilo.user_health_profile
   set tracked_lifts = '{"squat": true, "bench": true}'::jsonb
 where user_id = :'user_b'::uuid;

select is(
  (select tracked_lift_activations -> 'squat' from kilo.user_health_profile where user_id = :'user_b'::uuid),
  null,
  'retracking after a legacy untrack starts with no record, so the old span cannot come back'
);

-- A watermark-aware client writes both columns together and is never affected.
update kilo.user_health_profile
   set tracked_lifts = '{"squat": true, "bench": true}'::jsonb,
       tracked_lift_activations = '{"squat": {"anchor": 9, "at": "2026-08-26T16:00:00.000Z", "witness": {"headings": ["Monday"], "sessions": "s2"}},
                                    "bench": {"anchor": 7, "at": "2026-08-26T10:00:00.000Z", "witness": {"headings": ["Friday"], "sessions": "b"}}}'::jsonb
 where user_id = :'user_b'::uuid;

select is(
  (select tracked_lift_activations -> 'squat' ->> 'anchor' from kilo.user_health_profile where user_id = :'user_b'::uuid),
  '9',
  'a write that maintains the pairing itself passes through untouched'
);

-- An INSERT carrying an orphan is pruned on the way in, not only on update.
insert into kilo.user_health_profile (user_id, tracked_lifts, tracked_lift_activations)
  values (:'user_c'::uuid, '{"squat": true}'::jsonb,
          '{"squat": {"anchor": 1, "at": "2026-08-26T10:00:00.000Z", "witness": {"headings": ["Monday"], "sessions": "s"}},
            "ghost": {"anchor": 5, "at": "2026-08-26T10:00:00.000Z", "witness": {"headings": ["Monday"], "sessions": "g"}}}'::jsonb);

select is(
  (select count(*)::int from jsonb_each(
     (select tracked_lift_activations from kilo.user_health_profile where user_id = :'user_c'::uuid))),
  1,
  'an inserted row cannot install a record for a key it does not track'
);

-- Flags cleared entirely: every record goes, and the Track flags themselves are
-- never rewritten by this trigger in either direction.
update kilo.user_health_profile set tracked_lifts = '{}'::jsonb where user_id = :'user_c'::uuid;

select is(
  (select tracked_lift_activations from kilo.user_health_profile where user_id = :'user_c'::uuid),
  '{}'::jsonb,
  'clearing every flag clears every record'
);

select * from finish();
rollback;
