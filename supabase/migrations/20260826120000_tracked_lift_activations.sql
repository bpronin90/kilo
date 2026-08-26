-- Tracked-span activation records on the consent-gated health singleton
-- (issue #893, F12b; contract in issue #892 comment 5425328351).
--
-- A Track activation now persists, beside the unchanged `tracked_lifts` boolean
-- map, a per-canonical-key record of WHEN that tracking span opened:
--
--   { "squat": { "anchor": 12,
--                "at": "2026-08-26T14:03:11.204Z",
--                "witness": { "headings": ["Squat"], "sessions": "..." } } }
--
-- `anchor` is the exercise's logged-session count at the false->true toggle.
-- Progression (trend, overload direction, the progressing/steady/regressing
-- classification) reads only sessions at or after it; capability (Est. Max,
-- Kilo Max, Best Set) ignores it and keeps using all history. The `witness` is a
-- verification token, never an identity: it retires a watermark that no longer
-- plainly belongs to the movement holding the key, and never reassigns one.
--
-- It is a SIBLING COLUMN, deliberately not folded into `tracked_lifts`. The
-- mobile importer hard-filters that map to booleans, so an already-installed
-- older build restoring a new backup would have silently untracked every
-- exercise. A separate column has no such interaction: an older client's upsert
-- never names it, so its round-trip leaves the records untouched and it simply
-- keeps legacy full-history progression.
--
-- It is data concerning health under Art. 9 -- a lift selection plus the shape
-- of that lift's opening sessions -- which is why it belongs here and nowhere
-- else. Deliberately NOT added to kilo.user_profile or to the mirror functions:
-- that mirror is expand-phase compatibility for clients predating the #487
-- split, and a field no such client can read has nothing to be compatible with.
-- kilo.health_values_differ therefore still compares exactly the six mirrored
-- columns, so an activations-only write takes the account-only watermark path
-- and cannot ping-pong. kilo.reconcile_user_health enumerates its columns
-- explicitly and never clears one it does not list.
--
-- Export and erasure need no change: user_health_profile is a whole-row
-- singleton in HEALTH_DATA_SCOPE, so both already carry every column on it.

alter table kilo.user_health_profile
  add column if not exists tracked_lift_activations jsonb;

comment on column kilo.user_health_profile.tracked_lift_activations is
  'Tracked-span activation records keyed by canonical exercise key (#893). Scopes progression metrics to the current intentional tracked span; capability metrics ignore it. Art. 9 health data.';

-- The integrity monitor's has-any-content predicate must see this column, or a
-- profile holding ONLY activation records reports as empty and a genuine loss of
-- it would never be flagged.
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
      or h.tracked_lift_activations is not null
      or h.current_workout_note_id is not null;
$$;

revoke all on function kilo.health_profile_has_content(kilo.user_health_profile) from public, anon, authenticated;
grant execute on function kilo.health_profile_has_content(kilo.user_health_profile) to service_role;
