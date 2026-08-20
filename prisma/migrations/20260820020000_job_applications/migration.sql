-- "Applied" markers, one per (profile, job).
--
-- job_id is nullable with ON DELETE SET NULL and the title/company are copied
-- onto the row: the jobs table is re-scraped and pruned routinely, and this is
-- user-entered history that a maintenance delete must not take with it.

CREATE TABLE `job_applications` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `profile_id` INTEGER NOT NULL,
  `job_id` INTEGER NULL,
  `job_title` VARCHAR(512) NOT NULL,
  `job_company` VARCHAR(255) NULL,
  `applied_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `marked_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `job_applications_profile_id_job_id_key` (`profile_id`, `job_id`),
  INDEX `job_applications_job_id_idx` (`job_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `job_applications` ADD CONSTRAINT `job_applications_profile_id_fkey`
  FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `job_applications` ADD CONSTRAINT `job_applications_job_id_fkey`
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `job_applications` ADD CONSTRAINT `job_applications_marked_by_id_fkey`
  FOREIGN KEY (`marked_by_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
