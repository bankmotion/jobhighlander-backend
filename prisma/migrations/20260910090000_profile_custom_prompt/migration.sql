-- Per-profile custom prompts, plus the snapshots and the review history.
--
-- The prompt itself is ONE nullable column on `profiles`, not a table: a
-- profile has exactly one addendum, and a join table would only be modelling a
-- cardinality that does not exist.
--
-- The two snapshot columns are the opposite call. They duplicate text on
-- purpose, because a foreign key back to the profile would rewrite the history
-- of every document an admin had ever generated the moment they edited the
-- prompt — and "what was this resume actually built from" is the one question
-- the column exists to answer.

ALTER TABLE `profiles`
  ADD COLUMN `custom_prompt` TEXT NULL AFTER `default_template_key`;

ALTER TABLE `resumes`
  ADD COLUMN `custom_prompt` TEXT NULL AFTER `model`;

ALTER TABLE `cover_letters`
  ADD COLUMN `custom_prompt` TEXT NULL AFTER `model`;

CREATE TABLE `profile_prompt_checks` (
  `id`            INT NOT NULL AUTO_INCREMENT,
  `profile_id`    INT NOT NULL,
  `content`       TEXT NOT NULL,
  `verdict`       VARCHAR(16) NOT NULL,
  `summary`       TEXT NOT NULL,
  `findings`      JSON NOT NULL,
  `model`         VARCHAR(64) NOT NULL,
  `checked_by_id` INT NULL,
  `created_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `profile_prompt_checks_profile_id_created_at_idx` (`profile_id`, `created_at`),
  INDEX `profile_prompt_checks_checked_by_id_fkey` (`checked_by_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Cascade on the profile: a deleted profile's reviews describe a prompt that no
-- longer exists. SetNull on the reviewer, matching every other actor column
-- here — deleting a user must not delete the record of what was checked.
ALTER TABLE `profile_prompt_checks`
  ADD CONSTRAINT `profile_prompt_checks_profile_id_fkey`
    FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `profile_prompt_checks_checked_by_id_fkey`
    FOREIGN KEY (`checked_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
