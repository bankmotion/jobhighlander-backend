-- Interview timelines: what happens to an application after it is sent.
--
-- Five tables, one process:
--   interviews            one per (profile, job) — the process
--   interview_steps         a node on the timeline, ordered
--   interview_step_stages     which badges that node wears (many)
--   interview_panels          the cards under that node (many)
--   interview_stage_types   the admin-editable badge catalogue
--
-- `interviews` is keyed on (profile_id, job_id) rather than pointing at
-- job_applications, even though the UI only opens a timeline for a job already
-- marked applied. That rule is enforced in interviewService.open(); making it a
-- foreign key instead would mean one mis-click on "undo applied" cascades away
-- an entire interview history. applicationService.unmark() refuses while a
-- timeline exists, which is the safe half of the same constraint.
--
-- job_id is nullable with ON DELETE SET NULL and the title/company are copied
-- onto the row, matching resumes / job_applications / job_discards: the jobs
-- table is re-scraped and pruned routinely and this is hand-entered history.

CREATE TABLE `interview_stage_types` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(64) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `color` VARCHAR(16) NOT NULL DEFAULT '#6c5cff',
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `archived` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `interview_stage_types_key_key` (`key`),
  INDEX `interview_stage_types_archived_sort_order_idx` (`archived`, `sort_order`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `interviews` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `profile_id` INTEGER NOT NULL,
  `job_id` INTEGER NULL,
  `job_title` VARCHAR(512) NOT NULL,
  `job_company` VARCHAR(255) NULL,
  `status` ENUM('active','offer','accepted','rejected','withdrawn','ghosted','on_hold') NOT NULL DEFAULT 'active',
  `last_activity_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `opened_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `interviews_profile_id_job_id_key` (`profile_id`, `job_id`),
  INDEX `interviews_job_id_idx` (`job_id`),
  INDEX `interviews_status_last_activity_at_idx` (`status`, `last_activity_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- No date column: the marker on the rail is derived from the earliest
-- scheduled_at among this step's panels. Every panel field is optional, so a
-- step may legitimately carry no date, and falling back to created_at would
-- print a confident wrong date onto the timeline.
CREATE TABLE `interview_steps` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `interview_id` INTEGER NOT NULL,
  `title` VARCHAR(255) NULL,
  `result` ENUM('pending','passed','failed','cancelled') NOT NULL DEFAULT 'pending',
  `sort_order` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `interview_steps_interview_id_sort_order_idx` (`interview_id`, `sort_order`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `interview_step_stages` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `step_id` INTEGER NOT NULL,
  `stage_type_id` INTEGER NOT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `interview_step_stages_step_id_stage_type_id_key` (`step_id`, `stage_type_id`),
  INDEX `interview_step_stages_stage_type_id_idx` (`stage_type_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Every column past step_id/sort_order is nullable on purpose: a panel is
-- created the moment an email lands, when all that is known is "they want to
-- talk next week". A NOT NULL here would force inventing data to get past a
-- form, which is worse than an empty card.
--
-- scheduled_at is UTC; `timezone` holds the IANA zone the invitation was
-- written in. Both are kept because the instant alone cannot reproduce the
-- sentence the recruiter wrote, and showing only the reader's local time is
-- how a candidate joins an hour late while believing the dashboard.
CREATE TABLE `interview_panels` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `step_id` INTEGER NOT NULL,
  `title` VARCHAR(255) NULL,
  `note` TEXT NULL,
  `meeting_url` VARCHAR(2048) NULL,
  `scheduled_at` DATETIME(3) NULL,
  `timezone` VARCHAR(64) NULL,
  `duration_min` INTEGER NULL,
  `sort_order` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `interview_panels_step_id_sort_order_idx` (`step_id`, `sort_order`),
  INDEX `interview_panels_scheduled_at_idx` (`scheduled_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `interviews` ADD CONSTRAINT `interviews_profile_id_fkey`
  FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `interviews` ADD CONSTRAINT `interviews_job_id_fkey`
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `interviews` ADD CONSTRAINT `interviews_opened_by_id_fkey`
  FOREIGN KEY (`opened_by_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `interview_steps` ADD CONSTRAINT `interview_steps_interview_id_fkey`
  FOREIGN KEY (`interview_id`) REFERENCES `interviews`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `interview_step_stages` ADD CONSTRAINT `interview_step_stages_step_id_fkey`
  FOREIGN KEY (`step_id`) REFERENCES `interview_steps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `interview_step_stages` ADD CONSTRAINT `interview_step_stages_stage_type_id_fkey`
  FOREIGN KEY (`stage_type_id`) REFERENCES `interview_stage_types`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `interview_panels` ADD CONSTRAINT `interview_panels_step_id_fkey`
  FOREIGN KEY (`step_id`) REFERENCES `interview_steps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
