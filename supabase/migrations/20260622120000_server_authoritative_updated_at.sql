-- Server-authoritative updated_at for the kilo schema (issue #349).
--
-- Hardens the cloud-sync write path so last-write-wins (LWW) ordering can no
-- longer be driven by client-supplied values. Surfaced by the #347 security
-- audit (Finding #1, MEDIUM): `push()` previously sent the client's own
-- `updated_at`, letting a tampered client stamp a far-future timestamp that
-- would permanently win every conflict across all of that user's own devices.
--
-- Trust boundary: the client may propose row data, but it must NOT be able to
-- set the sync-ordering clock. We make `updated_at` server-generated on every
-- write. The table already defaults `updated_at` to `now()` on insert; this
-- migration adds a BEFORE INSERT OR UPDATE trigger that overwrites `updated_at`
-- with `now()` unconditionally, so any client-supplied value (including a
-- future-dated one) is discarded before the row is stored. Because the stored
-- value is always server time, a future-dated client `updated_at` can never win
-- an LWW conflict, and a separate future-timestamp CHECK is therefore redundant.
--
-- RLS owner-scoping and the existing column defaults are unchanged. The trigger
-- is set-based and runs once per affected row; no per-row round trips.

create or replace function kilo.set_updated_at()
  returns trigger
  language plpgsql
  -- Pin search_path so the function is not influenced by a caller's settings.
  set search_path = ''
as $$
begin
  -- Ignore whatever the client proposed; the server owns this clock.
  new.updated_at := now();
  return new;
end;
$$;

-- Apply the trigger to every kilo app table that carries `updated_at`. The two
-- cloud-synced tables (weight_entries, workout_notes) are the acceptance
-- targets; the rest are covered for a single consistent invariant.

drop trigger if exists set_updated_at on kilo.user_profile;
create trigger set_updated_at
  before insert or update on kilo.user_profile
  for each row execute function kilo.set_updated_at();

drop trigger if exists set_updated_at on kilo.feature_toggles;
create trigger set_updated_at
  before insert or update on kilo.feature_toggles
  for each row execute function kilo.set_updated_at();

drop trigger if exists set_updated_at on kilo.weight_entries;
create trigger set_updated_at
  before insert or update on kilo.weight_entries
  for each row execute function kilo.set_updated_at();

drop trigger if exists set_updated_at on kilo.weight_goal;
create trigger set_updated_at
  before insert or update on kilo.weight_goal
  for each row execute function kilo.set_updated_at();

drop trigger if exists set_updated_at on kilo.workout_notes;
create trigger set_updated_at
  before insert or update on kilo.workout_notes
  for each row execute function kilo.set_updated_at();

drop trigger if exists set_updated_at on kilo.deload_history;
create trigger set_updated_at
  before insert or update on kilo.deload_history
  for each row execute function kilo.set_updated_at();

drop trigger if exists set_updated_at on kilo.fatigue_checkins;
create trigger set_updated_at
  before insert or update on kilo.fatigue_checkins
  for each row execute function kilo.set_updated_at();
