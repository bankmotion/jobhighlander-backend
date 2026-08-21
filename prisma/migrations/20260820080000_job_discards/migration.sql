-- "Discarded" markers, one per (profile, job).
--
-- Same shape as job_applications, and for the same reasons: job_id is nullable
-- with ON DELETE SET NULL and the title/company are copied onto the row,
-- because the jobs table is re-scraped and pruned routinely and this is a
-- judgement a person made that a maintenance delete must not take with it.
--
-- Keyed on (profile, job) rather than (user, job): the same posting can be
-- wrong for one candidate and right for the next.

CREATE TABLE `job_discards` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `profile_id` INTEGER NOT NULL,
  `job_id` INTEGER NULL,
  `job_title` VARCHAR(512) NOT NULL,
  `job_company` VARCHAR(255) NULL,
  `discarded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `discarded_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `job_discards_profile_id_job_id_key` (`profile_id`, `job_id`),
  INDEX `job_discards_job_id_idx` (`job_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `job_discards` ADD CONSTRAINT `job_discards_profile_id_fkey`
  FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `job_discards` ADD CONSTRAINT `job_discards_job_id_fkey`
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `job_discards` ADD CONSTRAINT `job_discards_discarded_by_id_fkey`
  FOREIGN KEY (`discarded_by_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
