-- Every blacklist entry belongs to exactly one profile.
--
-- The original design used a NULL `profile_id` to mean "every profile in the
-- system". That was the wrong reading of "All profiles": what it should mean is
-- "every profile I CAN USE" — the ones I own plus the ones shared with me.
--
-- Two things were wrong with the global row, and both go away here:
--   * it flagged jobs for users who never agreed to it, including people who
--     cannot see the profile it was added from; and
--   * nobody owned it, so ANY signed-in user could edit or delete a rule
--     somebody else had set for everyone.
--
-- "All profiles" is now expanded at creation into one row per usable profile,
-- so the scope is explicit in the data instead of implied by a NULL. That also
-- lets the database enforce uniqueness, which it could not do before: MySQL
-- treats NULLs as distinct, so (NULL,'acme') could repeat however many times.
--
-- Safe as a straight ALTER: the table holds no rows.
ALTER TABLE `company_blacklist`
  MODIFY `profile_id` INT NOT NULL;

-- One entry per company per profile. Adding a company twice for the same
-- profile is now a no-op the database refuses, not something the service has to
-- remember to check.
ALTER TABLE `company_blacklist`
  ADD UNIQUE INDEX `company_blacklist_profile_id_company_key_key` (`profile_id`, `company_key`);
