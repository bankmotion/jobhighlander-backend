-- Cover letters, one per (profile, job).
--
-- Stored as text: the letter is edited and pasted by the user, so the finished
-- prose is the artifact. job_id is nullable with ON DELETE SET NULL and the
-- title/company are copied onto the row, matching `resumes` — a routine job
-- prune must not destroy something the user paid model tokens for.

CREATE TABLE `cover_letters` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `profile_id` INTEGER NOT NULL,
  `job_id` INTEGER NULL,
  `job_title` VARCHAR(512) NOT NULL,
  `job_company` VARCHAR(255) NULL,
  `body` TEXT NOT NULL,
  `review_notes` JSON NOT NULL,
  `edited` BOOLEAN NOT NULL DEFAULT false,
  `model` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `cover_letters_profile_id_job_id_key` (`profile_id`, `job_id`),
  INDEX `cover_letters_job_id_idx` (`job_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `cover_letters` ADD CONSTRAINT `cover_letters_profile_id_fkey`
  FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `cover_letters` ADD CONSTRAINT `cover_letters_job_id_fkey`
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
