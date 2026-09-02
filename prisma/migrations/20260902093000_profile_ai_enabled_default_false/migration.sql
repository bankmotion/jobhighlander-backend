-- AI spending becomes opt-in: a profile created from here on starts disabled
-- and a super admin turns it on deliberately.
--
-- Only the DEFAULT changes. Existing rows keep the value they already have, so
-- profiles that are mid-flight are not cut off by a schema change they had no
-- warning of. Turning those off is a decision for the new admin screen, not for
-- a migration.
ALTER TABLE `profiles`
  ALTER COLUMN `ai_enabled` SET DEFAULT false;
