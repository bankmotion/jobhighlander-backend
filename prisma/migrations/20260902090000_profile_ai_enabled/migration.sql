-- Per-profile switch for AI spending.
--
-- Defaults to 1 so every existing profile keeps working: this is a way to turn
-- a profile OFF, not an opt-in that would silently disable everyone the moment
-- it ships.
--
-- NOT NULL rather than nullable, because "unset" and "enabled" would otherwise
-- be two states meaning the same thing, and every read would have to remember
-- to coalesce.
ALTER TABLE `profiles`
  ADD COLUMN `ai_enabled` BOOLEAN NOT NULL DEFAULT true;
