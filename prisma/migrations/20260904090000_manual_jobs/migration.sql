-- Jobs added by hand, for postings that are not on any site we scrape.
--
-- A new enum member rather than a boolean column: `site` already answers "where
-- did this come from", every filter and grouping in the app is keyed on it, and
-- a parallel flag would mean two sources of truth for one question. Existing
-- rows are untouched — MODIFY only widens the set of allowed values.
ALTER TABLE `jobs`
  MODIFY `site` ENUM(
    'indeed','glassdoor','jobright','weworkremotely','himalayas',
    'findmyremote','jobicy','themuse','linkedin','other'
  ) NOT NULL;

-- Who added it. Nullable because every scraped row predates this and was added
-- by no one; ON DELETE SET NULL because removing an account must not remove a
-- job other people may have applied to.
ALTER TABLE `jobs`
  ADD COLUMN `created_by_id` INT NULL,
  ADD INDEX `jobs_created_by_id_idx` (`created_by_id`),
  ADD CONSTRAINT `jobs_created_by_id_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
