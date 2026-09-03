-- When each account last signed in, for the user-management table.
--
-- Nullable with no backfill: nobody's previous sign-ins were recorded, and
-- stamping every existing row with "now" would invent a login that never
-- happened. Existing users read as "never" until they next sign in.
ALTER TABLE `users`
  ADD COLUMN `last_login_at` DATETIME(3) NULL;
