-- Retention-only deletion of consent evidence archives (issue #608, #572 claim 24).
--
-- The invariant under test: a consent_evidence_archive row leaves the table ONLY
-- through kilo.evidence_retention_sweep(), and only once its own six-year
-- retention has expired. Before this migration the immutability trigger fired
-- BEFORE UPDATE only, so a service-role DELETE could destroy retention evidence
-- years early. These assertions defend the closed DELETE path:
--
--   * service_role holds no DELETE or TRUNCATE privilege, so a direct delete of an
--     unexpired row, a blanket delete, a TRUNCATE, and a direct delete of an
--     already-expired row are all rejected at the privilege layer
--     (insufficient_privilege) before any trigger runs;
--   * forging the prune GUC does not help: an EXPIRED row deleted directly by
--     service_role with kilo.evidence_prune forced on is still rejected, because
--     the missing DELETE grant refuses it before the trigger runs (the review
--     regression this suite now covers);
--   * UPDATE stays rejected (the pre-existing immutability trigger);
--   * in the privileged owner context -- where DELETE is retained and the definer
--     sweep runs -- the trigger's per-row expiry check still rejects an unexpired
--     row even with the prune flag forged;
--   * the retention sweep deletes exactly the expired rows in a mixed batch and
--     leaves the unexpired rows;
--   * key-retirement coherence: a retired key with no surviving archive is marked
--     destroyable, a still-referenced key is not;
--   * account-deletion coherence: inserting a fresh archive row still works.
--
-- Harness: pgTAP.
--   psql "$DATABASE_URL" -f supabase/tests/consent-archive-retention-delete.test.sql

begin;

select plan(17);

-- ---------------------------------------------------------------------------
-- Seed: two key versions and a mixed batch of expired / unexpired archive rows.
-- ---------------------------------------------------------------------------

-- k-608-b is retired and referenced only by the expired rows: after the sweep it
-- must become destroyable. k-608-a is active and referenced by the unexpired rows:
-- it must survive.
insert into kilo.consent_evidence_key (evidence_key_id, retired_at)
values ('k-608-a', null),
       ('k-608-b', now() - interval '1 day');

insert into kilo.consent_evidence_archive
  (id, subject_hmac, evidence_key_id, catalog_revision, material_version,
   copy_sha256, consent_events, account_deleted_at, expires_at)
values
  -- expired rows (retention elapsed) -> only these may ever leave
  ('00000000-0000-0000-0000-0000000000e1', repeat('a', 64), 'k-608-b', 1, 1,
    repeat('f', 64), '[{"event_type":"granted"}]'::jsonb,
    now() - interval '6 years' - interval '1 day', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000e2', repeat('b', 64), 'k-608-b', 1, 1,
    repeat('f', 64), '[{"event_type":"granted"}]'::jsonb,
    now() - interval '6 years' - interval '2 days', now() - interval '2 hours'),
  -- unexpired rows (retention still running) -> must never be deletable
  ('00000000-0000-0000-0000-0000000000f1', repeat('c', 64), 'k-608-a', 1, 1,
    repeat('f', 64), '[{"event_type":"granted"}]'::jsonb,
    now(), now() + interval '5 years'),
  ('00000000-0000-0000-0000-0000000000f2', repeat('d', 64), 'k-608-a', 1, 1,
    repeat('f', 64), '[{"event_type":"granted"}]'::jsonb,
    now(), now() + interval '1 day');

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select has_trigger(
  'kilo', 'consent_evidence_archive', 'consent_evidence_archive_no_delete',
  'a BEFORE DELETE guard is installed on the evidence archive'
);

-- ---------------------------------------------------------------------------
-- Arbitrary service-role DELETE / UPDATE are rejected
-- ---------------------------------------------------------------------------

set local role service_role;

-- service_role holds no DELETE privilege on the archive (revoked in this
-- migration), so a direct delete of an unexpired row fails at the privilege layer
-- before any trigger runs.
select throws_ok(
  $$ delete from kilo.consent_evidence_archive
       where id = '00000000-0000-0000-0000-0000000000f1' $$,
  '42501',
  null,
  'service-role has no DELETE privilege on an unexpired archive row'
);

-- A blanket delete is likewise refused at the privilege layer.
select throws_ok(
  $$ delete from kilo.consent_evidence_archive $$,
  '42501',
  null,
  'service-role cannot blanket-delete the evidence archive'
);

-- TRUNCATE is revoked alongside DELETE: a BEFORE DELETE trigger never fires on
-- TRUNCATE, so without the revoke a caller could wipe the whole archive around the
-- guard. service_role now lacks the privilege entirely.
select throws_ok(
  $$ truncate kilo.consent_evidence_archive $$,
  '42501',
  null,
  'service-role cannot truncate the evidence archive'
);

-- The real bypass the trigger alone could not stop: an already-EXPIRED row.
-- Without the privilege revoke the trigger's expiry check would pass and the row
-- would be destroyed outside the sweep. Now the missing DELETE grant refuses it.
select throws_ok(
  $$ delete from kilo.consent_evidence_archive
       where id = '00000000-0000-0000-0000-0000000000e1' $$,
  '42501',
  null,
  'service-role cannot delete even an expired row directly'
);

-- Regression (review feedback, PR #629 thread PRRT_kwDOSVb7qM6SwNIV): forging the
-- prune flag no longer helps. An EXPIRED row + SET LOCAL kilo.evidence_prune = on,
-- issued directly by service_role, previously satisfied BOTH trigger checks and
-- slipped through; the privilege revoke now rejects it before the trigger sees it.
select throws_ok(
  $$ do $guard$
     begin
       perform set_config('kilo.evidence_prune', 'on', true);
       delete from kilo.consent_evidence_archive
         where id = '00000000-0000-0000-0000-0000000000e2';
     end
     $guard$; $$,
  '42501',
  null,
  'a forged prune flag cannot let service_role delete an expired row'
);

-- UPDATE remains rejected by the pre-existing immutability trigger (service_role
-- keeps its UPDATE grant; the trigger, not a privilege, is what blocks it).
select throws_ok(
  $$ update kilo.consent_evidence_archive set material_version = 99
       where id = '00000000-0000-0000-0000-0000000000e1' $$,
  '23514',
  null,
  'the evidence archive is still immutable to UPDATE'
);

reset role;

-- Defense in depth on the one privileged path. In the table-owner context -- which
-- retains DELETE and is where the SECURITY DEFINER sweep runs -- forge the prune
-- flag and aim at an UNEXPIRED row: the per-row expiry check in the trigger still
-- rejects it, so a sweep bug cannot leak a live row independent of any grant.
select throws_ok(
  $$ do $guard$
     begin
       perform set_config('kilo.evidence_prune', 'on', true);
       delete from kilo.consent_evidence_archive
         where id = '00000000-0000-0000-0000-0000000000f1';
     end
     $guard$; $$,
  '23514',
  null,
  'even with delete privilege and a forged prune flag, an unexpired row is protected'
);

-- ---------------------------------------------------------------------------
-- The designated prune path deletes exactly the expired rows
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from kilo.consent_evidence_archive where expires_at <= now()),
  2::bigint,
  'two expired rows are present before the sweep'
);

-- Run the one authorized path. It reports exactly the two expired rows removed.
select is(
  (select (kilo.evidence_retention_sweep() ->> 'archives_expired'))::int,
  2,
  'the retention sweep deletes exactly the two expired rows'
);

select is(
  (select count(*) from kilo.consent_evidence_archive where expires_at <= now()),
  0::bigint,
  'no expired rows remain after the sweep'
);

select is(
  (select count(*) from kilo.consent_evidence_archive where expires_at > now()),
  2::bigint,
  'the unexpired rows survive the sweep (mixed batch: only expired rows go)'
);

select is(
  (select count(*) from kilo.consent_evidence_archive),
  2::bigint,
  'the archive holds only the two unexpired rows after the sweep'
);

-- ---------------------------------------------------------------------------
-- Key-retirement coherence
-- ---------------------------------------------------------------------------

select isnt(
  (select destroyed_at from kilo.consent_evidence_key where evidence_key_id = 'k-608-b'),
  null,
  'a retired key with no surviving archive rows is marked destroyable'
);

select is(
  (select destroyed_at from kilo.consent_evidence_key where evidence_key_id = 'k-608-a'),
  null,
  'a key still referenced by unexpired archive rows is not destroyed'
);

-- ---------------------------------------------------------------------------
-- Account-deletion coherence: writing a new archive row still works
-- ---------------------------------------------------------------------------

set local role service_role;

select lives_ok(
  $$ insert into kilo.consent_evidence_archive
       (subject_hmac, evidence_key_id, catalog_revision, material_version,
        copy_sha256, consent_events, expires_at)
     values (repeat('e', 64), 'k-608-a', 1, 1, repeat('f', 64),
             '[{"event_type":"granted"}]'::jsonb, now() + interval '6 years') $$,
  'account-delete can still write a fresh evidence archive row'
);

reset role;

select is(
  (select count(*) from kilo.consent_evidence_archive),
  3::bigint,
  'the freshly archived row is present'
);

select * from finish();
rollback;
