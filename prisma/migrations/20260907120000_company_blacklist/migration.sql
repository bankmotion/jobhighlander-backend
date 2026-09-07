-- Per-profile company blacklist.
--
-- Separate from the scraper's global `company_blocklist` setting: that one is
-- admin-only and stops a posting being stored at all. This is the bidders' own
-- judgement and only FLAGS — the job stays in the list and stays actionable.
--
-- `profile_id` is NULLABLE and null means "every profile" (the "All" scope).
-- No unique index enforces one-global-entry-per-company because MySQL treats
-- NULLs as distinct, so (NULL,'acme') could repeat; the service checks instead.
CREATE TABLE `company_blacklist` (
  `id`            INT NOT NULL AUTO_INCREMENT,

  -- As typed, for display.
  `company`       VARCHAR(255) NOT NULL,

  -- Normalised for matching: trimmed, lower-cased, whitespace collapsed.
  -- Matching is WHOLE-NAME, never substring — "Ladders" the agency must not
  -- also take out "Ladder" the employer.
  `company_key`   VARCHAR(255) NOT NULL,

  -- NULL = applies to every profile.
  `profile_id`    INT NULL,

  -- Who added it, shown in the list so a shared profile can see whose call it was.
  `created_by_id` INT NOT NULL,

  `created_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `company_blacklist_company_key_idx` (`company_key`),
  INDEX `company_blacklist_profile_id_idx` (`profile_id`),
  INDEX `company_blacklist_created_by_id_idx` (`created_by_id`),

  -- Deleting a profile removes its entries; the global ones (profile_id NULL)
  -- are unaffected because they belong to no profile.
  CONSTRAINT `company_blacklist_profile_id_fkey`
    FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,

  -- Removing an account removes the entries it added, matching how the other
  -- "who did this" relations here behave.
  CONSTRAINT `company_blacklist_created_by_id_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
