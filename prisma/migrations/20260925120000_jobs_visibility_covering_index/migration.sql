-- The per-profile visibility clause made the job list unusable.
--
-- `visible_to_profile_id` was indexed on its own but absent from the list's
-- covering indexes, and the clause behind it is `IS NULL OR = me`. A column
-- outside the key cannot be tested from the index, so MySQL stopped using the
-- covering index and scanned the PRIMARY instead: twenty rows took 1,914 ms
-- against 8 ms without the clause.
--
-- Appending it AFTER the sort columns is what makes this work. Placed earlier
-- it would break the ordering prefix and reintroduce a filesort; placed last,
-- the index still satisfies ORDER BY and the clause is settled inside it.
--
-- The new indexes are created BEFORE the old ones are dropped, so queries are
-- never left without one mid-migration.

CREATE INDEX `jobs_created_at_id_visible_to_profile_id_idx`
    ON `jobs` (`created_at`, `id`, `visible_to_profile_id`);

CREATE INDEX `jobs_remote_created_at_id_visible_to_profile_id_idx`
    ON `jobs` (`remote`, `created_at`, `id`, `visible_to_profile_id`);

CREATE INDEX `jobs_remote_site_created_at_id_visible_to_profile_id_idx`
    ON `jobs` (`remote`, `site`, `created_at`, `id`, `visible_to_profile_id`);

DROP INDEX `jobs_created_at_id_idx` ON `jobs`;

DROP INDEX `jobs_remote_created_at_id_idx` ON `jobs`;

DROP INDEX `jobs_remote_site_created_at_id_idx` ON `jobs`;
