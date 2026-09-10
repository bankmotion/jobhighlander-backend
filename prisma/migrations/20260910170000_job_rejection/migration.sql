-- "The employer said no", recorded per profile.
--
-- Separate from `job_discards` on purpose. A discard is this profile deciding a
-- posting is not a fit; a rejection is the employer deciding the candidate is
-- not. A job can carry both, and "I passed on twelve" reads nothing like
-- "twelve passed on me".
--
-- `note` is nullable: often there is nothing to say beyond the rejection
-- itself, and a required reason would only collect filler.
CREATE TABLE `job_rejections` (
  `id`             INT          NOT NULL AUTO_INCREMENT,
  `profile_id`     INT          NOT NULL,
  `job_id`         INT          NULL,
  `job_title`      VARCHAR(512) NOT NULL,
  `job_company`    VARCHAR(255) NULL,
  `note`           TEXT         NULL,
  `rejected_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `rejected_by_id` INT          NOT NULL,
  `created_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  -- One rejection per profile per posting. NULL job_id repeats are allowed by
  -- MySQL's NULL-distinct rule, which is correct here: those are orphaned
  -- records of deleted postings, not duplicates of a live one.
  UNIQUE INDEX `job_rejections_profile_id_job_id_key` (`profile_id`, `job_id`),
  INDEX `job_rejections_job_id_idx` (`job_id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `job_rejections`
  ADD CONSTRAINT `job_rejections_profile_id_fkey`
    FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `job_rejections_job_id_fkey`
    FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `job_rejections_rejected_by_id_fkey`
    FOREIGN KEY (`rejected_by_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
