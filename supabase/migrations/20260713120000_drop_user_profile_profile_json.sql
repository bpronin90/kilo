-- Drop kilo.user_profile.profile_json: a write-only column with no reader
-- anywhere in the repo. Pre-#471 code copied every non-promoted key of the
-- local profile into it; the #471 allowlist stopped new writes but the
-- column itself remained a live hazard. The live column was found holding
-- demographics/health data (date_of_birth, sex, height_cm, activity_level)
-- during #470's audit and was scrubbed to null on 2026-07-13 (verified: 0
-- non-null rows immediately before this migration). See issue #474.
alter table kilo.user_profile
  drop column if exists profile_json;
