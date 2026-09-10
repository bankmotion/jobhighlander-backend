-- An optional memo per interview status.
--
-- Keyed by status value rather than a single note column: a note that outlives
-- the status it explains reads as current when it is not. A process reopened
-- from `rejected` back to `active` would otherwise still be showing why it was
-- rejected.
--
-- Nullable with no default. An interview that has never carried a note stores
-- NULL rather than an empty object, so "no notes" is one state, not two.
ALTER TABLE `interviews`
  ADD COLUMN `status_notes` JSON NULL AFTER `status`;
